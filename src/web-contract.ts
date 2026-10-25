import type { PipelineResult } from "./pipeline.js";

/** Shared browser/server contract. PipelineResult is passed unchanged to the renderer. */
export type LessonStatus = "writing" | "planning" | "images" | "voice" | "rendering" | "script-ready" | "images-ready" | "audio-ready" | "complete" | "failed";
export type LessonFormat = "youtube" | "short" | "comic";
/** Older saved lessons retain their original workflow. */
export type Workflow = LessonFormat | "upload" | "scratch";
export type LessonSummary = Pick<LessonJob, "id" | "createdAt" | "demo" | "status" | "workflow"> & { title: string };
export interface LessonRequest {
  format?: LessonFormat;
  brainrot?: boolean;
  comicPanels?: 4 | 6 | 8;
  text: string;
  mode: "material" | "topic" | "script";
  audience: string;
  targetWords: number;
  apiKey?: string;
}
export interface LessonJob {
  id: string;
  revision?: number;
  status: LessonStatus;
  progress: number;
  message: string;
  createdAt: string;
  demo: boolean;
  workflow?: Workflow;
  recipe?: Pick<LessonRequest, "mode" | "audience" | "targetWords">;
  operation?: "audio" | "video" | "comic";
  comicUrl?: string;
  comicOutputs?: { url: string; createdAt: string; panels?: { imageUrl: string; caption: string }[] }[];
  gameplayClip?: string;
  result?: PipelineResult;
  videoUrl?: string;
  error?: string;
  sourceText?: string;
  settings?: ProductionSettings;
  frames?: LessonFrame[];
  audioUrl?: string;
  timelineUrl?: string;
  failedStage?: "script" | "plan" | "images" | "video" | "comic";
  outputs?: SavedOutput[];
  scenePrompts?: Record<string, string>;
}
export type Aspect = "landscape" | "square" | "portrait";
export interface ProductionSettings {
  brainrot: boolean;
  imageModel: string;
  textStyle: "auto" | "doodle" | "vector" | "pencil" | "cinematic";
  style: string;
  imageAspect: Aspect;
  videoAspect: Aspect;
  voiceId: string;
  model: "eleven_flash_v2_5" | "eleven_multilingual_v2";
  fallbackText: boolean;
}
export interface LessonFrame { chunkIndex: number; prompt: string; version: string; seed?: number; imageUrl?: string; error?: string }
export interface SavedOutput { videoUrl?: string; audioUrl: string; timelineUrl?: string; createdAt: string; label: string }
export interface StageRequest {
  apiKey?: string;
  settings?: Partial<ProductionSettings>;
  count?: number;
  audioOnly?: boolean;
  prompts?: Record<string, string>;
}
export interface ServerHealth {
  generationConfigured: boolean;
  rendererConfigured: boolean;
}

export interface PdfProgress {
  page: number;
  totalPages: number;
  progress: number;
  message: string;
}
export interface PdfSource {
  text: string;
  pageCount: number;
  ocrPages: number[];
  warnings: string[];
}
export interface PdfJob extends PdfProgress {
  id: string;
  status: "reading" | "ready" | "failed";
  result?: PdfSource;
  error?: string;
}
