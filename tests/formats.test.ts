import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { entertainify } from "../src/pipeline.js";
import { comicChunks, readComic } from "../src/comic-plan.js";
import type { ComicPlan } from "../src/comic-plan.js";
import { validateLessonRequest, parseNarration } from "../src/lesson-service.js";
import { ProductionService } from "../src/production-service.js";
import type { MediaEngine } from "../src/production-service.js";
import type { LessonJob, LessonRequest } from "../src/web-contract.js";
import { LessonWorkspace } from "../web/src/lesson-workspace.js";
import { createAppServer } from "../src/server.js";

const request: LessonRequest = { text: "Explain how a leaf makes sugar.", audience: "Students", targetWords: 150, mode: "topic", apiKey: "test-groq" };
const comic: ComicPlan = { title: "A leaf's lunch", continuity: "A single green leaf on a small plant in a purple pot, in a sunny garden.", panels: [
  { caption: "A leaf catches sunlight. Light provides the energy needed to make sugar.", prompt: "Wide view of the green leaf on the potted plant in the garden catching golden rays from the sun above." },
  { caption: "Water travels from the roots to the leaf. The roots take in water from the soil.", prompt: "A cutaway of the purple plant pot reveals blue water droplets traveling from roots up the stem to the leaf." },
  { caption: "The leaf takes in carbon dioxide from the air through tiny openings called stomata.", prompt: "Close view of a green leaf surface with tiny open pores, and clusters of three spheres entering from the air." },
  { caption: "Using light energy, the leaf makes sugar from water and carbon dioxide. Oxygen is released.", prompt: "The green leaf in the same purple potted plant, with a small pile of sugar cubes nearby as a visual analogy and oxygen pairs leaving." },
] };
const result = () => { const base = parseNarration(comic.panels.map(p => p.caption).join(" "), comic.title); const chunks = comicChunks(comic); return { ...base, comic, chunks, metadata: { ...base.metadata, chunkCount: chunks.length } }; };
async function settled(job: LessonJob) { for (let i = 0; i < 500 && ["writing", "planning", "images", "voice", "rendering"].includes(job.status); i++) await delay(10); assert.notEqual(job.status, "failed", job.error); }

test("format validation rejects mismatched gameplay, malformed panels and comic script bypass", () => {
  assert.equal(validateLessonRequest({ ...request, format: "short", brainrot: true }).brainrot, true);
  for (const extra of [{ format: "bad" }, { format: "youtube", brainrot: true }, { format: "comic", comicPanels: 5 }, { format: "comic", mode: "script" }, { brainrot: "yes" }]) assert.throws(() => validateLessonRequest({ ...request, ...extra }));
  assert.equal(readComic(comic, 4).panels.length, 4);
  assert.throws(() => readComic(comic, 6), /incomplete/);
  assert.throws(() => readComic({ ...comic, panels: [comic.panels[0], comic.panels[0], ...comic.panels.slice(2)] }, 4), /repeated/);
  assert.throws(() => readComic({ ...comic, panels: comic.panels.map(p => ({ ...p, caption: "x".repeat(241) })) }, 4), /concise/);
});

test("one structured Groq response produces complete comic panels without video chunk splitting", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    calls++; const body = JSON.parse(init.body as string);
    assert.equal(body.response_format.json_schema.name, "educational_comic");
    assert.match(body.messages[0].content, /exactly 4 panels/);
    assert.match(body.messages[0].content, /typeset separately/);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(comic) } }] });
  });
  const lesson = await entertainify(request.text, { provider: "groq", apiKey: "test", comicPanels: 4, planVisuals: true });
  assert.equal(calls, 1); assert.equal(lesson.chunks.length, 4);
  lesson.chunks.forEach((chunk, i) => { assert.equal(chunk.text, comic.panels[i]!.caption); assert.equal(lesson.script.slice(chunk.startOffset, chunk.endOffset), chunk.text); assert.match(chunk.imagePrompt!, /CONTINUITY|continuity/i); });
});

test("three format jobs and browser selections stay independent and survive restart", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "formats-")); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const modes: string[] = [];
  const service = new ProductionService({ dataDir, generate: async (_text, options) => { modes.push(options!.inputMode!); await delay(20); return options?.comicPanels ? result() : parseNarration("A leaf catches sunlight."); } });
  const storage = new Map<string, string>();
  const adapter = { create: async (r: LessonRequest) => service.create(r), lesson: async (id: string) => service.get(id)!, list: async () => service.list() };
  const persistence = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } };
  const workspace = new LessonWorkspace(adapter, persistence);
  await Promise.all((["youtube", "short", "comic"] as const).map(format => workspace.create(format, { ...request, format, mode: format === "youtube" ? "material" : "topic", brainrot: format === "short", comicPanels: 4 })));
  assert.equal(service.list().length, 3); assert.deepEqual(modes.sort(), ["material", "topic", "topic"]);
  const selected = workspace.snapshot().selected;
  assert.equal(new Set([selected.youtube, selected.short, selected.comic]).size, 3);
  const jobs = [selected.youtube, selected.short, selected.comic].map(id => service.get(id!)!); await Promise.all(jobs.map(settled));
  assert.equal(jobs[0]!.settings!.videoAspect, "landscape"); assert.equal(jobs[1]!.settings!.videoAspect, "portrait"); assert.equal(jobs[1]!.settings!.imageAspect, "square");
  await service.advance(jobs[0]!.id, "settings", { settings: { videoAspect: "square", imageAspect: "portrait", brainrot: true } });
  assert.equal(jobs[0]!.settings!.videoAspect, "landscape"); assert.equal(jobs[0]!.settings!.brainrot, false);
  await service.advance(jobs[1]!.id, "settings", { settings: { brainrot: false, videoAspect: "landscape" } });
  assert.equal(jobs[1]!.settings!.imageAspect, "portrait"); assert.equal(jobs[1]!.settings!.videoAspect, "portrait");
  await service.close();
  const restored = new ProductionService({ dataDir }); t.after(() => restored.close());
  for (const job of jobs) assert.equal(restored.get(job.id)!.workflow, job.workflow);
  assert.deepEqual(new LessonWorkspace(adapter, persistence).snapshot().selected, selected);
});

