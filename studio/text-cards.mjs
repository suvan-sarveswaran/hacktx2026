import { createCanvas } from '@napi-rs/canvas';

const themes = {
  doodle: { background: '#fffdf6', ink: '#29263d', accent: '#b6a1e6', font: '"Segoe Print", "Comic Sans MS", sans-serif' },
  vector: { background: '#fff5df', ink: '#183e49', accent: '#ed977c', font: '"Segoe UI", sans-serif' },
  pencil: { background: '#f5f1e6', ink: '#314c43', accent: '#b0a0c9', font: 'Georgia, serif' },
  cinematic: { background: '#18232f', ink: '#fff5dd', accent: '#e8b365', font: 'Georgia, serif' },
};

export function resolveTextTheme(artStyle = '', textStyle = 'auto') {
  const name = textStyle !== 'auto' && themes[textStyle] ? textStyle
    : /cinematic|photoreal|film|dramatic/iu.test(artStyle) ? 'cinematic'
    : /pencil|storybook|watercolor/iu.test(artStyle) ? 'pencil'
    : /vector|editorial|geometric/iu.test(artStyle) ? 'vector' : 'doodle';
  return { name, ...themes[name] };
}

/** Measure actual glyph widths, keeping long words and portrait cards inside safe margins. */
export function textLayout(ctx, text, width, height, font) {
  const words = text.trim().replace(/\s+/gu, ' ').split(' '), maxWidth = width * .78, maxHeight = height * .67;
  for (let size = Math.round(Math.min(width * .115, height * .17)); size >= 8; size--) {
    ctx.font = `bold ${size}px ${font}`;
    const lines = []; let line = '';
    for (const word of words) {
      if (ctx.measureText(word).width > maxWidth) {
        if (line) { lines.push(line); line = ''; }
        for (const char of word) {
          if (ctx.measureText(line + char).width > maxWidth && line) { lines.push(line); line = ''; }
          line += char;
        }
      } else if (ctx.measureText(`${line} ${word}`.trim()).width > maxWidth && line) {
        lines.push(line); line = word;
      } else line = `${line} ${word}`.trim();
    }
    if (line) lines.push(line);
    const lineHeight = size * 1.3;
    if (lines.length * lineHeight <= maxHeight) return { size, lines, lineHeight, maxWidth };
  }
  throw new Error('Text card is too long to fit. Shorten the on-screen caption.');
}

export function createTextCard({ text, width = 1280, height = 720, artStyle, textStyle }) {
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  const theme = resolveTextTheme(artStyle, textStyle);
  ctx.fillStyle = theme.background; ctx.fillRect(0, 0, width, height);
  const layout = textLayout(ctx, text, width, height, theme.font);
  const top = (height - layout.lines.length * layout.lineHeight) / 2;
  ctx.strokeStyle = theme.accent; ctx.fillStyle = theme.accent;
  ctx.lineWidth = Math.max(2, width * .004); ctx.lineCap = 'round';
  if (theme.name === 'vector') {
    ctx.fillRect(width * .08, height * .12, width * .13, height * .022);
    ctx.beginPath(); ctx.arc(width * .9, height * .86, Math.min(width, height) * .035, 0, Math.PI * 2); ctx.fill();
  } else if (theme.name === 'cinematic') {
    for (const y of [height * .13, height * .87]) { ctx.beginPath(); ctx.moveTo(width * .4, y); ctx.lineTo(width * .6, y); ctx.stroke(); }
  } else if (theme.name === 'pencil') {
    ctx.globalAlpha = .08; ctx.lineWidth = Math.max(1, width * .001);
    for (let y = 0; y < height; y += 7) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y + 2); ctx.stroke(); }
    ctx.globalAlpha = 1;
  } else {
    const y = Math.min(height * .86, top + layout.lines.length * layout.lineHeight + height * .025);
    ctx.beginPath(); ctx.moveTo(width * .35, y); ctx.quadraticCurveTo(width * .5, y + height * .02, width * .65, y - height * .005); ctx.stroke();
  }
  ctx.fillStyle = theme.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  layout.lines.forEach((line, i) => ctx.fillText(line, width / 2, top + layout.lineHeight * (i + .5)));
  return canvas.toBuffer('image/png');
}
