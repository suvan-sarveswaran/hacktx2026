import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { chunkScript } from "./chunker.js";
import { MAX_SOURCE_CHARACTERS } from "./generator.js";
import { entertainify } from "./pipeline.js";
import type { PipelineResult } from "./pipeline.js";
import type { LessonJob, LessonRequest } from "./web-contract.js";
import { validateRenderTask } from "./video-renderer.js";
import type { VideoRenderer } from "./video-renderer.js";

export class RequestError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}

export function validateLessonRequest(value: unknown): LessonRequest {
  if (!value || typeof value !== "object") throw new RequestError("Please add your lesson text.");
  const body = value as Record<string, unknown>;
  if (typeof body.text !== "string" || !body.text.trim()) throw new RequestError("Your page is blank. Add a little knowledge first!");
  if (body.text.length > MAX_SOURCE_CHARACTERS) throw new RequestError("This lesson is a little too big. Please keep it under 80,000 characters.");
  if (!["material", "topic", "script"].includes(String(body.mode))) throw new RequestError("Choose a text upload, topic, or existing script.");
  if (typeof body.audience !== "string" || !body.audience.trim() || body.audience.length > 300) throw new RequestError("Choose an audience (1–300 characters).");
  if (typeof body.targetWords !== "number" || !Number.isInteger(body.targetWords) || body.targetWords < 50 || body.targetWords > 2000) throw new RequestError("Script length must be between 50 and 2,000 words.");
  return { text: body.text.trim(), mode: body.mode as LessonRequest["mode"], audience: body.audience.trim(), targetWords: body.targetWords };
}

export function parseNarration(script: string, title = "Your original narration"): PipelineResult {
  const start = performance.now();
  const chunks = chunkScript(script);
  return {
    title, script, chunks,
    metadata: {
      provider: "none", model: "none", generationMs: 0,
      chunkingMs: Math.round((performance.now() - start) * 100) / 100,
      wordCount: chunks.reduce((sum, chunk) => sum + chunk.wordCount, 0),
      chunkCount: chunks.length,
      estimatedDurationSeconds: Math.round(chunks.reduce((sum, chunk) => sum + chunk.estimatedDurationSeconds, 0) * 100) / 100,
    },
  };
}

const DEMO_SCRIPT = "Meet the mitochondrion: your cell's very small, very busy power department. It takes energy stored in nutrients and helps turn it into ATP. ATP is a molecule that cells use to power many of their activities. Think of it as a rechargeable battery, except your cells do not leave it at home when they need it. Most ATP production happens along the inner mitochondrial membrane, which folds into structures called cristae. More folds mean more space for the machinery that makes ATP. Cells that need lots of energy, like muscle cells, tend to have plenty of mitochondria. So the next time you climb the stairs, thank these tiny organelles. They are doing the work, and they have never once asked for a standing desk.";

interface ServiceOptions {
  generate?: typeof entertainify;
  renderer?: VideoRenderer;
  pollMs?: number;
  renderTimeoutMs?: number;
}

export class LessonService {
  private jobs = new Map<string, LessonJob>();
  private active = 0;
  private readonly generate: typeof entertainify;
  private readonly renderer: VideoRenderer | undefined;
  private readonly pollMs: number;
  private readonly renderTimeoutMs: number;

  constructor(options: ServiceOptions = {}) {
    this.generate = options.generate ?? entertainify;
    this.renderer = options.renderer;
    this.pollMs = options.pollMs ?? 2000;
    this.renderTimeoutMs = options.renderTimeoutMs ?? 600_000;
  }

  get(id: string): LessonJob | undefined {
    this.prune();
    return this.jobs.get(id);
  }

  private prune(): void {
    for (const [id, job] of this.jobs) {
      if (!["writing", "rendering"].includes(job.status) && Date.now() - Date.parse(job.createdAt) > 3_600_000) this.jobs.delete(id);
    }
  }

  create(request: LessonRequest, demo = false): LessonJob {
    this.prune();
    if (this.active >= 3) throw new RequestError("The doodle studio is busy. Please try again in a moment.", 429);
    if (this.jobs.size >= 40) {
      const oldest = [...this.jobs.values()].find((job) => !["writing", "rendering"].includes(job.status));
      if (oldest) this.jobs.delete(oldest.id);
    }
    const job: LessonJob = { id: randomUUID(), status: "writing", progress: 10, message: "Finding the fun in your lesson…", createdAt: new Date().toISOString(), demo };
    this.jobs.set(job.id, job);
    this.active++;
    void this.process(job, request);
    return job;
  }

  private async process(job: LessonJob, request: LessonRequest): Promise<void> {
    try {
      const result = job.demo ? parseNarration(DEMO_SCRIPT, "Mitochondria: the tiny power department")
        : request.mode === "script" ? parseNarration(request.text)
        : await this.generate(request.text, { inputMode: request.mode, audience: request.audience, targetWords: request.targetWords });
      job.result = result;
      job.progress = 45;
      if (!this.renderer || job.demo) {
        job.status = "script-ready";
        job.message = job.demo ? "Sample storyboard ready. No AI request was made." : "Your script and scene plan are ready. Video rendering is not connected yet.";
        return;
      }
      job.status = "rendering";
      job.message = "Drawing scenes, recording narration, making movie magic…";
      const deadline = Date.now() + this.renderTimeoutMs;
      let task = validateRenderTask(await this.renderer.submit(result));
      const renderId = task.id;
      while (task.status !== "complete" && task.status !== "failed") {
        job.progress = Math.max(job.progress, Math.min(99, 45 + Math.round((task.progress ?? 0) * 0.54)));
        if (Date.now() >= deadline) throw new Error("Video rendering timed out. Your script and JSON are saved here; check your video service before trying again.");
        await delay(this.pollMs);
        task = validateRenderTask(await this.renderer.getStatus(renderId));
        if (task.id !== renderId) throw new Error("The video renderer returned a different task ID.");
      }
      if (task.status === "failed") throw new Error("The video renderer could not finish this movie. Your script and JSON are still available.");
      job.videoUrl = task.videoUrl!;
      job.progress = 100;
      job.status = "complete";
      job.message = "Popcorn time. Your lesson is ready!";
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error && error.name !== "TypeError" && error.name !== "SyntaxError"
        ? error.message : "We couldn't reach the studio. Please check your connection and try again.";
      job.message = "A plot twist we didn't plan for.";
    } finally { this.active--; }
  }
}
