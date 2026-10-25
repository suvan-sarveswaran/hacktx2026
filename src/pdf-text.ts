/** Geometry-based reading order for untagged textbook columns and exported slides. */
export interface TextBox { text: string; x: number; y: number; width: number; height: number; }

export function cleanSourceText(text: string): string {
  return text.normalize("NFC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b\ufeff]/g, "")
    .replace(/\u00ad\s*\n\s*/g, "").replace(/\u00ad/g, "")
    .replace(/ﬁ/g, "fi").replace(/ﬂ/g, "fl").replace(/ﬀ/g, "ff").replace(/ﬃ/g, "ffi").replace(/ﬄ/g, "ffl")
    .replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ")
    .replace(/(\p{L}{2,})-\n\s*(\p{Ll})/gu, "$1$2")
    .split("\n").map((line) => line.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
}

export function readTextBoxes(boxes: TextBox[], depth = 0): string {
  if (!boxes.length) return "";
  const heights = boxes.map((b) => b.height).sort((a, b) => a - b);
  const unit = heights[Math.floor(heights.length / 2)] || 12;
  // Cut along empty gutters before sorting lines; sorting only by Y interleaves columns.
  if (depth < 20 && boxes.length > 3) {
    for (const axis of ["x", "y"] as const) {
      const size = axis === "x" ? "width" : "height";
      const sorted = [...boxes].sort((a, b) => a[axis] - b[axis]);
      let end = sorted[0]![axis] + sorted[0]![size];
      let best = -1, gap = axis === "x" ? Math.max(24, unit * 2) : unit * .7;
      for (let i = 1; i < sorted.length; i++) {
        const next = sorted[i]!;
        const space = next[axis] - end;
        if (space > gap && (axis === "y" || (i > 1 && i < sorted.length - 1))) { gap = space; best = i; }
        end = Math.max(end, next[axis] + next[size]);
      }
      if (best !== -1) return `${readTextBoxes(sorted.slice(0, best), depth + 1)}\n\n${readTextBoxes(sorted.slice(best), depth + 1)}`;
    }
  }
  const rows: { y: number; boxes: TextBox[] }[] = [];
  for (const box of [...boxes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.findLast((r) => Math.abs(r.y - box.y) < Math.max(2, Math.min(unit, box.height) * .45));
    if (row) row.boxes.push(box); else rows.push({ y: box.y, boxes: [box] });
  }
  return rows.map((row) => {
    const ordered = row.boxes.sort((a, b) => a.x - b.x);
    return ordered.map((b, i) => {
      const prev = ordered[i - 1];
      const space = prev && b.x - (prev.x + prev.width) > Math.min(unit, b.height) * .15 && !/\s$/.test(prev.text) && !/^\s/.test(b.text);
      return (space ? " " : "") + b.text;
    }).join("");
  }).join("\n");
}

/** Only repeated marginal lines are removed, never repeated body sentences. */
export function removeRunningFurniture(pages: string[], margins: string[][]): string[] {
  if (pages.length < 3) return pages;
  const lines = pages.map((page) => page.split("\n"));
  const frequency = new Map<string, number>();
  const key = (s: string) => s.trim().replace(/\d+/g, "#");
  for (const page of margins) {
    const edges = page.filter((s) => s.trim().length > 0 && s.length < 100);
    for (const value of new Set(edges.map(key))) frequency.set(value, (frequency.get(value) ?? 0) + 1);
  }
  return lines.map((page, pageIndex) => page.filter((line, i) => {
    const marginal = (i < 2 || i >= page.length - 2) && margins[pageIndex]?.includes(line.trim());
    return !marginal || line.length >= 100 || (frequency.get(key(line)) ?? 0) < Math.max(3, Math.ceil(pages.length * .6));
  }).join("\n").trim());
}

export function imageTextAdditions(native: string, ocr: string): string {
  const words = (text: string) => text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const known = new Set(words(native));
  return ocr.split("\n").filter((line) => {
    const tokens = words(line);
    return tokens.length > 0 && tokens.filter((t) => !known.has(t)).length / tokens.length > .5;
  }).join("\n");
}
