import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { ProductionService, validateSettings } from "../src/production-service.js";
import type { MediaEngine } from "../src/production-service.js";
import { parseNarration } from "../src/lesson-service.js";
import { createAppServer } from "../src/server.js";
import type { LessonJob, LessonRequest } from "../src/web-contract.js";
import { chunksFromBeats, imageTimeShare, textFirstChunks, VISUAL_PLAN_VERSION } from "../src/visual-plan.js";
import { ART_STYLES, LEGACY_DOODLE_STYLE } from "../src/production-settings.js";
import { validateLessonRequest } from "../src/lesson-service.js";

const request: LessonRequest = { text: "A leaf catches sunlight. Water feeds the roots. Sugar powers the plant.", mode: "material", audience: "Students", targetWords: 150, apiKey: "groq-secret" };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
async function settled(job: LessonJob) {
  for (let i = 0; i < 400 && ["writing", "planning", "images", "voice", "rendering"].includes(job.status); i++) await delay(10);
  assert.ok(!["writing", "planning", "images", "voice", "rendering"].includes(job.status), "job settles");
}
function fakeEngine() {
  const calls = { images: 0, voice: 0, render: 0, script: "", prompts: [] as string[], width: 0, height: 0, mapping: {} as Record<number, string> };
  const voices = new Set<string>();
  const engine: MediaEngine = {
    async generateImages(prompts, options) {
      assert.equal(options.apiKey, "image-secret"); calls.prompts.push(...prompts); calls.width = options.width; calls.height = options.height;
      assert.equal(options.seeds?.length, prompts.length); assert.equal(new Set(options.seeds).size, prompts.length);
      await mkdir(join(options.outDir, "assets"), { recursive: true });
      const scenes = [];
      for (const [index] of prompts.entries()) {
        options.signal.throwIfAborted();
        const file = `assets/${++calls.images}.png`; await writeFile(join(options.outDir, file), png);
        options.onProgress({ type: "done", index, file }); scenes.push({ status: "done", file });
      }
      return { scenes };
    },
    async synthesizeNarration(script, options) {
      assert.equal(options.apiKey, "voice-secret"); calls.script = script;
      const cacheKey = JSON.stringify([script, options.voiceId, options.model]); const cached = voices.has(cacheKey);
      if (!cached) { calls.voice++; voices.add(cacheKey); }
      await mkdir(options.cacheDir, { recursive: true });
      const audioPath = join(options.cacheDir, "fixture.mp3"); await writeFile(audioPath, "test-audio");
      return { audioPath, alignment: {}, cached };
    },
    async renderVideo(options) {
      assert.equal(options.captions, true, "every video includes captions on image scenes");
      assert.equal(options.requireImageMajority, !options.fallbackText);
      calls.render++; calls.mapping = options.mapping;
      options.onProgress("Encoding MP4"); await writeFile(join(options.outputDir, "video.mp4"), "0123456789video");
      await writeFile(join(options.outputDir, "timeline.json"), JSON.stringify({ fps: 30 }));
    },
  };
  return { engine, calls };
}

test("short-form uses bundled Subway Surfers by default and preserves uploaded overrides", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "entertainify-default-clip-")); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const { engine } = fakeEngine(); const renders: Parameters<MediaEngine["renderVideo"]>[0][] = [];
  const render = engine.renderVideo; engine.renderVideo = async options => { renders.push(options); return render(options); };
  const service = new ProductionService({ dataDir, engine: async () => engine }); t.after(() => service.close());
  const job = service.create({ ...request, format: "short", mode: "script", brainrot: true });
  await service.advance(job.id, "video", { apiKey: "voice-secret", settings: { fallbackText: true } }); await settled(job);
  assert.equal(job.status, "complete", job.error); assert.equal(renders[0]!.gameplayPath, join(process.cwd(), "subway_surfers.mp4"));
  assert.equal(renders[0]!.gameplaySource, "subway-surfers"); assert.match(job.outputs![0]!.label!, /Subway Surfers/);
  job.gameplayClip = "clips/11111111-1111-1111-1111-111111111111.mp4";
  await service.advance(job.id, "video", { apiKey: "voice-secret" }); await settled(job);
  assert.equal(renders[1]!.gameplayPath, service.assetPath(job.id, job.gameplayClip)); assert.equal(renders[1]!.gameplaySource, "uploaded");
  await service.advance(job.id, "video", { apiKey: "voice-secret", settings: { brainrot: false } }); await settled(job);
  assert.equal(renders[2]!.gameplayPath, undefined);
});

