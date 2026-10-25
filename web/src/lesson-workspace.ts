import type { LessonJob, LessonRequest, LessonSummary, Workflow } from "../../src/web-contract.js";

export const isProducing = (job: Pick<LessonJob, "status">) => ["writing", "planning", "images", "voice", "rendering"].includes(job.status);
export const workflowOf = (job: Pick<LessonJob, "workflow" | "recipe">): Workflow => job.workflow ?? (job.recipe?.mode === "topic" ? "scratch" : "upload");
export const statusLabel = (status: LessonJob["status"]) => ({ writing: "Writing script", planning: "Planning visuals", images: "Generating images", voice: "Recording narration", rendering: "Rendering video", "script-ready": "Continue with illustrations", "images-ready": "Continue with voice + video", "audio-ready": "Voiceover ready · continue to video", complete: "Video ready · watch", failed: "Needs attention · resume" })[status];

interface WorkspaceApi {
  create(request: LessonRequest): Promise<LessonJob>;
  lesson(id: string): Promise<LessonJob>;
  list(): Promise<LessonSummary[]>;
}
export interface SelectionStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
interface Snapshot {
  jobs: Record<string, LessonJob>;
  selected: Record<Workflow, string | null>;
  busy: Record<Workflow, boolean>;
  errors: Record<Workflow, string>;
  jobErrors: Record<string, string>;
  recent: LessonSummary[];
  libraryError: string;
  libraryLoading: boolean;
}

/** Selection is per workflow; asynchronous results are always committed by lesson ID. */
export class LessonWorkspace {
  private state: Snapshot = { jobs: {}, selected: { upload: null, scratch: null }, busy: { upload: false, scratch: false }, errors: { upload: "", scratch: "" }, jobErrors: {}, recent: [], libraryError: "", libraryLoading: true };
  private listeners = new Set<() => void>();
  private revisions = new Map<string, number>();
  private selectionRevision = { upload: 0, scratch: 0 };
  private listing = false;
  private refreshing = new Set<string>();
  constructor(private api: WorkspaceApi, private storage?: SelectionStorage) {
    try {
      const selected = JSON.parse(storage?.getItem("entertainify-workflows") ?? "{}");
      for (const kind of ["upload", "scratch"] as const) if (typeof selected?.[kind] === "string" && /^[a-f0-9-]{36}$/.test(selected[kind])) this.state.selected[kind] = selected[kind];
    } catch { /* Browser storage is optional. */ }
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: Partial<Snapshot>) { this.state = { ...this.state, ...next }; this.listeners.forEach(listener => listener()); }
  select(kind: Workflow, id: string | null) {
    this.selectionRevision[kind]++;
    const selected = { ...this.state.selected, [kind]: id };
    try { this.storage?.setItem("entertainify-workflows", JSON.stringify(selected)); } catch { /* Optional. */ }
    this.publish({ selected, errors: { ...this.state.errors, [kind]: "" } });
  }
  update = (job: LessonJob) => {
    if (job.demo) return;
    if ((job.revision ?? 0) < (this.state.jobs[job.id]?.revision ?? 0)) return;
    this.revisions.set(job.id, (this.revisions.get(job.id) ?? 0) + 1);
    const entry: LessonSummary = { id: job.id, title: job.result?.title ?? job.sourceText?.slice(0, 80) ?? "New lesson", createdAt: job.createdAt, status: job.status, demo: false, workflow: workflowOf(job) };
    this.publish({ jobs: { ...this.state.jobs, [job.id]: job }, jobErrors: { ...this.state.jobErrors, [job.id]: "" }, recent: [entry, ...this.state.recent.filter(row => row.id !== job.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  };
  async create(kind: Workflow, request: LessonRequest) {
    if (this.state.busy[kind]) return;
    const selectionRevision = this.selectionRevision[kind];
    this.publish({ busy: { ...this.state.busy, [kind]: true }, errors: { ...this.state.errors, [kind]: "" } });
    try {
      const job = await this.api.create(request);
      this.update(job);
      if (this.selectionRevision[kind] === selectionRevision) this.select(kind, job.id);
      return job;
    } catch (error) {
      this.publish({ errors: { ...this.state.errors, [kind]: error instanceof Error ? error.message : "Could not start this lesson. Your draft is saved." } });
    } finally { this.publish({ busy: { ...this.state.busy, [kind]: false } }); }
  }
  async refresh(id: string) {
    if (this.refreshing.has(id)) return;
    this.refreshing.add(id);
    const revision = this.revisions.get(id);
    try {
      const job = await this.api.lesson(id);
      // A stage action may have returned newer progress while this read was in flight.
      if (this.revisions.get(id) === revision) {
        if (job.demo) {
          for (const kind of ["upload", "scratch"] as const) if (this.state.selected[kind] === id) this.select(kind, null);
        } else this.update(job);
      }
    } catch (error) {
      if (this.revisions.get(id) === revision) this.publish({ jobErrors: { ...this.state.jobErrors, [id]: error instanceof Error ? error.message : "Could not refresh this lesson. Trying again…" } });
    } finally { this.refreshing.delete(id); }
  }
  async refreshLibrary() {
    if (this.listing) return;
    this.listing = true;
    const revisions = new Map(this.revisions);
    try {
      const rows = (await this.api.list()).filter(row => !row.demo);
      const changed = this.state.recent.filter(row => revisions.get(row.id) !== this.revisions.get(row.id));
      const recent = [...changed, ...rows.filter(row => !changed.some(newer => newer.id === row.id))].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      this.publish({ recent, libraryError: "", libraryLoading: false });
    } catch (error) { this.publish({ libraryError: error instanceof Error ? error.message : "Could not load My lessons.", libraryLoading: false }); }
    finally { this.listing = false; }
  }
  async poll() {
    const ids = new Set([...Object.values(this.state.selected).filter((id): id is string => !!id), ...this.state.recent.filter(isProducing).map(job => job.id), ...Object.values(this.state.jobs).filter(isProducing).map(job => job.id)]);
    await Promise.allSettled([...ids].map(id => this.refresh(id)));
  }
}
