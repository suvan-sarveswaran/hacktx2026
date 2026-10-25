import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { createAppServer } from "../src/server.js";
import { ProductionService } from "../src/production-service.js";
import type { LessonJob, PdfJob } from "../src/web-contract.js";

test("public visitors cannot read, mutate, export or download another visitor's lesson; ownership survives restart", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "entertainify-access-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let server = await createAppServer(false, new ProductionService({ dataDir }));
  const listen = async () => { await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const a = server.address(); assert.ok(a && typeof a === "object"); return `http://127.0.0.1:${a.port}`; };
  let base = await listen();
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const first = await fetch(`${base}/api/lessons`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Private notes about photosynthesis.", mode: "script", audience: "Students", targetWords: 75, format: "youtube" }) });
  assert.equal(first.status, 202);
  const cookie = first.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.doesNotMatch(first.headers.get("content-security-policy")!, /script-src[^;]*unsafe/);
  const job = await first.json() as LessonJob;
  const headers = { Cookie: cookie.split(";")[0]! };
  const ownerFile = await readFile(join(dataDir, job.id, ".owner"), "utf8");
  assert.equal(ownerFile.length, 64); assert.ok(!cookie.includes(ownerFile));
  for (const suffix of ["", "/source", "/script", "/export", "/json", "/assets/frames/" + "a".repeat(64) + ".png"]) {
    assert.equal((await fetch(`${base}/api/lessons/${job.id}${suffix}`)).status, 404);
  }
  for (const stage of ["settings", "stop", "images", "video", "clip"]) {
    assert.equal((await fetch(`${base}/api/lessons/${job.id}/${stage}`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } })).status, 404);
  }
  assert.deepEqual(await (await fetch(`${base}/api/lessons`)).json(), []);
  assert.equal((await (await fetch(`${base}/api/lessons`, { headers })).json() as unknown[]).length, 1);
  assert.equal((await fetch(`${base}/api/lessons/${job.id}`, { headers: { ...headers, "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await fetch(`${base}/api/lessons/${job.id}/settings`, { method: "POST", headers: { ...headers, Origin: "null", "Content-Type": "application/json" }, body: "{}" })).status, 403);
  const pdf = await fetch(`${base}/api/documents`, { method: "POST", headers: { ...headers, "Content-Type": "application/pdf" }, body: "%PDF-1.7\ncorrupt" });
  assert.equal(pdf.status, 202); const document = await pdf.json() as PdfJob;
  assert.equal((await fetch(`${base}/api/documents/${document.id}`)).status, 404);
  assert.equal((await fetch(`${base}/api/documents/${document.id}`, { method: "DELETE" })).status, 404);
  assert.equal((await fetch(`${base}/api/documents/${document.id}`, { method: "DELETE", headers })).status, 200);
  await new Promise<void>(resolve => server.close(() => resolve()));
  server = await createAppServer(false, new ProductionService({ dataDir })); base = await listen();
  assert.equal((await fetch(`${base}/api/lessons/${job.id}`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/api/lessons/${job.id}`)).status, 404);
  for (const path of ["/.env", "/.git/config", "/src/server.ts", "/package.json"]) assert.equal((await fetch(base + path)).status, 404);
});

test("proxy requests cannot inherit the local shared library and HTTPS sessions use Secure cookies", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "entertainify-proxy-")); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const service = new ProductionService({ dataDir });
  const job = service.create({ text: "A private local lesson.", mode: "script", audience: "Students", targetWords: 75 });
  const server = await createAppServer(false, service, { localOnly: true });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const a = server.address(); assert.ok(a && typeof a === "object"); const base = `http://127.0.0.1:${a.port}`;
  const response = await fetch(`${base}/api/lessons/${job.id}`, { headers: { "X-Forwarded-Proto": "https" } });
  assert.equal(response.status, 404); assert.match(response.headers.get("set-cookie")!, /^__Host-entertainify=.*; Secure$/);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(`${base}/api/lessons/${job.id}`, { headers: { Host: "public.example" } }, res => { res.resume(); resolve(res.statusCode); }); req.on("error", reject); req.end();
  });
  assert.equal(status, 404);
});