test("staged production gates keys, maps unique portrait images, retains source/script/video and resumes after restart", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "entertainify-production-")); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const { engine, calls } = fakeEngine();
  const service = new ProductionService({ dataDir, engine: async () => engine, generate: async (source, options) => {
    assert.equal(source, request.text); assert.equal(options?.apiKey, "groq-secret"); assert.equal(options.provider, "groq"); assert.equal(options.planVisuals, true);
    return parseNarration(request.text, "Plant power");
  } });
  assert.throws(() => service.create({ ...request, apiKey: "" }), /Groq/);
  const job = service.create(request); await settled(job); assert.equal(job.status, "script-ready");
  assert.equal(calls.images, 0); assert.equal(calls.voice, 0);
  await assert.rejects(service.advance(job.id, "images", {}), /Pollinations/);
  await assert.rejects(service.advance(job.id, "video", { apiKey: "voice-secret" }), /missing images/);
  await service.advance(job.id, "images", { apiKey: "image-secret", count: 1, settings: { imageAspect: "portrait", videoAspect: "portrait" } }); await settled(job);
  assert.equal(calls.images, 1); assert.equal(calls.width, 720); assert.equal(calls.height, 1280);
  assert.match(calls.prompts[0]!, /9:16/); assert.match(calls.prompts[0]!, /Nearby narration/);
  await service.advance(job.id, "images", { apiKey: "image-secret" }); await settled(job);
  const imageCount = job.result!.chunks.filter(c => c.renderHint === "image").length;
  assert.equal(calls.images, imageCount); assert.equal(new Set(calls.prompts).size, imageCount); assert.equal(job.status, "images-ready");
  await service.advance(job.id, "video", { apiKey: "voice-secret", audioOnly: true }); await settled(job); assert.equal(job.status, "audio-ready");
  await service.advance(job.id, "video", { apiKey: "voice-secret" }); await settled(job);
  assert.equal(job.status, "complete", job.error); assert.equal(calls.voice, 1); assert.equal(calls.render, 1);
  assert.equal(Object.keys(calls.mapping).length, imageCount); assert.equal(calls.script, job.result!.script);
  assert.equal(await readFile(join(dataDir, job.id, "source.txt"), "utf8"), request.text);
  assert.equal(await readFile(join(dataDir, job.id, "script.txt"), "utf8"), job.result!.script);
  const saved = await readFile(join(dataDir, job.id, "project.json"), "utf8"); assert.doesNotMatch(saved, /groq-secret|image-secret|voice-secret|apiKey/);
  await service.close();
  const restored = new ProductionService({ dataDir, engine: async () => engine }); t.after(() => restored.close());
  assert.deepEqual(restored.get(job.id), job); assert.equal(restored.list()[0]!.title, "Plant power");
  const video = restored.assetPath(job.id, job.videoUrl!.split("/assets/")[1]!); assert.equal(await readFile(video, "utf8"), "0123456789video");
  await restored.advance(job.id, "settings", { settings: { imageAspect: "square" } }); assert.equal(restored.get(job.id)!.frames!.filter(f => f.imageUrl).length, 0);
  await restored.advance(job.id, "settings", { settings: { imageAspect: "portrait" } }); assert.equal(restored.get(job.id)!.frames!.filter(f => f.imageUrl).length, imageCount);
});

