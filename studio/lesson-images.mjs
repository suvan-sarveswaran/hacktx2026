import { createHash } from 'node:crypto';
import { validateLesson } from './video.mjs';

export const DEFAULT_STYLE = 'Minimalist hand-drawn stick-figure doodles on a warm white background. Thick clean black lines, one purple accent color, simple flat composition, consistent character proportions. No text, labels, watermarks, borders, or photorealism.';
export const digest = value => createHash('sha256').update(value).digest('hex');
export function normalizeProjectLesson(input) {
  const lesson = validateLesson(input);
  lesson.chunks = lesson.chunks.map((chunk, index) => {
    const original = input.chunks[index];
    const prompt = original.imagePrompt ?? original.image_prompt ?? original.prompt;
    if (prompt !== undefined && (typeof prompt !== 'string' || prompt.length > 3000))
      throw new Error(`Chunk ${index}: image prompt must be a string of at most 3,000 characters.`);
    return { ...original, ...chunk, ...(prompt?.trim() ? { imagePrompt: prompt.trim() } : {}) };
  });
  return { ...input, ...lesson };
}
export function normalizeStyle(input = DEFAULT_STYLE) {
  if (typeof input !== 'string' || !input.trim() || input.length > 1000) throw new Error('Art style must contain 1–1,000 characters.');
  return input.trim();
}
export function baseImagePrompt(lesson, chunk) {
  if (chunk.imagePrompt) return chunk.imagePrompt;
  const before = Math.max(0, chunk.index - 1), after = Math.min(lesson.chunks.length, chunk.index + 2);
  const context = lesson.chunks.slice(before, after).map(c => c.text).join(' ').slice(0, 800);
  return `Illustrate one clear visual idea for an educational video about ${lesson.title}.\n` +
    `Main subject: ${chunk.visualFocus || chunk.text}.\nNarration beat: ${chunk.text.slice(0,1500)}\n` +
    `Nearby narration for context only: ${context}\nFocus on this beat, with a readable silhouette and uncluttered scene.`;
}
export function styledImagePrompt(lesson, chunk, style) {
  const bookkeeping = new Set(['index','text','startOffset','endOffset','wordCount','estimatedDurationSeconds','imagePrompt','image_prompt','prompt']);
  if (['local-storyboard-v1','local-storyboard-v2','local-storyboard-v3','authored-local-refinement','custom-prompt-edit'].includes(chunk.sceneContext?.generatedBy)) bookkeeping.add('sceneContext');
  const chunkRequirements = Object.fromEntries(Object.entries(chunk).filter(([key])=>!bookkeeping.has(key)));
  const globalRequirements = Object.fromEntries(Object.entries(lesson).filter(([key])=>!['title','script','chunks','images','artStyle','imageAspect','metadata'].includes(key)));
  if(lesson.metadata && typeof lesson.metadata==='object') {
    const useful=Object.fromEntries(Object.entries(lesson.metadata).filter(([key])=>!['model','wordCount','chunkCount','estimatedDurationSeconds','generationMs','chunkingMs','storyboard'].includes(key)));
    if(Object.keys(useful).length)globalRequirements.metadata=useful;
  }
  const requirements = `\n\nCHUNK REQUIREMENTS (JSON; follow visual constraints, do not draw field names):\n${JSON.stringify(chunkRequirements)}` +
    (Object.keys(globalRequirements).length ? `\n\nLESSON-WIDE REQUIREMENTS (JSON):\n${JSON.stringify(globalRequirements)}` : '');
  const prompt = `${baseImagePrompt(lesson, chunk)}${requirements}\n\nART DIRECTION FOR EVERY FRAME:\n${normalizeStyle(style)}`;
  if (prompt.length > 4000) throw new Error(`Chunk ${chunk.index}: prompt, metadata requirements and style exceed 4,000 characters. Shorten them before generating; requirements are never silently truncated.`);
  return prompt;
}

export function imageDimensions(aspect = 'square') {
  const formats = {landscape: [1280,720], square: [1024,1024], portrait: [720,1280]};
  if (!Object.hasOwn(formats, aspect)) throw new Error('Choose landscape, square, or portrait image aspect ratio.');
  const [width,height] = formats[aspect]; return {imageAspect:aspect,width,height};
}
export function imageVersionKey(prompt, {width,height}) {
  return width===1024 && height===1024 ? digest(prompt) : digest(JSON.stringify({prompt,width,height}));
}
