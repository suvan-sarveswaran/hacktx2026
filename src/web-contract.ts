import type { PipelineResult } from "./pipeline.js";

/** Shared browser/server contract. PipelineResult is passed unchanged to the renderer. */
export type LessonStatus = "writing" | "rendering" | "script-ready" | "complete" | "failed";
export interface LessonRequest {
  text: string;
  mode: "material" | "topic" | "script";
  audience: string;
  targetWords: number;
}
export interface LessonJob {
  id: string;
  status: LessonStatus;
  progress: number;
  message: string;
  createdAt: string;
  demo: boolean;
  result?: PipelineResult;
  videoUrl?: string;
  error?: string;
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
