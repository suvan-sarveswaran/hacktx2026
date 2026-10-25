import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { copyFile, rm } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { entertainify } from "./pipeline.js";
import type { PipelineResult } from "./pipeline.js";
import { parseNarration, RequestError } from "./lesson-service.js";
import { DEFAULT_SETTINGS, DIMENSIONS, ART_STYLES, LEGACY_DOODLE_STYLE } from "./production-settings.js";
import { imageTimeShare, MIN_PLANNED_IMAGE_SHARE, textFirstChunks, VISUAL_PLAN_VERSION } from "./visual-plan.js";
import { planExistingLesson } from "./visual-planner.js";
import type { LessonJob, LessonRequest, ProductionSettings, StageRequest } from "./web-contract.js";

interface ImageEvent { type: string; index?: number; file?: string; error?: string; waitMs?: number }
interface ImageResult { scenes: { status: string; file?: string; error?: string }[]; stoppedReason?: string }
export interface MediaEngine {
  generateImages(prompts: string[], options: { apiKey: string; model: string; seeds?: number[]; outDir: string; width: number; height: number; signal: AbortSignal; concurrency: number; onProgress: (event: ImageEvent) => void }): Promise<ImageResult>;
  synthesizeNarration(script: string, options: { apiKey: string; voiceId: string; model: string; cacheDir: string; signal: AbortSignal }): Promise<{ audioPath: string; alignment: unknown; cached: boolean }>;
  renderVideo(options: { lesson: PipelineResult; alignment: unknown; audioPath: string; mapping: Record<number, string>; fallbackText: boolean; requireImageMajority?: boolean; artStyle?: string; textStyle?: string; width: number; height: number; outputDir: string; signal: AbortSignal; onProgress: (message: string) => void }): Promise<unknown>;
}
async function loadEngine(): Promise<MediaEngine> {
  const directory = resolve(process.cwd(), "studio");
  const [images, video] = await Promise.all([import(pathToFileURL(join(directory, "images.mjs")).href), import(pathToFileURL(join(directory, "video.mjs")).href)]);
  return { generateImages: images.generateImages, synthesizeNarration: video.synthesizeNarration, renderVideo: video.renderVideo };
}
const running = (job: LessonJob) => ["writing", "planning", "images", "voice", "rendering"].includes(job.status);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function requireKey(value: unknown, provider: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 500 || /[\r\n]/.test(value)) throw new RequestError(`Enter your ${provider} API key to continue.`);
  return value.trim();
}
export function validateSettings(input: unknown, current = DEFAULT_SETTINGS): ProductionSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new RequestError("Choose valid production settings.");
  const raw = input as Partial<ProductionSettings>;
  // Pick only public settings: credentials and arbitrary payload fields must never reach disk.
  const settings = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(key => [key, raw[key as keyof ProductionSettings] ?? current[key as keyof ProductionSettings] ?? DEFAULT_SETTINGS[key as keyof ProductionSettings]])) as unknown as ProductionSettings;
  if (!["black-forest-labs/flux.1-schnell", "black-forest-labs/flux.2-klein-4b", "tongyi-mai/z-image-turbo", "openai/gpt-image-1-mini"].includes(settings.imageModel)) throw new RequestError("Choose a supported image model.");
  if (!["auto", "doodle", "vector", "pencil", "cinematic"].includes(settings.textStyle)) throw new RequestError("Choose a text-card style.");
  if (typeof settings.style !== "string" || !settings.style.trim() || settings.style.length > 1000) throw new RequestError("Art direction must contain 1–1,000 characters.");
  if (!Object.hasOwn(DIMENSIONS, settings.imageAspect) || !Object.hasOwn(DIMENSIONS, settings.videoAspect)) throw new RequestError("Choose landscape, square, or portrait.");
  if (typeof settings.voiceId !== "string" || !/^[a-zA-Z0-9_-]{5,100}$/.test(settings.voiceId)) throw new RequestError("Enter a valid ElevenLabs voice ID.");
  if (!["eleven_flash_v2_5", "eleven_multilingual_v2"].includes(settings.model) || typeof settings.fallbackText !== "boolean") throw new RequestError("Choose valid voice and video settings.");
  return settings;
}

/** Durable, key-free project records. Credentials live only in an explicitly started operation. */
export class ProductionService {
  private jobs = new Map<string, LessonJob>();
  private controllers = new Map<string, AbortController>();
  private requests = new Map<string, LessonRequest>();
  private tasks = new Set<Promise<void>>();
  private engine: () => Promise<MediaEngine>;
  private generate: typeof entertainify;
  private plan: typeof planExistingLesson;
  readonly dataDir: string;