test("comic images, local page, saved editions and HTTP downloads work without voice credits", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "comic-output-")); t.after(() => rm(dataDir, { recursive: true, force: true }));
  let images = 0;
  const engine: MediaEngine = {
    async generateImages(prompts, options) {
      assert.equal(options.width, 1280); assert.equal(options.height, 720);
      await mkdir(options.outDir, { recursive: true });
      const scenes = [];
      for (const [index, prompt] of prompts.entries()) {
        assert.ok(prompt.length < 4000); assert.match(prompt, /purple pot/); assert.doesNotMatch(prompt, /"panels":/);
        const canvas = createCanvas(1280, 720), ctx = canvas.getContext("2d"); ctx.fillStyle = ["#c8d8ee", "#d0dfb9", "#f4c85e", "#ef9c82"][index % 4]!; ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = "#6d5896"; ctx.fillRect(560, 400, 160, 180); ctx.fillStyle = "#508050"; ctx.beginPath(); ctx.ellipse(640, 270, 130, 65, -.5, 0, 2 * Math.PI); ctx.fill();
        const file = `${images++}.png`; await writeFile(join(options.outDir, file), canvas.toBuffer("image/png")); scenes.push({ status: "done", file });
      }
      return { scenes };
    },
    async synthesizeNarration() { throw new Error("Comics must not use voice credits"); },
    async renderVideo() { throw new Error("Comics must not render video"); },
  };
  const service = new ProductionService({ dataDir, engine: async () => engine, generate: async () => result() });
  const job = service.create({ ...request, format: "comic", comicPanels: 4 }); await settled(job);
  await assert.rejects(service.advance(job.id, "comic", {}), /every panel/);
  await assert.rejects(service.advance(job.id, "video", { apiKey: "test" }), /comic storyboard/);
  await service.advance(job.id, "images", { apiKey: "test-image", count: 1 }); await settled(job); assert.equal(images, 1);
  await service.advance(job.id, "images", { apiKey: "test-image" }); await settled(job); assert.equal(images, 4);
  await service.advance(job.id, "comic", {}); await settled(job);
  assert.equal(job.status, "complete"); assert.equal(job.audioUrl, undefined);
  const first = job.comicUrl!;
  const bytes = await readFile(service.assetPath(job.id, first.split("/assets/")[1]!));
  const page = await loadImage(bytes); assert.equal(page.width, 1600); assert.ok(page.height > 1200);
  if (process.env.SAVE_FORMAT_QA) { await mkdir("output/format-qa", { recursive: true }); await writeFile("output/format-qa/comic.png", bytes); }
  await service.advance(job.id, "comic", {}); await settled(job); assert.equal(job.comicOutputs!.length, 2); assert.equal(job.comicOutputs![0]!.url, first); assert.equal(job.comicOutputs![0]!.panels!.length, 4);
  assert.doesNotMatch(await readFile(join(dataDir, job.id, "project.json"), "utf8"), /test-groq|test-image|apiKey/);
  await service.close();
  const restored = new ProductionService({ dataDir }); assert.equal(restored.get(job.id)!.comicOutputs!.length, 2);
  const server = await createAppServer(false, restored, { localOnly: true }); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${address.port}${first}`); assert.equal(response.headers.get("content-type"), "image/png"); assert.equal((await response.arrayBuffer()).byteLength, bytes.length);
});

test("gameplay upload validates MP4, stays with its lesson, and survives restart", async t => {
  const dataDir = await mkdtemp(join(tmpdir(), "gameplay-upload-")); t.after(() => rm(dataDir, { recursive: true, force: true }));
  const video = await import(pathToFileURL(join(process.cwd(), "studio/video.mjs")).href);
  await video.runFfmpeg(["-f", "lavfi", "-i", "color=c=blue:s=320x240:d=0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "clip.mp4"], { cwd: dataDir });
  const bytes = await readFile(join(dataDir, "clip.mp4"));
  const service = new ProductionService({ dataDir });
  const first = service.create({ ...request, format: "short", mode: "script", brainrot: true });
  const second = service.create({ ...request, format: "short", mode: "script" });
  await assert.rejects(service.uploadGameplay(first.id, Buffer.from("invalid")), /could not be read/);
  assert.equal(first.gameplayClip, undefined);
  const server = await createAppServer(false, service, { localOnly: true }); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address === "object"); const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${base}/api/lessons/${first.id}/clip`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: bytes })).status, 415);
    const uploaded = await fetch(`${base}/api/lessons/${first.id}/clip`, { method: "POST", headers: { "Content-Type": "video/mp4" }, body: bytes });
    assert.equal(uploaded.status, 200); assert.match(first.gameplayClip!, /^clips\/[a-f0-9-]+\.mp4$/); assert.equal(second.gameplayClip, undefined);
    const download = await fetch(`${base}/api/lessons/${first.id}/assets/${first.gameplayClip}`, { headers: { Range: "bytes=0-31" } });
    assert.equal(download.status, 206); assert.equal(download.headers.get("content-type"), "video/mp4"); assert.equal((await download.arrayBuffer()).byteLength, 32);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  const restored = new ProductionService({ dataDir }); t.after(() => restored.close());
  assert.equal(restored.get(first.id)!.gameplayClip, first.gameplayClip);
});
