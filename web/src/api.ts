import type { LessonJob, LessonRequest, ServerHealth } from "../../src/web-contract";

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, signal: options.signal ?? AbortSignal.timeout(20_000) });
  let data;
  try { data = await response.json(); }
  catch { throw new Error("The studio is offline. Start the Entertainify server and try again."); }
  if (!response.ok) throw new ApiError(data.error ?? "Something went sideways. Please try again.", response.status);
  return data as T;
}

export const api = {
  health: () => request<ServerHealth>("/api/health"),
  create: (body: LessonRequest) => request<LessonJob>("/api/lessons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  demo: () => request<LessonJob>("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
  lesson: (id: string, signal?: AbortSignal) => request<LessonJob>(`/api/lessons/${encodeURIComponent(id)}`, { signal }),
};