test("failed video retries reuse completed images and cached narration; concurrent stage requests do not double charge", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "entertainify-retry-")); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const { engine, calls } = fakeEngine(); const render = engine.renderVideo; let fail = true;
  engine.renderVideo = async options => { if (fail) { fail = false; throw new Error("Test encoder failed"); } return render(options); };
  const service = new ProductionService({ dataDir, engine: async () => engine, generate: async () => parseNarration(request.text) }); t.after(() => service.close());
  const job = service.create(request); await settled(job);
  const simultaneous = await Promise.allSettled([service.advance(job.id, "images", { apiKey: "image-secret" }), service.advance(job.id, "images", { apiKey: "image-secret" })]);
  assert.equal(simultaneous.filter(r => r.status === "rejected").length, 1); await settled(job);
  const count = calls.images;
  await service.advance(job.id, "video", { apiKey: "voice-secret" }); await settled(job); assert.equal(job.status, "failed"); assert.ok(job.audioUrl);
  await service.advance(job.id, "video", { apiKey: "voice-secret" }); await settled(job); assert.equal(job.status, "complete");
  assert.equal(calls.voice, 1); assert.equal(calls.images, count);
});

test("durable API lists lessons, downloads text, streams MP4 ranges and rejects traversal and cross-origin actions", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "entertainify-http-")); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const { engine } = fakeEngine(); const service = new ProductionService({ dataDir, engine: async () => engine });
  const job = service.create({ ...request, mode: "script" });
  await service.advance(job.id, "video", { apiKey: "voice-secret", settings: { fallbackText: true } }); await settled(job);
  const server = await createAppServer(false, service, { localOnly: true }); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address === "object"); const base = `http://127.0.0.1:${address.port}`;
  assert.equal((await (await fetch(`${base}/api/lessons`)).json() as unknown[]).length, 1);
  assert.equal(await (await fetch(`${base}/api/lessons/${job.id}/source`)).text(), request.text);
  const partial = await fetch(base + job.videoUrl!, { headers: { Range: "bytes=2-5" } }); assert.equal(partial.status, 206); assert.equal(await partial.text(), "2345");
  assert.equal((await fetch(base + job.videoUrl!, { headers: { Range: "bytes=999-" } })).status, 416);
  assert.equal((await fetch(`${base}/api/lessons/${job.id}/assets/project.json`)).status, 404);
  assert.equal((await fetch(`${base}/api/lessons/${job.id}/images`, { method: "POST", headers: { Origin: "https://bad.example", "Content-Type": "application/json" }, body: "{}" })).status, 403);
});

test("settings validate all options and discard unknown fields", () => {
  assert.throws(() => validateSettings({ imageAspect: "__proto__" }), /landscape/);
  assert.throws(() => validateSettings({ voiceId: "../secret" }), /voice ID/);
  assert.throws(() => validateSettings({ fallbackText: "yes" }), /settings/);
  assert.equal("apiKey" in validateSettings({ apiKey: "secret" }), false);
  assert.throws(() => validateSettings({ imageModel: "unknown-provider/model" }), /image model/);
  assert.throws(() => validateSettings({ textStyle: "unknown" }), /text-card/);
});

