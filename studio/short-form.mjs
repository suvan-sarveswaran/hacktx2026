import { createCanvas, loadImage } from '@napi-rs/canvas';
import { resolveTextTheme, textLayout } from './text-cards.mjs';

export async function captionedFrame({ imagePath, text, width, height, artStyle, textStyle }) {
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  const theme = resolveTextTheme(artStyle, textStyle), captionHeight = Math.round(height * .25);
  const image = await loadImage(imagePath), artHeight = height - captionHeight;
  ctx.fillStyle = theme.background; ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / image.width, artHeight / image.height);
  ctx.drawImage(image, (width - image.width * scale) / 2, (artHeight - image.height * scale) / 2, image.width * scale, image.height * scale);
  const layout = textLayout(ctx, text, width, captionHeight, theme.font, { maxFontSize: Math.min(width * .04, captionHeight * .3), maxWidth: width * .88, maxHeight: captionHeight * .78, lineSpacing: 1.4 });
  ctx.fillStyle = theme.ink; ctx.font = `bold ${layout.size}px ${theme.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const top = artHeight + (captionHeight - layout.lines.length * layout.lineHeight) / 2;
  layout.lines.forEach((line, i) => ctx.fillText(line, width / 2, top + layout.lineHeight * (i + .5)));
  return canvas.toBuffer('image/png');
}
