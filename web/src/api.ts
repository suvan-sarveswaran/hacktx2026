import type { LessonJob, LessonRequest, ServerHealth, PdfJob, PdfSource, PdfProgress, StageRequest } from "../../src/web-contract";

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
  list: () => request<(Pick<LessonJob, "id" | "createdAt" | "demo" | "status"> & { title: string })[]>("/api/lessons"),
  stage: (id: string, stage: string, body: StageRequest = {}) => request<LessonJob>(`/api/lessons/${encodeURIComponent(id)}/${stage}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  voices: (apiKey: string) => request<{ voices: { id: string; name: string }[] }>("/api/voices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) }),
  importPdf: async (file: File, onProgress: (progress: PdfProgress) => void, signal: AbortSignal): Promise<PdfSource> => {
    let id: string | undefined;
    try {
      let job = await request<PdfJob>("/api/documents", { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file, signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]) });
      id = job.id;
      while (job.status === "reading") {
        onProgress(job);
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(signal.reason); };
          const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 700);
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) { signal.removeEventListener("abort", abort); abort(); }
        });
        job = await request<PdfJob>(`/api/documents/${id}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
      }
      if (job.status === "failed" || !job.result) throw new Error(job.error ?? "This PDF couldn't be read. Try exporting it again.");
      onProgress(job);
      return job.result;
    } finally {
      // Remove the temporary source text, or stop OCR when the user cancels/leaves.
      if (id) void request(`/api/documents/${id}`, { method: "DELETE" }).catch(() => {});
    }
  },
  health: () => request<ServerHealth>("/api/health"),
  create: (body: LessonRequest) => request<LessonJob>("/api/lessons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  demo: () => request<LessonJob>("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
  lesson: (id: string, signal?: AbortSignal) => request<LessonJob>(`/api/lessons/${encodeURIComponent(id)}`, { signal }),
};