test("replanning through the API keeps narration and prior videos, then saves a new visual plan", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "entertainify-plan-stage-")); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const { engine, calls } = fakeEngine(); let fail = true;
  const service = new ProductionService({ dataDir, engine: async () => engine, plan: async (lesson, options) => {
    assert.equal(options.apiKey, "plan-secret");
    if (fail) throw new Error("Test planning interruption");
    const chunks = chunksFromBeats(lesson.script, [
      { narration: "A leaf catches sunlight. Water feeds the roots.", kind: "image", prompt: "A cutaway plant receiving golden sunlight, with blue water rising through its roots to a single green leaf.", caption: "" },
      { narration: "Sugar powers the plant.", kind: "text", prompt: "", caption: "Energy stored in sugar" },
    ]);
    return { ...lesson, chunks, visualPlanning: { mode: "groq", version: VISUAL_PLAN_VERSION }, metadata: { ...lesson.metadata, chunkCount: chunks.length } };
  } });
  const job = service.create({ ...request, mode: "script" });
  assert.ok(job.result!.chunks.every(c => c.renderHint === "text"));
  await service.advance(job.id, "video", { apiKey: "voice-secret", settings: { fallbackText: true } }); await settled(job);
  const previous = job.videoUrl!, original = structuredClone(job.result);
  await service.advance(job.id, "settings", { settings: { style: LEGACY_DOODLE_STYLE } });
  const server = await createAppServer(false, service, { localOnly: true }); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/api/lessons/${job.id}/plan`;
  const post = (apiKey: string) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) });
  assert.equal((await post("")).status, 400);
  assert.equal((await post("plan-secret")).status, 202); await settled(job);
  assert.equal(job.failedStage, "plan"); assert.deepEqual(job.result, original);
  fail = false;
  assert.equal((await post("plan-secret")).status, 202); await settled(job);
  assert.equal(job.status, "script-ready"); assert.equal(job.result!.script, request.text);
  assert.equal(job.settings!.style, ART_STYLES.doodle);
  assert.equal(job.result!.chunks[1]!.displayText, "Energy stored in sugar");
  assert.equal(job.outputs![0]!.videoUrl, previous); assert.equal(job.frames!.length, 0);
  assert.equal(await readFile(service.assetPath(job.id, previous.split("/assets/")[1]!), "utf8"), "0123456789video");
  await service.advance(job.id, "images", { apiKey: "image-secret", settings: { imageModel: "black-forest-labs/flux.2-klein-4b" } }); await settled(job);
  await service.advance(job.id, "video", { apiKey: "voice-secret", settings: { textStyle: "cinematic", fallbackText: false } }); await settled(job);
  assert.equal(job.status, "complete"); assert.equal(calls.voice, 1); assert.equal(job.outputs!.length, 2);
  const saved = await readFile(join(dataDir, job.id, "project.json"), "utf8"); assert.ok(!saved.includes("plan-secret"));
});

test("oversized narration cannot spend image or voice credits", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "entertainify-limits-")); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const { engine, calls } = fakeEngine(); const service = new ProductionService({ dataDir, engine: async () => engine }); t.after(() => service.close());
  const job = service.create({ ...request, mode: "script", text: "Leaf. ".repeat(1700) });
  await assert.rejects(service.advance(job.id, "images", { apiKey: "image-secret" }), /shorter lesson/);
  await assert.rejects(service.advance(job.id, "video", { apiKey: "voice-secret", audioOnly: true }), /shorter lesson/);
  assert.equal(calls.images, 0); assert.equal(calls.voice, 0);
});

test("the integrated pipeline produces a real playable MP4 with the shared FFmpeg renderer", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "entertainify-real-video-")); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const { engine } = fakeEngine();
  const videoModule = await import(pathToFileURL(join(process.cwd(), "studio/video.mjs")).href);
  engine.renderVideo = videoModule.renderVideo;
  engine.synthesizeNarration = async (script, options) => {
    await mkdir(options.cacheDir, { recursive: true });
    const audioPath = join(options.cacheDir, "test.wav"), samples = 48000;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i / 48000 * 440 * Math.PI * 2) * 8000), 44 + i * 2);
    await writeFile(audioPath, wav);
    return { audioPath, cached: false, alignment: { characters: script.split(""), character_start_times_seconds: [...script].map((_, i) => i / script.length * .9), character_end_times_seconds: [...script].map((_, i) => (i + 1) / script.length * .9) } };
  };
  const service = new ProductionService({ dataDir, engine: async () => engine, generate: async source => parseNarration(source) }); t.after(() => service.close());
  const job = service.create({ ...request, text: "Leaf. Water." }); await settled(job);
  await service.advance(job.id, "images", { apiKey: "image-secret" }); await settled(job);
  await service.advance(job.id, "video", { apiKey: "voice-secret" }); await settled(job);
  assert.equal(job.status, "complete", job.error);
  const bytes = await readFile(service.assetPath(job.id, job.videoUrl!.split("/assets/")[1]!));
  assert.equal(bytes.toString("ascii", 4, 8), "ftyp"); assert.ok(bytes.length > 1000);
  const timeline = JSON.parse(await readFile(service.assetPath(job.id, job.timelineUrl!.split("/assets/")[1]!), "utf8"));
  assert.ok(timeline.imageTimeShare > 0.5);
});

test("text-heavy generated stories retain their script while automatically repairing and resuming the visual plan", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "entertainify-image-repair-")); t.after(() => rm(dataDir, { recursive: true, force: true }));
  let generations = 0, plans = 0;
  const service: ProductionService = new ProductionService({ dataDir, generate: async source => {
    generations++;
    const lesson = parseNarration(source); lesson.chunks = textFirstChunks(source); return lesson;
  }, plan: async (lesson, options) => {
    plans++;
    assert.equal(await readFile(join(dataDir, service.list()[0]!.id, "script.txt"), "utf8"), lesson.script);
    if (plans === 1) { assert.equal(options.initialDelayMs, 61000); throw new Error("Test quota reached"); }
    const chunks = chunksFromBeats(lesson.script, textFirstChunks(lesson.script).map(chunk => ({ narration: chunk.text, kind: "image", prompt: `A cutaway plant showing: ${chunk.text}`, caption: "" })));
    return { ...lesson, chunks, visualPlanning: { mode: "groq", version: VISUAL_PLAN_VERSION } };
  } }); t.after(() => service.close());
  const job = service.create(request); await settled(job);
  assert.equal(job.failedStage, "plan"); assert.equal(job.result!.script, request.text);
  await service.advance(job.id, "plan", { apiKey: "groq-secret" }); await settled(job);
  assert.equal(job.status, "script-ready"); assert.equal(generations, 1); assert.equal(plans, 2);
  assert.equal(imageTimeShare(job.result!.chunks), 1);
});

test("a majority of short image scenes cannot bypass the image-time minimum or spend voice credits", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "entertainify-image-minimum-")); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const { engine, calls } = fakeEngine();
  const service = new ProductionService({ dataDir, engine: async () => engine }); t.after(() => service.close());
  const job = service.create({ ...request, mode: "script", text: "Leaf. Water. Energy is conserved as it moves between different forms." });
  job.result!.chunks = chunksFromBeats(job.result!.script, [
    { narration: "Leaf.", kind: "image", prompt: "A green leaf.", caption: "" },
    { narration: "Water.", kind: "image", prompt: "A water droplet.", caption: "" },
    { narration: "Energy is conserved as it moves between different forms.", kind: "text", prompt: "", caption: "Energy changes form" },
  ]);
  await assert.rejects(service.advance(job.id, "video", { apiKey: "voice-secret" }), /more than half/);
  assert.equal(calls.voice, 0); assert.equal(calls.render, 0);
  await service.advance(job.id, "video", { apiKey: "voice-secret", audioOnly: true }); await settled(job);
  assert.equal(job.status, "audio-ready");
  await service.advance(job.id, "video", { apiKey: "voice-secret", settings: { fallbackText: true } }); await settled(job);
  assert.equal(job.status, "complete"); assert.equal(calls.voice, 1);
  assert.match(job.outputs!.at(-1)!.label, /Text fallback preview/);
});

test("interrupted stages recover on restart and custom prompts survive style changes", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "entertainify-recover-")); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const service = new ProductionService({ dataDir, generate: async () => parseNarration(request.text) });
  const job = service.create(request); await settled(job);
  const index = String(job.result!.chunks.find(c => c.renderHint === "image")!.index);
  await service.advance(job.id, "settings", { prompts: { [index]: "A leaf using a tiny solar panel" } });
  await service.advance(job.id, "settings", { settings: { style: "Blue pencil drawing" } });
  assert.match(job.frames!.find(f => String(f.chunkIndex) === index)!.prompt, /tiny solar panel/);
  const file = join(dataDir, job.id, "project.json"); const record = JSON.parse(await readFile(file, "utf8"));
  record.job.status = "images"; await writeFile(file, JSON.stringify(record));
  await service.close(); const recovered = new ProductionService({ dataDir }); t.after(() => recovered.close());
  assert.equal(recovered.get(job.id)!.status, "failed"); assert.equal(recovered.get(job.id)!.failedStage, "images");
  assert.match(recovered.get(job.id)!.error!, /restart/); assert.equal(recovered.get(job.id)!.sourceText, request.text);
});

test("legacy sample records are retired once, while real lessons retain their workflow and recipe", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "entertainify-samples-")); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const original = new ProductionService({ dataDir });
  const sample = original.create({ ...request, mode: "script" });
  const real = original.create({ ...request, mode: "script", targetWords: 75 });
  await original.close();
  const path = join(dataDir, sample.id, "project.json");
  const record = JSON.parse(await readFile(path, "utf8")); record.job.demo = true;
  await writeFile(path, JSON.stringify(record));
  const restored = new ProductionService({ dataDir });
  assert.deepEqual(restored.list().map(row => row.id), [real.id]);
  assert.equal(restored.get(sample.id), undefined);
  assert.equal(restored.get(real.id)!.workflow, "upload");
  assert.equal(restored.get(real.id)!.recipe!.targetWords, 75);
  assert.equal(JSON.parse(await readFile(join(dataDir, ".retired-samples", sample.id, "project.json"), "utf8")).job.demo, true);
  await restored.close();
  const again = new ProductionService({ dataDir }); t.after(() => again.close());
  assert.equal(again.list().length, 1);
  const server = await createAppServer(false, again, { localOnly: true });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise<void>(done => server.close(() => done())));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing server address");
  assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/demo`, { method: "POST" })).status, 410);
  assert.equal(again.list().length, 1);
});

