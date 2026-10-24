import { chunkScript } from "./chunker.js";
import type { ChunkOptions, ScriptChunk } from "./chunker.js";
import { generateScript } from "./generator.js";
import type { ScriptOptions } from "./generator.js";

export interface PipelineOptions extends ScriptOptions {
  chunking?: ChunkOptions;
}

export interface PipelineResult {
  title: string;
  /** Retained in full for voiceover and context-aware image prompting. */
  script: string;
  chunks: ScriptChunk[];
  metadata: {
    model: string;
    wordCount: number;
    chunkCount: number;
    estimatedDurationSeconds: number;
    generationMs: number;
    chunkingMs: number;
  };
}

export async function entertainify(sourceText: string, options: PipelineOptions = {}): Promise<PipelineResult> {
  // Validate chunk settings before making a billable request.
  chunkScript("Validate chunk settings.", options.chunking);
  const generationStart = performance.now();
  const { title, script, model } = await generateScript(sourceText, options);
  const generationMs = performance.now() - generationStart;
  const chunkingStart = performance.now();
  const chunks = chunkScript(script, options.chunking);
  const chunkingMs = performance.now() - chunkingStart;
  return {
    title,
    script,
    chunks,
    metadata: {
      model,
      wordCount: chunks.reduce((sum, chunk) => sum + chunk.wordCount, 0),
      chunkCount: chunks.length,
      estimatedDurationSeconds: Math.round(chunks.reduce((sum, chunk) => sum + chunk.estimatedDurationSeconds, 0) * 100) / 100,
      generationMs: Math.round(generationMs * 100) / 100,
      chunkingMs: Math.round(chunkingMs * 100) / 100,
    },
  };
}
