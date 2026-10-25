import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunksFromBeats, imageTimeShare, textFirstChunks, readVisualBeats, VISUAL_PLAN_VERSION } from "../src/visual-plan.js";
import { planExistingLesson } from "../src/visual-planner.js";
import { entertainify } from "../src/pipeline.js";
import { parseNarration } from "../src/lesson-service.js";

const scenes = [
  { narration: "Sunlight strikes the green leaf, releasing energy inside it.", kind: "image" as const, prompt: "A green leaf cross-section, golden sunlight entering from the left and reaching small chloroplasts inside the cells; focus on the path of light.", caption: "" },
  { narration: "The key idea is energy changing forms, not appearing.", kind: "text" as const, prompt: "", caption: "Energy changes form" },
];

test("one structured Groq call writes narration and a mixed scene plan", async t => {
  const mock = t.mock.method(globalThis, "fetch", async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = JSON.parse(init!.body as string);
    assert.equal(body.response_format.json_schema.name, "educational_storyboard");
    assert.equal(body.reasoning_effort, "low");
    assert.ok(body.max_completion_tokens <= 6000);
    assert.match(body.messages[0].content, /No repeated generic subject/);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ title: "Leaf power", scenes }) } }] });
  });
  const lesson = await entertainify("Teach photosynthesis", { provider: "groq", model: "openai/gpt-oss-120b", apiKey: "test-only", planVisuals: true, targetWords: 150 });
  assert.equal(mock.mock.callCount(), 1);
  assert.equal(lesson.script, scenes.map(s => s.narration).join(" "));
  assert.deepEqual(lesson.chunks.map(c => c.renderHint), ["image", "text"]);
  assert.equal(lesson.chunks[0]!.imagePrompt, scenes[0]!.prompt);
  assert.equal(lesson.chunks[1]!.displayText, "Energy changes form");
  assert.equal(lesson.visualPlanning?.mode, "groq");
  for (const chunk of lesson.chunks) assert.equal(lesson.script.slice(chunk.startOffset, chunk.endOffset), chunk.text);
});

test("exact UTF-16 narration is preserved while duplicate visuals get distinct narration-specific prompts", () => {
  const beats = readVisualBeats([
    { ...scenes[0], narration: "🧠 A green leaf catches the morning sunlight." },
    { ...scenes[0], narration: "A different leaf catches the warm afternoon sunlight." },
    { ...scenes[0], narration: "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen." },
  ]);
  const script = beats.map(b => b.narration).join("\n\n");
  const chunks = chunksFromBeats(script, beats);
  assert.deepEqual(chunks.map(c => c.renderHint), ["image", "image", "image", "image"]);
  assert.equal(new Set(chunks.map(c => c.imagePrompt)).size, chunks.length);
  assert.match(chunks[1]!.imagePrompt!, /warm afternoon sunlight/);
  assert.ok(chunks.every(c => c.wordCount <= 12));
  for (const chunk of chunks) assert.equal(script.slice(chunk.startOffset, chunk.endOffset), chunk.text);
  assert.throws(() => chunksFromBeats(script + " Missing.", beats), /omitted/);
  assert.throws(() => chunksFromBeats("Changed " + script, beats), /changed or omitted/);
});

test("long image beats stay illustrated throughout with balanced, snappy cuts and individual prompts", () => {
  const beats = readVisualBeats([
    { ...scenes[0], narration: "🧠 The green leaf captures bright sunlight and uses its energy to turn water into stored sugar." },
    { ...scenes[0], narration: "Water travels up from underground roots through thin tubes in the stem to reach each green leaf.", prompt: "A cutaway plant stem with blue water rising through narrow tubes from roots to a green leaf." },
    scenes[1],
  ]);
  const script = beats.map(b => b.narration).join("\n\n");
  const chunks = chunksFromBeats(script, beats);
  assert.deepEqual(chunks.map(c => c.renderHint), ["image", "image", "image", "image", "text"]);
  assert.equal(new Set(chunks.filter(c => c.renderHint === "image").map(c => c.imagePrompt)).size, 4);
  for (const chunk of chunks.filter(c => c.renderHint === "image")) assert.ok(chunk.imagePrompt!.includes(chunk.text));
  assert.ok(chunks.every(c => c.wordCount >= 6 && c.wordCount <= 12));
  assert.equal(chunks.map(c => c.text).join(" "), script.replace(/\s+/gu, " "));
  for (const c of chunks) assert.equal(script.slice(c.startOffset, c.endOffset), c.text);
  assert.equal(chunks[4]!.displayText, beats[2]!.caption);
  assert.ok(imageTimeShare(chunks) > 0.75);
});

