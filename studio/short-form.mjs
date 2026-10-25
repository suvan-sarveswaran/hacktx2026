import { createCanvas, loadImage } from '@napi-rs/canvas';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveTextTheme, textLayout } from './text-cards.mjs';

export async function captionedFrame({ imagePath, text, width, height, artStyle, textStyle }) {
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  const theme = resolveTextTheme(artStyle, textStyle), captionHeight = Math.round(height * .25);
  const image = await loadImage(imagePath), artHeight = height - captionHeight;
  ctx.fillStyle = theme.background; ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / image.width, artHeight / image.height);
  ctx.drawImage(image, (width - image.width * scale) / 2, (artHeight - image.height * scale) / 2, image.width * scale, image.height * scale);
  const layout = textLayout(ctx, text, width, captionHeight, theme.font);
  ctx.fillStyle = theme.ink; ctx.font = `bold ${layout.size}px ${theme.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const top = artHeight + (captionHeight - layout.lines.length * layout.lineHeight) / 2;
  layout.lines.forEach((line, i) => ctx.fillText(line, width / 2, top + layout.lineHeight * (i + .5)));
  return canvas.toBuffer('image/png');
}

/** Original local animation; deliberately labeled, replaceable by an uploaded gameplay clip. */
export async function createRunnerPlaceholder(outputDir, runFfmpeg, signal) {
  const directory = path.join(outputDir, 'runner'); await mkdir(directory, { recursive: true });
  const canvas = createCanvas(360, 320), ctx = canvas.getContext('2d');
  for (let frame = 0; frame < 48; frame++) {
    signal?.throwIfAborted(); const phase = frame / 48;
    ctx.fillStyle = '#c8d8ee'; ctx.fillRect(0, 0, 360, 320);
    ctx.fillStyle = '#b6a1ce';
    for (let i = 0; i < 8; i++) ctx.fillRect(i * 48, 50 - i % 3 * 12, 35, 90);
    ctx.fillStyle = '#51465f'; ctx.beginPath(); ctx.moveTo(120, 94); ctx.lineTo(240, 94); ctx.lineTo(350, 320); ctx.lineTo(10, 320); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#e7dfec'; ctx.lineWidth = 3;
    for (let lane = 0; lane < 4; lane++) { ctx.beginPath(); ctx.moveTo(120 + lane * 40, 94); ctx.lineTo(10 + lane * 113, 320); ctx.stroke(); }
    for (let i = 0; i < 8; i++) {
      const depth = ((i / 8 + phase) % 1) ** 1.5, y = 100 + depth * 220;
      ctx.strokeStyle = '#9b8bad'; ctx.beginPath(); ctx.moveTo(120 - depth * 108, y); ctx.lineTo(240 + depth * 108, y); ctx.stroke();
      ctx.fillStyle = '#f4c85e'; ctx.beginPath(); ctx.ellipse(180, y, 3 + depth * 6, 4 + depth * 8, 0, 0, Math.PI * 2); ctx.fill();
    }
    const x = 180 + Math.sin(phase * Math.PI * 2) * 76, bounce = Math.abs(Math.sin(phase * Math.PI * 8)) * 5;
    ctx.fillStyle = '#302743'; ctx.fillRect(x - 13, 270 - bounce, 9, 24); ctx.fillRect(x + 4, 270 + bounce, 9, 24);
    ctx.fillStyle = '#ef9c82'; ctx.fillRect(x - 17, 235 - bounce, 34, 42);
    ctx.fillStyle = '#fff5df'; ctx.beginPath(); ctx.arc(x, 225 - bounce, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8d72bd'; ctx.fillRect(x - 17, 208 - bounce, 34, 12);
    ctx.fillStyle = '#fffaf0'; ctx.fillRect(20, 12, 320, 32); ctx.strokeStyle = '#302743'; ctx.lineWidth = 2; ctx.strokeRect(20, 12, 320, 32);
    ctx.fillStyle = '#302743'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('RUNNER PLACEHOLDER · UPLOAD YOUR CLIP', 180, 33);
    await writeFile(path.join(directory, `${String(frame).padStart(3, '0')}.png`), canvas.toBuffer('image/png'));
  }
  await runFfmpeg(['-framerate', '12', '-i', '%03d.png', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'fast', 'placeholder.mp4'], { cwd: directory, signal });
  return path.join(directory, 'placeholder.mp4');
}
