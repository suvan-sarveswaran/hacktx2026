import type { ScriptChunk } from "./chunker.js";

export interface ComicPlan { title: string; continuity: string; panels: { caption: string; prompt: string }[] }
export const COMIC_SCHEMA = {
  type: "object", additionalProperties: false, required: ["title", "continuity", "panels"],
  properties: {
    title: { type: "string" }, continuity: { type: "string" },
    panels: { type: "array", items: { type: "object", additionalProperties: false, required: ["caption", "prompt"], properties: { caption: { type: "string" }, prompt: { type: "string" } } } },
  },
};
export const COMIC_RULES = `Create a cohesive educational comic, read left-to-right then top-to-bottom.
Plan a beginning, a logical cause-and-effect explanation, and a satisfying final takeaway. One idea and one action per panel. Keep the facts grounded; distinguish any analogy from the real mechanism.
Return title (at most 100 characters), continuity (at most 500 characters), and panels with caption and prompt.
Continuity is a visual bible: specify the same setting, recurring objects, and at most two characters with exact appearance, clothing and colors. Prefer concrete objects over a generic presenter. Keep these details identical in every applicable shot.
Each caption is 12–35 words and at most 240 characters. It explains the visible action in a complete sentence. Avoid vague pronouns. Dialogue, if useful, must identify its speaker in the caption. No floating unlabeled dialogue.
Each prompt is 50–900 characters: describe one clear visible action, spatial relationships, setting, shot size, and exactly which recurring subjects appear. Vary wide/detail shots to explain progress. Do not include multiple time steps in one image.
Images must be single illustrations without letters, labels, speech bubbles, borders, or panel grids. Captions and numbered gutters are typeset separately by the app. Never ask the image model to spell words.
Check before returning: every panel advances the explanation, every caption matches its picture, the ending answers the opening question, there are no contradictory facts or repeated shots.`;

export function readComic(value: unknown, count: number): ComicPlan {
  const comic = value as ComicPlan | null;
  if (!comic || typeof comic.title !== "string" || !comic.title.trim() || comic.title.length > 100 || typeof comic.continuity !== "string" || !comic.continuity.trim() || comic.continuity.length > 500 || !Array.isArray(comic.panels) || comic.panels.length !== count) throw new Error("The comic storyboard was incomplete. Retry with a shorter source; no image credits were used.");
  const prompts = new Set<string>();
  const captions = new Set<string>();
  for (const panel of comic.panels) {
    if (!panel || typeof panel.caption !== "string" || !panel.caption.trim() || panel.caption.length > 240 || typeof panel.prompt !== "string" || panel.prompt.trim().length < 50 || panel.prompt.length > 900) throw new Error("A comic panel needs a clear illustration and a concise caption. Retry the storyboard; no image credits were used.");
    const key = panel.prompt.trim().toLowerCase().replace(/\s+/g, " ");
    if (prompts.has(key)) throw new Error("The storyboard repeated a shot. Retry to create distinct comic panels.");
    const caption = panel.caption.trim().toLowerCase().replace(/\s+/g, " ");
    if (caption.split(" ").length < 6 || captions.has(caption)) throw new Error("The storyboard needs distinct, complete captions that advance the explanation. Retry the storyboard.");
    prompts.add(key);
    captions.add(caption);
  }
  return { title: comic.title.trim(), continuity: comic.continuity.trim(), panels: comic.panels.map(p => ({ caption: p.caption.trim(), prompt: p.prompt.trim() })) };
}

export function comicChunks(comic: ComicPlan): ScriptChunk[] {
  let offset = 0;
  return comic.panels.map((panel, index) => {
    const startOffset = offset; offset += panel.caption.length + 1;
    const wordCount = panel.caption.split(/\s+/).length;
    return { index, text: panel.caption, startOffset, endOffset: offset - 1, wordCount, estimatedDurationSeconds: wordCount / 2.5, renderHint: "image", renderReason: "One complete comic panel with a separately typeset caption.", visualFocus: null, imagePrompt: `Visual continuity: ${comic.continuity}\nPanel ${index + 1}: ${panel.prompt}\nSingle comic illustration. No text, letters, speech bubbles, or panel grid.`, displayText: panel.caption };
  });
}