test("a storyboard of long illustration beats never collapses into an all-text lesson", async t => {
  const longScenes = Array.from({ length: 12 }, (_, index) => ({ ...scenes[0],
    narration: `The green leaf number ${index} captures sunlight and uses that energy to help turn water into sugar.`,
    prompt: `A cutaway green leaf in scene ${index}, with sunlight entering its chloroplasts and sugar emerging.`,
  }));
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ title: "Plant power", scenes: longScenes }) } }] }));
  const lesson = await entertainify("Photosynthesis", { provider: "groq", apiKey: "test", planVisuals: true });
  assert.equal(lesson.chunks.filter(c => c.renderHint === "image").length, longScenes.length * 2);
  assert.equal(lesson.chunks.filter(c => c.renderHint === "text").length, 0);
  assert.equal(mock.mock.callCount(), 1);
});

test("no-key narration uses readable text beats instead of isolated nouns and verbs", () => {
  const script = "  🧠 The green leaf captures sunlight and turns water into stored energy inside tiny cells.\nEnergy can change forms, but it cannot appear from nowhere.";
  const chunks = textFirstChunks(script);
  assert.ok(chunks.every(c => c.renderHint === "text" && c.wordCount <= 12 && c.wordCount >= 6));
  assert.equal(chunks.map(c => c.text).join(" "), script.trim().replace(/\s+/gu, " "));
});

test("existing narration plans resume completed batches after failure without rewriting speech", async t => {
  const dir = await mkdtemp(join(tmpdir(), "visual-plan-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const lesson = parseNarration(Array.from({ length: 26 }, (_, i) => `Object ${i} absorbs sunlight and releases stored energy.`).join("\n"));
  let calls = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(init!.body as string), supplied = JSON.parse(body.messages[1].content).beats as [number, string][];
    assert.ok(supplied.length <= 24); assert.equal(body.model, "openai/gpt-oss-20b");
    assert.ok(body.max_completion_tokens <= 3000);
    if (calls === 2) return new Response("", { status: 503 });
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ scenes: supplied.map(([index]) => ({ index, kind: index % 4 === 3 ? "text" : "image", caption: "Stored sunlight", prompt: index % 4 === 3 ? "" : `Sunlight reaching the unique numbered object ${index}.` })) }) } }] });
  };
  const options = { apiKey: "secret-test-key", cacheDir: dir, signal: new AbortController().signal, onProgress: () => {}, fetchImpl, batchDelayMs: 0 };
  await assert.rejects(planExistingLesson(lesson, options), /503/);
  const checkpoint = await readFile(join(dir, (await readdir(dir))[0]!), "utf8");
  assert.equal(JSON.parse(checkpoint).beats.length, 24); assert.ok(!checkpoint.includes("secret-test-key"));
  const planned = await planExistingLesson(lesson, options);
  assert.equal(calls, 3); assert.equal(planned.script, lesson.script); assert.equal(planned.chunks.length, 26);
  assert.equal(planned.chunks.filter(c => c.renderHint === "image").length, 20);
  assert.equal(planned.visualPlanning!.version, VISUAL_PLAN_VERSION);
  for (const chunk of planned.chunks) assert.equal(lesson.script.slice(chunk.startOffset, chunk.endOffset), chunk.text);
  await planExistingLesson(lesson, options); assert.equal(calls, 3);
  await planExistingLesson(planned, { ...options, refreshCompleted: true }); assert.equal(calls, 5);
});

