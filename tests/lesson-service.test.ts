import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { LessonService, parseNarration, validateLessonRequest } from "../src/lesson-service.js";
import type { LessonJob, LessonRequest } from "../src/web-contract.js";
import type { PipelineOptions, PipelineResult } from "../src/pipeline.js";
import { createHttpVideoRenderer, validateRenderTask } from "../src/video-renderer.js";

const request: LessonRequest = { text: "A leaf catches sunlight. It makes sugar.", mode: "material", audience: "Middle school students", targetWords: 150 };
async function settled(job: LessonJob): Promise<void> {
  for (let i = 0; i < 100 && ["writing", "rendering"].includes(job.status); i++) await delay(5);
  assert.ok(!["writing", "rendering"].includes(job.status), "job must finish");
}

test("web requests reject invalid source/options and never accept browser credentials", () => {
  assert.deepEqual(validateLessonRequest({ ...request, apiKey: "untrusted", baseUrl: "https://untrusted.example" }), request);
  for (const patch of [{ text: "  " }, { text: "x".repeat(80_001) }, { mode: "invalid" }, { audience: "" }, { audience: "x".repeat(301) }, { targetWords: 49 }, { targetWords: 2001 }, { targetWords: 100.2 }]) {
    assert.throws(() => validateLessonRequest({ ...request, ...patch }));
  }
});

test("script mode really chunks the exact narration and preserves the renderer contract without an LLM", async () => {
  const service = new LessonService({ generate: async () => { throw new Error("Must not call AI"); } });
  const job = service.create({ ...request, mode: "script" });
  await settled(job);
  assert.equal(job.status, "script-ready");
  assert.equal(job.videoUrl, undefined);
  assert.equal(job.result?.script, request.text);
  assert.equal(job.result?.metadata.provider, "none");
  for (const chunk of job.result!.chunks) assert.equal(job.result!.script.slice(chunk.startOffset, chunk.endOffset), chunk.text);
  assert.deepEqual(Object.keys(job.result!), ["title", "script", "chunks", "metadata"]);
});

test("topic mode forwards its educational intent and audience to the existing generation pipeline", async () => {
  let received: PipelineOptions | undefined;
  const service = new LessonService({ generate: async (source, options) => { assert.equal(source, request.text); received = options; return parseNarration("A topic-based lesson."); } });
  const job = service.create({ ...request, mode: "topic" });
  await settled(job);
  assert.deepEqual(received, { inputMode: "topic", audience: request.audience, targetWords: 150 });
  assert.equal(job.status, "script-ready");
});

test("renderer receives unchanged JSON, reports real progress, and supplies the completed video", async () => {
  const result = parseNarration(request.text);
  let submitted: PipelineResult | undefined;
  let polls = 0;
  const service = new LessonService({
    generate: async () => result,
    pollMs: 1,
    renderer: {
      submit: async (lesson) => { submitted = lesson; return { id: "video-1", status: "queued" }; },
      getStatus: async (id) => { assert.equal(id, "video-1"); polls++; return polls === 1 ? { id, status: "rendering", progress: 50 } : { id, status: "complete", progress: 100, videoUrl: "https://video.example/lesson.mp4" }; },
    },
  });
  const job = service.create(request);
  await settled(job);
  assert.equal(submitted, result);
  assert.equal(job.result, result);
  assert.equal(job.status, "complete");
  assert.equal(job.progress, 100);
  assert.equal(job.videoUrl, "https://video.example/lesson.mp4");
  assert.equal(polls, 2);
});

test("renderer failures and timeouts retain downloadable JSON", async () => {
  for (const status of ["failed", "queued"] as const) {
    const service = new LessonService({ pollMs: 1, renderTimeoutMs: 0, renderer: {
      submit: async () => ({ id: "render", status }), getStatus: async () => ({ id: "render", status }),
    } });
    const job = service.create({ ...request, mode: "script" });
    await settled(job);
    assert.equal(job.status, "failed");
    assert.ok(job.result?.chunks.length);
    assert.equal(job.videoUrl, undefined);
  }
});

test("a sample never contacts AI or the renderer, even when both are configured", async () => {
  const unexpected = async (): Promise<never> => { throw new Error("Unexpected external request"); };
  const service = new LessonService({ generate: unexpected, renderer: { submit: unexpected, getStatus: unexpected } });
  const job = service.create(request, true);
  await settled(job);
  assert.equal(job.status, "script-ready");
  assert.equal(job.demo, true);
  assert.match(job.result!.title, /Mitochondria/);
});

test("concurrent generation is bounded and capacity is released after completion", async () => {
  let finish!: (value: PipelineResult) => void;
  const pending = new Promise<PipelineResult>((resolve) => { finish = resolve; });
  const service = new LessonService({ generate: () => pending });
  const jobs = [service.create(request), service.create(request), service.create(request)];
  assert.throws(() => service.create(request), /busy/);
  finish(parseNarration(request.text));
  await Promise.all(jobs.map(settled));
  assert.doesNotThrow(() => service.create({ ...request, mode: "script" }));
});

test("HTTP renderer uses the exact partner contract and keeps its token server-side", async (t) => {
  const result = parseNarration(request.text);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    calls++;
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer renderer-secret");
    assert.equal(init?.redirect, "error");
    if (calls === 1) {
      assert.equal(url, "http://127.0.0.1:8000/jobs");
      assert.deepEqual(JSON.parse(init?.body as string), result);
      return Response.json({ id: "render/one", status: "queued", secret: "NEVER SEND TO BROWSER" });
    }
    assert.equal(url, "http://127.0.0.1:8000/jobs/render%2Fone");
    return Response.json({ id: "render/one", status: "complete", videoUrl: "https://cdn.example/video.mp4" });
  });
  const renderer = createHttpVideoRenderer("http://127.0.0.1:8000/", "renderer-secret");
  assert.deepEqual(await renderer.submit(result), { id: "render/one", status: "queued" });
  assert.equal((await renderer.getStatus("render/one")).status, "complete");
});

test("renderer rejects unsafe URLs, missing video output, and malformed status", () => {
  for (const value of [null, {}, { id: "1", status: "complete" }, { id: "1", status: "rendering", progress: -1 }, { id: "1", status: "rendering", progress: NaN }, { id: "1", status: "complete", videoUrl: "javascript:alert(1)" }, { id: "1", status: "complete", videoUrl: "https://user:secret@example.com/video.mp4" }]) assert.throws(() => validateRenderTask(value));
  assert.throws(() => createHttpVideoRenderer("http://public.example"), /HTTPS/);
});

test("provider failure is surfaced as a failed job without a made-up result", async () => {
  const service = new LessonService({ generate: async () => { throw new Error("Provider quota reached."); } });
  const job = service.create(request);
  await settled(job);
  assert.equal(job.status, "failed");
  assert.equal(job.error, "Provider quota reached.");
  assert.equal(job.result, undefined);
});
