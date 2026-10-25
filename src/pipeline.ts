import { chunkScript } from "./chunker.js";
import type { ChunkOptions, ScriptChunk } from "./chunker.js";
import { generateScript } from "./generator.js";
import type { LlmProvider, ScriptOptions } from "./generator.js";
import { chunksFromBeats, VISUAL_PLAN_VERSION } from "./visual-plan.js";
import { comicChunks } from "./comic-plan.js";
import type { ComicPlan } from "./comic-plan.js";

export interface PipelineOptions extends ScriptOptions {
  chunking?: ChunkOptions;
}

export interface PipelineResult {
  title: string;
  /** Retained in full for voiceover and context-aware image prompting. */
  script: string;
  chunks: ScriptChunk[];
  comic?: ComicPlan;
  visualPlanning?: { mode: "groq" | "text-first"; model?: string; version: number };
  metadata: {
    provider: LlmProvider | "none";
    model: string;
    wordCount: number;
    chunkCount: number;
    estimatedDurationSeconds: number;
    generationMs: number;
    chunkingMs: number;
  };
}

export async function entertainify(sourceText: string, options: PipelineOptions = {}): Promise<PipelineResult> {
  // Validate chunk settings before consuming API quota.
  chunkScript("Validate chunk settings.", options.chunking);
  const generationStart = performance.now();
  const { title, script, model, provider, visualBeats, comic } = await generateScript(sourceText, options);
  const generationMs = performance.now() - generationStart;
  const chunkingStart = performance.now();
  const chunks = comic ? comicChunks(comic) : visualBeats ? chunksFromBeats(script, visualBeats, options.chunking?.wordsPerMinute) : chunkScript(script, options.chunking);
  const chunkingMs = performance.now() - chunkingStart;
  return {
    title,
    script,
    chunks,
    ...(comic ? { comic } : {}),
    ...(visualBeats ? { visualPlanning: { mode: "groq" as const, model, version: VISUAL_PLAN_VERSION } } : {}),
    metadata: {
      provider,
      model,
      wordCount: chunks.reduce((sum, chunk) => sum + chunk.wordCount, 0),
      chunkCount: chunks.length,
      estimatedDurationSeconds: Math.round(chunks.reduce((sum, chunk) => sum + chunk.estimatedDurationSeconds, 0) * 100) / 100,
      generationMs: Math.round(generationMs * 100) / 100,
      chunkingMs: Math.round(chunkingMs * 100) / 100,
    },
  };
}
