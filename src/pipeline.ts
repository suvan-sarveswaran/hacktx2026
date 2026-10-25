import { buildStoryboard } from "#storyboard";
import { chunkScript } from "./chunker.js";
import type { ChunkOptions, ScriptChunk } from "./chunker.js";
import { generateScript } from "./generator.js";
import type { LlmProvider, ScriptOptions } from "./generator.js";

export interface PipelineOptions extends ScriptOptions {
  chunking?: ChunkOptions;
}

export interface PipelineResult {
  title: string;
  /** Retained in full for voiceover and context-aware image prompting. */
  script: string;
  chunks: ScriptChunk[];
  metadata: {
    provider: LlmProvider | "none";
    model: string;
    wordCount: number;
    chunkCount: number;
    estimatedDurationSeconds: number;
    generationMs: number;
    chunkingMs: number;
    storyboard?: {version:number;method:string;apiCalls:0;imageChunks:number;textChunks:number;textRatio:number;textSelection:string;scenePolicy?:string};
  };
}

export async function entertainify(sourceText: string, options: PipelineOptions = {}): Promise<PipelineResult> {
  // Validate chunk settings before consuming API quota.
  chunkScript("Validate chunk settings.", options.chunking);
  const generationStart = performance.now();
  const { title, script, model, provider } = await generateScript(sourceText, options);
  const generationMs = performance.now() - generationStart;
  const chunkingStart = performance.now();
  const chunks = chunkScript(script, options.chunking);
  const chunkingMs = performance.now() - chunkingStart;
  return buildStoryboard<PipelineResult>({
    title,
    script,
    chunks,
    metadata: {
      provider,
      model,
      wordCount: chunks.reduce((sum, chunk) => sum + chunk.wordCount, 0),
      chunkCount: chunks.length,
      estimatedDurationSeconds: Math.round(chunks.reduce((sum, chunk) => sum + chunk.estimatedDurationSeconds, 0) * 100) / 100,
      generationMs: Math.round(generationMs * 100) / 100,
      chunkingMs: Math.round(chunkingMs * 100) / 100,
    },
  });
}
