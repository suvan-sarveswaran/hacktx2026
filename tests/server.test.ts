import assert from "node:assert/strict";
import test from "node:test";
import { createAppServer } from "../src/server.js";
import { slidesPdf } from "./pdf-fixtures.js";
import { setTimeout as delay } from "node:timers/promises";
import type { PdfJob, LessonJob } from "../src/web-contract.js";

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

test("PDF HTTP uploads produce editable source, then use the normal lesson endpoint", { timeout: 30_000 }, async (t) => {
  const server = await createAppServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { "Content-Type": "application/pdf" };
  assert.equal((await fetch(`${base}/api/documents`, { method: "POST", body: "wrong type" })).status, 415);
  assert.equal((await fetch(`${base}/api/documents`, { method: "POST", headers, body: "not a pdf" })).status, 400);
  assert.equal((await fetch(`${base}/api/documents`, { method: "POST", headers: { ...headers, Origin: "https://untrusted.example" }, body: "pdf" })).status, 403);
  const response = await fetch(`${base}/api/documents`, { method: "POST", headers, body: Buffer.from(await slidesPdf()) });
  assert.equal(response.status, 202);
  let job = await response.json() as PdfJob;
  for (let i = 0; i < 200 && job.status === "reading"; i++) {
    await delay(50);
    job = await (await fetch(`${base}/api/documents/${job.id}`)).json() as PdfJob;
  }
  assert.equal(job.status, "ready", job.error);
  assert.equal(job.result!.pageCount, 2);
  assert.match(job.result!.text, /Energy in motion/);
  const lesson = await (await fetch(`${base}/api/lessons`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: job.result!.text, mode: "script", audience: "Students", targetWords: 150 }) })).json() as LessonJob;
  assert.equal(lesson.status, "script-ready");
  assert.equal(lesson.result!.script, job.result!.text);
  assert.ok(lesson.result!.chunks.length);
  assert.equal((await fetch(`${base}/api/documents/${job.id}`, { method: "DELETE", headers: { Origin: "https://untrusted.example" } })).status, 403);
  assert.equal((await fetch(`${base}/api/documents/${job.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await fetch(`${base}/api/documents/${job.id}`)).status, 404);
  const corrupt = await (await fetch(`${base}/api/documents`, { method: "POST", headers, body: "%PDF-1.7\ncorrupt" })).json() as PdfJob;
  let failed = corrupt;
  for (let i = 0; i < 200 && failed.status === "reading"; i++) {
    await delay(50); failed = await (await fetch(`${base}/api/documents/${corrupt.id}`)).json() as PdfJob;
  }
  assert.equal(failed.status, "failed");
  assert.match(failed.error!, /couldn't be read/);
});