  constructor(options: { dataDir?: string; engine?: () => Promise<MediaEngine>; generate?: typeof entertainify; plan?: typeof planExistingLesson } = {}) {
    this.dataDir = resolve(options.dataDir ?? process.env.LESSON_DATA_DIR ?? "output/lessons");
    this.engine = options.engine ?? loadEngine;
    this.generate = options.generate ?? entertainify;
    this.plan = options.plan ?? planExistingLesson;
    mkdirSync(this.dataDir, { recursive: true });
    for (const id of readdirSync(this.dataDir).filter(id => /^[a-f0-9-]{36}$/.test(id))) {
      const file = join(this.dataDir, id, "project.json");
      if (!existsSync(file)) continue;
      const saved = JSON.parse(readFileSync(file, "utf8")) as { job: LessonJob; request: LessonRequest };
      if (saved.job.id !== id) throw new Error(`Invalid saved lesson ${id}.`);
      // Retire the old seeded storyboards without deleting any of their files.
      // Both paths are confined to dataDir by the validated UUID above.
      if (saved.job.demo) {
        const archive = join(this.dataDir, ".retired-samples");
        mkdirSync(archive, { recursive: true });
        renameSync(this.folder(id), join(archive, id));
        continue;
      }
      saved.job.workflow = saved.request.mode === "topic" ? "scratch" : "upload";
      saved.job.recipe = { mode: saved.request.mode, audience: saved.request.audience, targetWords: saved.request.targetWords };
      saved.job.settings = { ...DEFAULT_SETTINGS, ...saved.job.settings };
      this.jobs.set(id, saved.job); this.requests.set(id, saved.request);
      if (running(saved.job)) {
        saved.job.failedStage = saved.job.status === "writing" ? "script" : saved.job.status === "planning" ? "plan" : saved.job.status === "images" ? "images" : "video";
        saved.job.status = "failed"; saved.job.error = "Generation was interrupted by a restart. Continue with your key; saved assets will be reused.";
        this.save(saved.job);
      }
    }
  }
  get(id: string) { return this.jobs.get(id); }
  list() { return [...this.jobs.values()].filter(job => !job.demo).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(job => ({ id: job.id, title: job.result?.title ?? job.sourceText?.slice(0, 80) ?? "New lesson", createdAt: job.createdAt, status: job.status, demo: job.demo, workflow: job.workflow })); }
  private folder(id: string) { return join(this.dataDir, id); }
  private save(job: LessonJob) {
    job.revision = (job.revision ?? 0) + 1;
    const folder = this.folder(job.id); mkdirSync(folder, { recursive: true });
    const temp = join(folder, `${randomUUID()}.tmp`);
    writeFileSync(temp, JSON.stringify({ job, request: this.requests.get(job.id) }, null, 2));
    renameSync(temp, join(folder, "project.json"));
    writeFileSync(join(folder, "source.txt"), job.sourceText ?? "");
    if (job.result) {
      writeFileSync(join(folder, "script.txt"), job.result.script);
      writeFileSync(join(folder, "lesson.json"), JSON.stringify(job.result, null, 2));
    }
  }
  private checkCapacity() { if (this.controllers.size >= 3) throw new RequestError("Three lessons are already running. Try again shortly.", 429); }
  create(request: LessonRequest): LessonJob {
    this.checkCapacity();
    const key = request.mode !== "script" ? requireKey(request.apiKey, "Groq") : "";
    const clean = { text: request.text, mode: request.mode, audience: request.audience, targetWords: request.targetWords };
    const job: LessonJob = { id: randomUUID(), createdAt: new Date().toISOString(), status: "writing", progress: 5, message: "Writing a story worth listening to…", demo: false, workflow: request.mode === "topic" ? "scratch" : "upload", recipe: { mode: request.mode, audience: request.audience, targetWords: request.targetWords }, sourceText: request.text, settings: { ...DEFAULT_SETTINGS }, outputs: [] };
    this.jobs.set(job.id, job); this.requests.set(job.id, clean);
    if (request.mode === "script") {
      job.result = parseNarration(request.text);
      job.result.chunks = textFirstChunks(request.text); job.result.metadata.chunkCount = job.result.chunks.length;
      job.result.visualPlanning = { mode: "text-first", version: VISUAL_PLAN_VERSION };
    }
    if (job.result) { this.scriptReady(job); this.save(job); }
    else { this.save(job); this.run(job, "script", async signal => this.writeScript(job, key, signal)); }
    return job;
  }
  private scriptReady(job: LessonJob) {
    job.status = "script-ready"; job.progress = 30;
    job.message = !job.result?.chunks.some(c => c.renderHint === "image") ? "Your narration is saved. Add a Groq key to plan illustrations before making the final video." : "Your script and visual plan are saved. Choose a look, review the scenes, and generate the illustrations.";
  }
  private async writeScript(job: LessonJob, key: string, signal: AbortSignal) {
    const request = this.requests.get(job.id)!;
    job.result = await this.generate(request.text, { provider: "groq", apiKey: key, planVisuals: true, inputMode: request.mode === "topic" ? "topic" : "material", audience: request.audience, targetWords: request.targetWords });
    if (imageTimeShare(job.result.chunks) < MIN_PLANNED_IMAGE_SHARE) {
      job.status = "planning"; job.message = "Your script is saved. Adding more relevant illustrations before continuing…";
      this.save(job);
      job.result = await this.plan(job.result, { apiKey: key, cacheDir: join(this.folder(job.id), "plan-cache"), signal, initialDelayMs: 61000, onProgress: message => { job.message = message; } });
    }
    this.scriptReady(job);
  }
  private run(job: LessonJob, stage: "script" | "plan" | "images" | "video", work: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController(); this.controllers.set(job.id, controller);
    delete job.error; delete job.failedStage;
    const task = (async () => {
      try { await work(controller.signal); }
      catch (error) {
        job.status = "failed"; job.failedStage = stage === "script" && job.result ? "plan" : stage;
        // Provider helpers intentionally use safe errors, never response bodies or keys.
        job.error = controller.signal.aborted ? "Stopped. Saved images and narration can be reused when you continue." : error instanceof Error ? error.message : "Generation failed. Please try again.";
        job.message = "Your progress is saved. Fix the issue and continue this stage.";
      } finally { this.controllers.delete(job.id); this.save(job); }
    })();
    this.tasks.add(task); void task.finally(() => this.tasks.delete(task)).catch(() => {});
  }
  async close() { for (const controller of this.controllers.values()) controller.abort(); await Promise.allSettled(this.tasks); }
  stop(id: string) {
    const job = this.jobs.get(id); if (!job) throw new RequestError("Lesson not found.", 404);
    this.controllers.get(id)?.abort(); return job;
  }
  async advance(id: string, stage: string, input: StageRequest): Promise<LessonJob> {
    const job = this.jobs.get(id); if (!job) throw new RequestError("Lesson not found.", 404);
    if (running(job)) throw new RequestError("Wait for this stage to finish or stop it first.", 409);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new RequestError("Send stage settings as JSON.");
    if (stage === "script") {
      this.checkCapacity();
      if (job.result) throw new RequestError("The script is already saved.", 409);
      const key = requireKey(input.apiKey, "Groq"); job.status = "writing"; job.progress = 5;
      this.save(job); this.run(job, "script", async signal => this.writeScript(job, key, signal)); return job;
    }
    if (!job.result) throw new RequestError("Generate the script first.", 409);
    if (stage === "plan") {
      this.checkCapacity();
      const key = requireKey(input.apiKey, "Groq");
      const settings = validateSettings(input.settings ?? {}, job.settings);
      // Upgrade only the exact old house preset; leave custom art direction intact.
      if (settings.style === LEGACY_DOODLE_STYLE) settings.style = ART_STYLES.doodle;
      if (job.result.script.length > 10000) throw new RequestError("Start a shorter lesson before planning visuals (10,000 script characters maximum).");
      job.status = "planning"; job.progress = 25; job.message = "Groq is planning illustrations, with text only where there is no useful visual…";
      this.save(job);
      this.run(job, "plan", async signal => {
        const planned = await this.plan(job.result!, { apiKey: key, cacheDir: join(this.folder(id), "plan-cache"), signal, refreshCompleted: true, onProgress: message => { job.message = message; } });
        // Commit a complete plan atomically; old media files and output history remain on disk.
        job.result = planned; job.settings = settings; job.frames = []; job.scenePrompts = {}; this.scriptReady(job);
        job.message = `New visual plan saved: approximately ${Math.round(imageTimeShare(planned.chunks) * 100)}% image time. Generate its illustrations to continue. Previous videos remain in saved versions.`;
      });
      return job;
    }
    if (!["images", "video", "settings"].includes(stage)) throw new RequestError("Unknown production stage.");
    if (stage !== "settings" && (job.result.script.length > 10000 || job.result.chunks.length > 1000)) throw new RequestError("Video production supports up to 10,000 script characters and 1,000 chunks. Start a shorter lesson before spending image or voice credits.");
    const settings = validateSettings(input.settings ?? {}, job.settings);
    const key = stage === "settings" ? "" : requireKey(input.apiKey, stage === "images" ? "Pollinations" : "ElevenLabs");
    if (input.count !== undefined && (!Number.isInteger(input.count) || input.count < 1 || input.count > 1000)) throw new RequestError("Choose 1–1,000 images, or all missing images.");
    if (input.audioOnly !== undefined && typeof input.audioOnly !== "boolean") throw new RequestError("Choose audio only or MP4.");
    if (stage === "video" && !input.audioOnly && !settings.fallbackText && imageTimeShare(job.result.chunks) <= 0.5) throw new RequestError("Images must cover more than half the video. Replan visuals with Groq to add relevant illustrations before creating the MP4.", 409);
    if (input.prompts !== undefined && (!input.prompts || typeof input.prompts !== "object" || Array.isArray(input.prompts))) throw new RequestError("Invalid scene prompts.");
    const prompts: Record<string, string> = { ...job.scenePrompts };
    for (const [index, prompt] of Object.entries(input.prompts ?? {})) {
      if (!job.result.chunks.some(c => String(c.index) === index && c.renderHint === "image") || typeof prompt !== "string" || prompt.length > 1500) throw new RequestError("Scene prompts must reference image chunks and contain at most 1,500 characters.");
      prompts[index] = prompt;
    }
    // Recheck after asynchronous module loading to reject two simultaneous submissions.
    const helpers = await import(pathToFileURL(resolve(process.cwd(), "studio/lesson-images.mjs")).href);
    if (running(job)) throw new RequestError("This lesson is already running.", 409);
    if (stage !== "settings") this.checkCapacity();
    const frames = job.result.chunks.filter(c => c.renderHint === "image").map(chunk => {
      const override = prompts[String(chunk.index)];
      let prompt: string;
      try { prompt = helpers.styledImagePrompt(job.result, { ...chunk, ...(override ? { imagePrompt: override } : {}) }, settings.style, settings.imageAspect) as string; }
      catch (error) { throw new RequestError(error instanceof Error ? error.message : "Please shorten the scene prompt or art direction."); }
      const selected = prompt;
      const seed = Number.parseInt(hash(`scene-v2:${job.result!.script}:${chunk.index}:${selected}`).slice(0, 8), 16) % 2147483647;
      const version = hash(JSON.stringify({ prompt: selected, aspect: settings.imageAspect, model: settings.imageModel, seed }));
      const saved = join(this.folder(id), "frames", `${version}.png`);
      return { chunkIndex: chunk.index, prompt: selected, version, seed, ...(existsSync(saved) ? { imageUrl: `/api/lessons/${id}/assets/frames/${version}.png` } : {}) };
    });
    if (stage === "video" && !input.audioOnly && frames.some(f => !f.imageUrl) && !settings.fallbackText) throw new RequestError("Generate all missing images or enable text cards for a test video.", 409);
    job.settings = settings; job.frames = frames; job.scenePrompts = prompts;
    if (stage === "settings") { this.save(job); return job; }
    job.status = stage === "images" ? "images" : "voice";
    if (stage === "video") job.operation = input.audioOnly ? "audio" : "video";
    job.progress = stage === "images" ? 35 : 75;
    job.message = stage === "images" ? "Drawing your lesson, one scene at a time…" : "Recording the exact script with speech timestamps…";
    this.save(job);
    this.run(job, stage === "images" ? "images" : "video", async signal => {
      const engine = await this.engine();
      if (stage === "images") {
        const selected = frames.filter(f => !f.imageUrl).slice(0, input.count ?? frames.length);
        const outDir = join(this.folder(id), "image-cache");
        // No worker for this project is alive now; recover only its stale lock after a crash.
        await rm(join(outDir, ".batch.lock"), { force: true });
        mkdirSync(join(this.folder(id), "frames"), { recursive: true });
        const pending: Promise<void>[] = [];
        let imageSaveError: unknown;
        const saveImage = async (index: number, file: string) => {
          const frame = selected[index]; if (!frame) return;
          // Normalize JPEG/WebP/GIF provider responses to actual PNG bytes, matching the saved URL.
          const image = await loadImage(join(outDir, file));
          const canvas = createCanvas(image.width, image.height); canvas.getContext("2d").drawImage(image, 0, 0);
          writeFileSync(join(this.folder(id), "frames", `${frame.version}.png`), canvas.toBuffer("image/png"));
          frame.imageUrl = `/api/lessons/${id}/assets/frames/${frame.version}.png`;
          const done = frames.filter(f => f.imageUrl).length;
          job.progress = 35 + Math.round(35 * done / Math.max(1, frames.length));
          job.message = `${done} of ${frames.length} images saved. Each belongs to its own narration chunk.`;
          this.save(job);
        };
        const result = await engine.generateImages(selected.map(f => f.prompt), {
          apiKey: key, model: settings.imageModel, seeds: selected.map(f => f.seed), outDir, ...DIMENSIONS[settings.imageAspect], signal, concurrency: 2,
          onProgress: event => {
            if (event.type === "done" && event.index !== undefined && event.file) pending.push(saveImage(event.index, event.file).catch(error => { imageSaveError ??= error; }));
            if (event.type === "retry") job.message = `Provider is busy. Retrying in ${Math.ceil((event.waitMs ?? 1000) / 1000)} seconds; completed images stay saved.`;
          },
        }).finally(async () => { await Promise.all(pending); });
        if (imageSaveError) throw imageSaveError;
        for (const [index, scene] of result.scenes.entries()) {
          if (scene.status === "done" && scene.file && !selected[index]?.imageUrl) await saveImage(index, scene.file);
        }
        const failed = result.scenes.find(s => s.status !== "done");
        if (failed || result.stoppedReason) throw new Error(result.stoppedReason || failed?.error || "Some images could not finish. Continue to fill only the missing images.");
        job.status = frames.every(f => f.imageUrl) ? "images-ready" : "script-ready";
        job.message = `${frames.filter(f => f.imageUrl).length} of ${frames.length} images saved. ${job.status === "images-ready" ? "Add your ElevenLabs key for the final cut." : "Generate the remaining images when ready."}`;
      } else {
        const voice = await engine.synthesizeNarration(job.result!.script, { apiKey: key, voiceId: settings.voiceId, model: settings.model, cacheDir: join(this.folder(id), "voice-cache"), signal });
        const outputId = randomUUID(), outputDir = join(this.folder(id), "videos", outputId);
        mkdirSync(outputDir, { recursive: true });
        await copyFile(voice.audioPath, join(outputDir, "narration.mp3"));
        const prefix = `/api/lessons/${id}/assets/videos/${outputId}`;
        job.audioUrl = `${prefix}/narration.mp3`;
        this.save(job);
        if (!input.audioOnly) {
          job.status = "rendering"; job.progress = 85;
          job.message = "Assembling your video. The player will be ready when the MP4 is finished…";
          this.save(job);
          await engine.renderVideo({ lesson: job.result!, alignment: voice.alignment, audioPath: voice.audioPath,
            mapping: Object.fromEntries(frames.filter(f => f.imageUrl).map(f => [f.chunkIndex, join(this.folder(id), "frames", `${f.version}.png`)])),
            fallbackText: settings.fallbackText, requireImageMajority: !settings.fallbackText, artStyle: settings.style, textStyle: settings.textStyle, ...DIMENSIONS[settings.videoAspect], outputDir, signal,
            onProgress: message => { job.message = message; },
          });
          job.videoUrl = `${prefix}/video.mp4`; job.timelineUrl = `${prefix}/timeline.json`;
        }
        job.outputs ??= [];
        job.outputs.push({ audioUrl: job.audioUrl, ...(!input.audioOnly ? { videoUrl: job.videoUrl!, timelineUrl: job.timelineUrl! } : {}), createdAt: new Date().toISOString(), label: `${!input.audioOnly && settings.fallbackText ? "Text fallback preview · " : ""}${settings.videoAspect} · ${settings.model}${voice.cached ? " · saved voice reused" : ""}` });
        job.status = input.audioOnly ? "audio-ready" : "complete"; job.progress = input.audioOnly ? 80 : 100;
        job.message = input.audioOnly ? "Voiceover saved. Create the MP4 next; this voice will be reused." : "That’s a wrap! Your video, source text, and script are saved in My lessons.";
      }
    });
    return job;
  }
  assetPath(id: string, asset: string) {
    if (!this.jobs.has(id)) throw new RequestError("Lesson not found.", 404);
    if (!/^(frames\/[a-f0-9]{64}\.png|videos\/[a-f0-9-]{36}\/(video\.mp4|narration\.mp3|timeline\.json))$/.test(asset)) throw new RequestError("Asset not found.", 404);
    return join(this.folder(id), asset);
  }
}
