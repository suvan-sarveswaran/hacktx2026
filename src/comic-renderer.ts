import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";
import type { PipelineResult } from "./pipeline.js";

function lines(ctx: SKRSContext2D, text: string, width: number) {
  const result: string[] = []; let line = "";
  for (const word of text.split(/\s+/)) {
    if (ctx.measureText(`${line} ${word}`.trim()).width > width && line) { result.push(line); line = ""; }
    for (const char of `${line ? " " : ""}${word}`) {
      if (ctx.measureText(line + char).width > width) { result.push(line); line = ""; }
      line += char;
    }
  }
  if (line) result.push(line);
  return result;
}

/** Artwork stays text-free. Captions are laid out with measured glyphs, never generated lettering. */
export async function renderComic(lesson: PipelineResult, mapping: Record<number, string>): Promise<Buffer> {
  if (!lesson.comic || ![4, 6, 8].includes(lesson.chunks.length) || lesson.chunks.some(c => !mapping[c.index])) throw new Error("Finish every comic illustration before assembling the page.");
  const width = 1600, margin = 64, gap = 32, panelWidth = 720, artHeight = 405;
  const canvas = createCanvas(width, 100), ctx = canvas.getContext("2d");
  ctx.font = '28px "Segoe UI", sans-serif';
  const captions = lesson.chunks.map(c => lines(ctx, c.text, panelWidth - 48));
  const captionHeight = Math.max(...captions.map(c => c.length)) * 38 + 52;
  const panelHeight = artHeight + captionHeight, rows = lesson.chunks.length / 2;
  ctx.font = 'bold 54px "Segoe UI", sans-serif';
  const titleLines = lines(ctx, lesson.title, width - margin * 2);
  const headerHeight = 100 + titleLines.length * 64;
  canvas.height = headerHeight + rows * (panelHeight + gap) + 50;
  ctx.fillStyle = "#fffaf0"; ctx.fillRect(0, 0, width, canvas.height);
  ctx.fillStyle = "#6d5896"; ctx.font = 'bold 20px "Segoe UI", sans-serif'; ctx.fillText("ENTERTAINIFY / A LITTLE KNOWLEDGE, FRAME BY FRAME", margin, 48);
  ctx.fillStyle = "#302743"; ctx.font = 'bold 54px "Segoe UI", sans-serif';
  titleLines.forEach((line, i) => ctx.fillText(line, margin, 110 + i * 64));
  for (const chunk of lesson.chunks) {
    const x = margin + chunk.index % 2 * (panelWidth + gap), y = headerHeight + Math.floor(chunk.index / 2) * (panelHeight + gap);
    const image = await loadImage(mapping[chunk.index]!);
    ctx.fillStyle = "#eee6f7"; ctx.fillRect(x, y, panelWidth, artHeight);
    // Fit the whole illustration; never crop away a teaching detail.
    const scale = Math.min(panelWidth / image.width, artHeight / image.height);
    ctx.drawImage(image, x + (panelWidth - image.width * scale) / 2, y + (artHeight - image.height * scale) / 2, image.width * scale, image.height * scale);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(x, y + artHeight, panelWidth, captionHeight);
    ctx.strokeStyle = "#302743"; ctx.lineWidth = 4; ctx.strokeRect(x, y, panelWidth, panelHeight);
    ctx.beginPath(); ctx.moveTo(x, y + artHeight); ctx.lineTo(x + panelWidth, y + artHeight); ctx.stroke();
    ctx.fillStyle = "#c8d8ee"; ctx.fillRect(x + 12, y + 12, 46, 42); ctx.strokeRect(x + 12, y + 12, 46, 42);
    ctx.fillStyle = "#302743"; ctx.font = 'bold 26px "Segoe UI", sans-serif'; ctx.fillText(String(chunk.index + 1).padStart(2, "0"), x + 20, y + 43);
    ctx.font = '28px "Segoe UI", sans-serif';
    captions[chunk.index]!.forEach((line, i) => ctx.fillText(line, x + 24, y + artHeight + 42 + i * 38));
  }
  ctx.font = '20px "Segoe UI", sans-serif'; ctx.fillText("READ LEFT TO RIGHT, THEN DOWN.  /  STAY CURIOUS.", margin, canvas.height - 30);
  return canvas.toBuffer("image/png");
}
