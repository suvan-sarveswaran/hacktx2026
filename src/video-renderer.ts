import type { PipelineResult } from "./pipeline.js";

export interface RenderTask {
  id: string;
  status: "queued" | "rendering" | "complete" | "failed";
  /** Actual renderer progress, from 0 to 100. */
  progress?: number;
  videoUrl?: string;
}

/** Implement these two methods to merge an in-process image/audio/video pipeline. */
export interface VideoRenderer {
  submit(lesson: PipelineResult): Promise<RenderTask>;
  getStatus(id: string): Promise<RenderTask>;
}

function checkedUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("Renderer URLs must use HTTPS or local HTTP.");
  }
  if (url.username || url.password) throw new Error("Renderer URLs must not contain credentials.");
  return url;
}

export function validateRenderTask(value: unknown): RenderTask {
  if (!value || typeof value !== "object") throw new Error("The video renderer returned an invalid task.");
  const task = value as Record<string, unknown>;
  if (typeof task.id !== "string" || !task.id || !["queued", "rendering", "complete", "failed"].includes(String(task.status))) {
    throw new Error("The video renderer returned an invalid task.");
  }
  if (task.progress !== undefined && (typeof task.progress !== "number" || !Number.isFinite(task.progress) || task.progress < 0 || task.progress > 100)) {
    throw new Error("The video renderer returned invalid progress.");
  }
  if (task.videoUrl !== undefined) {
    if (typeof task.videoUrl !== "string") throw new Error("The video renderer returned an invalid video URL.");
    checkedUrl(task.videoUrl);
  }
  if (task.status === "complete" && !task.videoUrl) throw new Error("The video renderer completed without a playable video URL.");
  // Explicitly pick public fields; never forward arbitrary renderer payloads or error bodies.
  return {
    id: task.id,
    status: task.status as RenderTask["status"],
    ...(typeof task.progress === "number" ? { progress: task.progress } : {}),
    ...(typeof task.videoUrl === "string" ? { videoUrl: task.videoUrl } : {}),
  };
}

/** POST <base>/jobs with the existing lesson JSON; GET <base>/jobs/:id to poll. */
export function createHttpVideoRenderer(baseUrl: string, token?: string): VideoRenderer {
  const base = checkedUrl(baseUrl);
  if (base.search || base.hash) throw new Error("VIDEO_RENDERER_URL must not contain a query or fragment.");
  const root = base.href.replace(/\/+$/, "");
  async function request(path: string, lesson?: PipelineResult): Promise<RenderTask> {
    const response = await fetch(`${root}${path}`, {
      method: lesson ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(lesson ? { body: JSON.stringify(lesson) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`The video renderer is unavailable (HTTP ${response.status}). Your lesson JSON is still available.`);
    return validateRenderTask(await response.json());
  }
  return {
    submit: (lesson) => request("/jobs", lesson),
    getStatus: (id) => request(`/jobs/${encodeURIComponent(id)}`),
  };
}
