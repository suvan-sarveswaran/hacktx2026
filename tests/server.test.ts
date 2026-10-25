import assert from "node:assert/strict";
import test from "node:test";
import { createAppServer } from "../src/server.js";

test("HTTP API validates requests, returns real narration chunks, and serves the original JSON download", async (t) => {
  const server = await createAppServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { "Content-Type": "application/json" };

  const health = await (await fetch(`${base}/api/health`)).json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(health), ["generationConfigured", "rendererConfigured"]);
  assert.equal((await fetch(`${base}/api/lessons`, { method: "POST", headers, body: "{" })).status, 400);
  assert.equal((await fetch(`${base}/api/lessons`, { method: "POST", headers, body: "{}" })).status, 400);
  assert.equal((await fetch(`${base}/api/lessons`, { method: "POST", headers: { ...headers, Origin: "https://untrusted.example" }, body: "{}" })).status, 403);
  assert.equal((await fetch(`${base}/api/lessons`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "text" })).status, 415);
  assert.equal((await fetch(`${base}/api/lessons/00000000-0000-0000-0000-000000000000`)).status, 404);
  const text = "A falling ball gains kinetic energy. Energy changes forms.";
  const created = await fetch(`${base}/api/lessons`, { method: "POST", headers, body: JSON.stringify({ text, mode: "script", audience: "Students", targetWords: 150 }) });
  assert.equal(created.status, 202);
  const job = await created.json() as { id: string; status: string; result: { script: string; chunks: unknown[] } };
  assert.equal(job.status, "script-ready");
  assert.equal(job.result.script, text);
  assert.ok(job.result.chunks.length > 0);
  const download = await fetch(`${base}/api/lessons/${job.id}/json`);
  assert.match(download.headers.get("content-disposition")!, /attachment/);
  assert.deepEqual(await download.json(), job.result);
  const poll = await (await fetch(`${base}/api/lessons/${job.id}`)).json();
  assert.deepEqual(poll, job);
});
