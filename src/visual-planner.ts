import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { PipelineResult } from "./pipeline.js";
import { chunksFromBeats, imageTimeShare, MIN_PLANNED_IMAGE_SHARE, textFirstChunks, VISUAL_PLAN_VERSION, VISUAL_RULES } from "./visual-plan.js";
import type { VisualBeat } from "./visual-plan.js";

const schema = { type: "object", properties: { scenes: { type: "array", items: {
  type: "object", properties: { index: { type: "integer" }, kind: { type: "string", enum: ["image", "text"] }, prompt: { type: "string" }, caption: { type: "string" } },
  required: ["index", "kind", "prompt", "caption"], additionalProperties: false,
} } }, required: ["scenes"], additionalProperties: false };
interface PlanOptions {
  apiKey: string; cacheDir: string; signal: AbortSignal; onProgress: (message: string) => void;
  fetchImpl?: typeof fetch; batchDelayMs?: number; initialDelayMs?: number; refreshCompleted?: boolean;
}

/** Replan existing narration in small, sequential batches. Successful batches survive retries. */
export async function planExistingLesson(lesson: PipelineResult, options: PlanOptions): Promise<PipelineResult> {
  const model = "openai/gpt-oss-20b", chunks = textFirstChunks(lesson.script), batchSize = 24;
  if (chunks.length > 1000) throw new Error("This narration has too many short sentences for video production. Combine them into meaningful beats before planning visuals.");
  const fingerprint = createHash("sha256").update(`visual-plan-v${VISUAL_PLAN_VERSION}:${lesson.script}`).digest("hex");
  await mkdir(options.cacheDir, { recursive: true });
  const file = join(options.cacheDir, `${fingerprint}.json`);
  let checkpoint: { beats: VisualBeat[]; nextRequestAt: number } = { beats: [], nextRequestAt: Date.now() + (options.initialDelayMs ?? 0) };
  try { checkpoint = JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  // Explicit replanning must be able to improve an accepted plan (including one
  // whose actual speech timing failed the final check). Interrupted work resumes.
  if (options.refreshCompleted && checkpoint.beats.length === chunks.length) checkpoint.beats = [];
  const persist = async () => { const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(checkpoint)); await rename(temp, file); };
  await persist();
  const requestBatch = async (start: number, correction: string): Promise<VisualBeat[]> => {
    const waitMs = checkpoint.nextRequestAt - Date.now();
    if (waitMs > 0) {
      options.onProgress(`Visual plan: ${start}/${chunks.length} beats saved. Waiting ${Math.ceil(waitMs / 1000)}s to stay gentle on Groq’s free tier…`);
      await delay(waitMs, undefined, { signal: options.signal });
    }
    const batch = chunks.slice(start, start + batchSize);
    options.onProgress(`${correction ? "Adding more relevant illustrations" : "Groq is planning illustrations"} for beats ${start + 1}–${start + batch.length} of ${chunks.length}…`);
    const response = await (options.fetchImpl ?? fetch)("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", redirect: "error", signal: AbortSignal.any([options.signal, AbortSignal.timeout(120000)]),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify({ model, reasoning_effort: "low", max_completion_tokens: 3000,
        messages: [{ role: "system", content: `${VISUAL_RULES}\nClassify every supplied beat exactly once using its index. Do not rewrite or combine narration. Return scenes with index, kind, prompt, caption. ${correction}` },
          { role: "user", content: JSON.stringify({ title: lesson.title, priorVisuals: checkpoint.beats.filter(b => b.kind === "image").slice(-3).map(b => b.prompt), context: chunks.slice(Math.max(0, start - 2), start).map(c => c.text), next: chunks.slice(start + batch.length, start + batch.length + 2).map(c => c.text), beats: batch.map(c => [c.index, c.text]) }) }],
        response_format: { type: "json_schema", json_schema: { name: "visual_plan", strict: true, schema } },
      }),
    });
    checkpoint.nextRequestAt = Date.now() + (options.batchDelayMs ?? 61000);
    // Save the cooldown even if the response later proves malformed.
    await persist();
    if (!response.ok) {
      const retry = Number(response.headers.get("retry-after"));
      if (response.status === 429 && Number.isFinite(retry) && retry > 0) checkpoint.nextRequestAt = Date.now() + Math.max(61000, retry * 1000);
      await persist();
      throw new Error(`Groq visual planning failed (HTTP ${response.status}). ${response.status === 429 ? "Free-tier quota reached; wait for your quota to reset, then continue. Completed planning batches are saved." : "Check your key and model access, then try again."}`);
    }
    const payload = await response.json() as { choices?: { finish_reason?: string; message?: { content?: string } }[] };
    const choice = payload.choices?.[0];
    if (choice?.finish_reason !== "stop" || !choice.message?.content) { await persist(); throw new Error("Groq did not finish the visual plan. The narration and previous batches are saved."); }
    let scenes: { index: number; kind: string; prompt: string; caption: string }[];
    try { scenes = JSON.parse(choice.message.content).scenes; } catch { throw new Error("Groq returned an invalid visual plan. Your narration is unchanged."); }
    if (!Array.isArray(scenes) || scenes.length !== batch.length || new Set(scenes.map(s => s?.index)).size !== batch.length) throw new Error("Groq omitted or duplicated a visual beat. Your narration is unchanged.");
    const beats = batch.map(chunk => {
      const item = scenes.find(s => s?.index === chunk.index);
      if (!item || !["image", "text"].includes(item.kind) || typeof item.prompt !== "string" || item.prompt.length > 1000 || (item.kind === "image" && !item.prompt.trim()) || typeof item.caption !== "string" || item.caption.length > 100) throw new Error("Groq returned invalid scene directions. Your narration is unchanged.");
      return { narration: chunk.text, kind: item.kind as "image" | "text", prompt: item.prompt, caption: item.caption };
    });
    return beats;
  };
  for (let start = checkpoint.beats.length; start < chunks.length; start += batchSize) {
    let correction = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const beats = await requestBatch(start, correction);
      const candidate = [...checkpoint.beats, ...beats];
      const partialScript = lesson.script.slice(0, chunks[Math.min(start + batchSize, chunks.length) - 1]!.endOffset);
      const share = imageTimeShare(chunksFromBeats(partialScript, candidate));
      if (share >= MIN_PLANNED_IMAGE_SHARE) {
        checkpoint.beats = candidate;
        await persist();
        break;
      }
      if (attempt === 1) throw new Error("Groq's plan still contains too much text. Continue visual planning to try this batch again; your narration and completed batches are saved. No image or voice credits were used.");
      correction = `The previous attempt covered only ${Math.round(share * 100)}% of narration with images. Reconsider this batch using concrete objects, process diagrams, before/after comparisons and relevant visual analogies. Target 80-90% image time. Reserve text strictly for beats with no useful depiction.`;
      options.onProgress("This plan used too many text cards. Revising the current batch once, after the free-tier cooldown…");
    }
  }
  const planned = chunksFromBeats(lesson.script, checkpoint.beats);
  return { ...lesson, chunks: planned, metadata: { ...lesson.metadata, chunkCount: planned.length }, visualPlanning: { mode: "groq", model, version: VISUAL_PLAN_VERSION } };
}
