import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { RequestError } from "./lesson-service.js";
import { validatePdfBytes } from "./pdf-limits.js";
import type { PdfJob, PdfProgress, PdfSource } from "./web-contract.js";

type WorkerMessage = { type: "progress"; progress: PdfProgress } | { type: "ready"; result: PdfSource } | { type: "failed"; error: string };

/** Isolate PDF/OCR CPU work from video polling and terminate runaway documents. */
export class PdfService {
  private jobs = new Map<string, { job: PdfJob; expires: number }>();
  private workers = new Map<string, Worker>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private timeoutMs = 10 * 60_000) {}

  create(bytes: Uint8Array): PdfJob {
    this.prune();
    if (this.workers.size >= 2) throw new RequestError("Two PDFs are already being read. Try again when one finishes.", 429);
    try { validatePdfBytes(bytes); } catch (e) { throw new RequestError((e as Error).message); }
    const job: PdfJob = { id: randomUUID(), status: "reading", page: 0, totalPages: 0, progress: 0, message: "Opening your PDF…" };
    // Compiled production/test workers use JS; the existing tsx dev command uses TS.
    const compiled = import.meta.url.endsWith(".js");
    const worker = compiled
      ? new Worker(new URL("./pdf-worker.js", import.meta.url), { workerData: bytes })
      : new Worker(`import('tsx/esm/api').then(({ tsImport }) => tsImport(${JSON.stringify(new URL("./pdf-worker.ts", import.meta.url).href)}, ${JSON.stringify(import.meta.url)}))`, { eval: true, workerData: bytes });
    this.jobs.set(job.id, { job, expires: Infinity });
    this.workers.set(job.id, worker);
    const finish = (error?: string) => {
      if (!this.workers.has(job.id)) return;
      clearTimeout(this.timers.get(job.id));
      this.timers.delete(job.id);
      this.workers.delete(job.id);
      this.jobs.get(job.id)!.expires = Date.now() + 60 * 60_000;
      if (error) { job.status = "failed"; job.error = error; job.message = error; }
      void worker.terminate();
    };
    worker.on("message", (message: WorkerMessage) => {
      if (job.status !== "reading") return;
      if (message.type === "progress") Object.assign(job, message.progress, { progress: Math.max(job.progress, message.progress.progress) });
      else if (message.type === "ready") {
        job.result = message.result; job.status = "ready"; job.progress = 100; job.message = "Your source text is ready. Give it a quick read.";
        finish();
      } else finish(message.error);
    });
    worker.on("error", () => finish("The PDF reader couldn't finish. Try fewer pages or export the PDF again."));
    worker.on("exit", () => { if (job.status === "reading") finish("The PDF reader stopped. Try uploading fewer pages."); });
    this.timers.set(job.id, setTimeout(() => finish("This PDF took too long to read. Try a shorter chapter or sharper scan."), this.timeoutMs).unref());
    return job;
  }

  get(id: string): PdfJob | undefined { this.prune(); return this.jobs.get(id)?.job; }

  cancel(id: string): void {
    const worker = this.workers.get(id);
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
    this.workers.delete(id); this.jobs.delete(id);
    if (worker) void worker.terminate();
  }

  close(): void { for (const id of this.jobs.keys()) this.cancel(id); }

  private prune(): void {
    for (const [id, entry] of this.jobs) if (entry.expires < Date.now()) this.jobs.delete(id);
    // Retain a bounded number of completed source texts in memory.
    for (const [id, entry] of this.jobs) if (this.jobs.size >= 20 && entry.job.status !== "reading") this.jobs.delete(id);
  }
}