test("image coverage uses duration, not number of scenes", () => {
  assert.equal(imageTimeShare([]), 0);
  assert.equal(imageTimeShare([
    { renderHint: "image", estimatedDurationSeconds: 1 },
    { renderHint: "image", estimatedDurationSeconds: 1 },
    { renderHint: "text", estimatedDurationSeconds: 8 },
  ]), 0.2);
});

test("a 3-image/30-text plan gets one corrective pass and never replaces the narration with a text-heavy plan", async t => {
  const dir = await mkdtemp(join(tmpdir(), "visual-plan-coverage-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const lesson = parseNarration(Array.from({ length: 33 }, (_, i) => `Object ${i} absorbs sunlight and releases stored energy.`).join("\n"));
  const oldFingerprint = createHash("sha256").update(`visual-plan-v2:${lesson.script}`).digest("hex");
  const oldPlan = JSON.stringify({ beats: textFirstChunks(lesson.script).map(c => ({ narration: c.text, kind: "text", prompt: "", caption: "Stored sunlight" })), nextRequestAt: 0 });
  await writeFile(join(dir, `${oldFingerprint}.json`), oldPlan);
  let calls = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(init!.body as string), supplied = JSON.parse(body.messages[1].content).beats as [number, string][];
    if (calls === 2) assert.match(body.messages[0].content, /previous attempt covered only/);
    const corrected = calls > 1;
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ scenes: supplied.map(([index]) => {
      const image = corrected ? index % 10 !== 9 : index < 3;
      return { index, kind: image ? "image" : "text", prompt: image ? `Object ${index} catching a ray of sunlight.` : "", caption: image ? "" : "Stored sunlight" };
    }) }) } }] });
  };
  const options = { apiKey: "test", cacheDir: dir, signal: new AbortController().signal, onProgress: () => {}, batchDelayMs: 0 };
  const planned = await planExistingLesson(lesson, { ...options, fetchImpl });
  assert.equal(calls, 3); assert.equal(planned.script, lesson.script);
  assert.equal(planned.chunks.filter(c => c.renderHint === "image").length, 30);
  assert.ok(imageTimeShare(planned.chunks) > 0.9);
  assert.equal(await readFile(join(dir, `${oldFingerprint}.json`), "utf8"), oldPlan);
  let rejectedCalls = 0;
  await assert.rejects(planExistingLesson(lesson, { ...options, cacheDir: join(dir, "reject"), fetchImpl: async (_url, init) => {
    rejectedCalls++;
    const supplied = JSON.parse(JSON.parse(init!.body as string).messages[1].content).beats as [number, string][];
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ scenes: supplied.map(([index]) => ({ index, kind: "text", prompt: "", caption: "Stored sunlight" })) }) } }] });
  } }), /too much text/);
  assert.equal(rejectedCalls, 2);
  const saved = JSON.parse(await readFile(join(dir, "reject", (await readdir(join(dir, "reject")))[0]!), "utf8"));
  assert.deepEqual(saved.beats, []);
});

test("quota failures save retry deadlines and malformed plans never replace narration", async t => {
  const dir = await mkdtemp(join(tmpdir(), "visual-plan-errors-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const lesson = parseNarration(scenes.map(s => s.narration).join(" "));
  let calls = 0;
  const options = { apiKey: "test", cacheDir: dir, signal: new AbortController().signal, onProgress: () => {}, batchDelayMs: 0 };
  await assert.rejects(planExistingLesson(lesson, { ...options, fetchImpl: async () => { calls++; return new Response("", { status: 429, headers: { "retry-after": "120" } }); } }), /Free-tier quota/);
  const saved = JSON.parse(await readFile(join(dir, (await readdir(dir))[0]!), "utf8"));
  assert.ok(saved.nextRequestAt > Date.now() + 100000); assert.equal(calls, 1); assert.equal(saved.beats.length, 0);
  await assert.rejects(planExistingLesson(lesson, { ...options, cacheDir: join(dir, "bad"), fetchImpl: async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ scenes: [{ index: 0 }, { index: 0 }] }) } }] }) }), /omitted or duplicated/);
  assert.equal(lesson.script, scenes.map(s => s.narration).join(" "));
});
