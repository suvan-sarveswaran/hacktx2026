import assert from "node:assert/strict";
import test from "node:test";
import { LessonWorkspace } from "../web/src/lesson-workspace.js";
import type { LessonJob, LessonRequest, LessonSummary } from "../src/web-contract.js";

const request: LessonRequest = { text: "A lesson", mode: "material", audience: "Students", targetWords: 75 };
const job = (id: string, extra: Partial<LessonJob> = {}): LessonJob => ({ id, createdAt: "2026-10-25T10:00:00Z", demo: false, status: "writing", progress: 5, message: "Writing", workflow: "upload", revision: 1, ...extra });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test("upload and topic requests run independently and are listed before scripts finish", async () => {
  const upload = deferred<LessonJob>(), scratch = deferred<LessonJob>(); let calls = 0;
  const workspace = new LessonWorkspace({ create: input => { calls++; return input.mode === "topic" ? scratch.promise : upload.promise; }, lesson: async id => job(id), list: async () => [] });
  const first = workspace.create("upload", request);
  const duplicate = workspace.create("upload", request);
  const second = workspace.create("scratch", { ...request, mode: "topic" });
  assert.equal(calls, 2);
  scratch.resolve(job("topic", { workflow: "scratch" })); await second;
  upload.resolve(job("upload")); await first; await duplicate;
  assert.deepEqual(workspace.snapshot().selected, { upload: "upload", scratch: "topic" });
  assert.equal(workspace.snapshot().recent.length, 2);
  assert.ok(workspace.snapshot().recent.every(row => row.status === "writing"));
});

test("background creation cannot replace a different lesson selected while awaiting the response", async () => {
  const pending = deferred<LessonJob>();
  const workspace = new LessonWorkspace({ create: () => pending.promise, lesson: async id => job(id), list: async () => [] });
  const creation = workspace.create("upload", request);
  workspace.select("upload", "older-lesson");
  pending.resolve(job("new-lesson")); await creation;
  assert.equal(workspace.snapshot().selected.upload, "older-lesson");
  assert.equal(workspace.snapshot().recent[0]?.id, "new-lesson");
});

test("late polls and late stage responses cannot roll newer progress backwards", async () => {
  const pending = deferred<LessonJob>();
  const workspace = new LessonWorkspace({ create: async () => job("a"), lesson: () => pending.promise, list: async () => [] });
  workspace.update(job("a"));
  const polling = workspace.refresh("a");
  workspace.update(job("a", { status: "rendering", revision: 3 }));
  pending.resolve(job("a", { status: "script-ready", revision: 1 })); await polling;
  assert.equal(workspace.snapshot().jobs.a?.status, "rendering");
  workspace.update(job("a", { status: "complete", revision: 4 }));
  workspace.update(job("a", { status: "voice", revision: 2 }));
  assert.equal(workspace.snapshot().jobs.a?.status, "complete");
});

test("a library response cannot erase an in-flight creation, and samples stay excluded", async () => {
  const listing = deferred<LessonSummary[]>();
  const workspace = new LessonWorkspace({ create: async () => job("new"), lesson: async id => job(id), list: () => listing.promise });
  const pending = workspace.refreshLibrary();
  await workspace.create("upload", request);
  listing.resolve([{ ...job("demo", { demo: true }), title: "Mitochondria" }]); await pending;
  assert.deepEqual(workspace.snapshot().recent.map(row => row.id), ["new"]);
});

test("selection survives reload and polling continues on unselected running lessons", async () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const ids: string[] = [];
  const upload = "11111111-1111-1111-1111-111111111111", scratch = "22222222-2222-2222-2222-222222222222";
  const api = { create: async () => job(upload), lesson: async (id: string) => { ids.push(id); return job(id); }, list: async () => [] };
  const first = new LessonWorkspace(api, storage);
  first.select("upload", upload); first.select("scratch", scratch);
  const restored = new LessonWorkspace(api, storage);
  assert.deepEqual(restored.snapshot().selected, { upload, scratch });
  restored.update(job("background"));
  await restored.poll();
  assert.deepEqual(new Set(ids), new Set([upload, scratch, "background"]));
  restored.select("upload", null);
  assert.ok(restored.snapshot().jobs[upload]);
});