test("30-second topics and uploads remain separate across concurrent writing and restart", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "entertainify-concurrent-")); t.after(() => rm(dataDir, { recursive: true, force: true }));
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const service = new ProductionService({ dataDir, generate: async (source, options) => {
    assert.equal(options?.targetWords, 75); await gate; return parseNarration(source);
  } });
  const upload = service.create(validateLessonRequest({ ...request, targetWords: 75 }));
  const topic = service.create(validateLessonRequest({ ...request, mode: "topic", targetWords: 75 }));
  assert.equal(service.list().length, 2);
  assert.equal(upload.status, "writing"); assert.equal(topic.status, "writing");
  assert.equal(upload.workflow, "upload"); assert.equal(topic.workflow, "scratch");
  finish(); await settled(upload); await settled(topic); await service.close();
  const restored = new ProductionService({ dataDir }); t.after(() => restored.close());
  assert.equal(restored.get(topic.id)!.workflow, "scratch");
  assert.equal(restored.get(upload.id)!.recipe!.targetWords, 75);
  assert.equal(restored.get(topic.id)!.status, "script-ready");
});

test("a pending MP4 stays rendering until finished and output versions keep their own voice and timings", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "entertainify-premiere-")); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const { engine } = fakeEngine();
  let finish!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const rendering = new Promise<void>(resolve => { entered = resolve; });
  const render = engine.renderVideo;
  engine.renderVideo = async options => { entered(); await gate; await render(options); };
  const service = new ProductionService({ dataDir, engine: async () => engine }); t.after(() => service.close());
  const lesson = service.create({ ...request, mode: "script" });
  await service.advance(lesson.id, "video", { apiKey: "voice-secret", settings: { fallbackText: true } });
  await rendering;
  assert.equal(lesson.status, "rendering"); assert.equal(lesson.operation, "video");
  assert.ok(lesson.audioUrl); assert.equal(lesson.videoUrl, undefined); assert.equal(lesson.outputs!.length, 0);
  finish(); await settled(lesson);
  const video = structuredClone(lesson.outputs![0]!);
  assert.equal(video.videoUrl, lesson.videoUrl); assert.equal(video.timelineUrl, lesson.timelineUrl);
  await service.advance(lesson.id, "video", { apiKey: "voice-secret", audioOnly: true }); await settled(lesson);
  assert.equal(lesson.operation, "audio"); assert.equal(lesson.status, "audio-ready");
  assert.notEqual(lesson.audioUrl, video.audioUrl);
  assert.deepEqual(lesson.outputs![0], video); assert.equal(lesson.outputs![1]!.videoUrl, undefined);
});
