import nlp from "compromise";
import { isGenericAction, suggestRendering } from "./render-hints.js";
import type { ChunkRenderingHint, VisualCandidate } from "./render-hints.js";

/** Small visual chunks are selected by meaning, with a hard size safety limit. */
export interface ChunkOptions {
  maxWords?: number;
  wordsPerMinute?: number;
}

export interface ScriptChunk extends ChunkRenderingHint {
  /** Art-neutral scene direction selected by the visual planner. */
  imagePrompt?: string;
  displayText?: string;
  index: number;
  text: string;
  /** Inclusive UTF-16 offset in the original JavaScript string. */
  startOffset: number;
  /** Exclusive UTF-16 offset in the original JavaScript string. */
  endOffset: number;
  /** Number of whitespace-delimited words, including attached punctuation. */
  wordCount: number;
  /** Reading-time estimate; this is not an audio alignment timestamp. */
  estimatedDurationSeconds: number;
}

interface Word {
  start: number;
  end: number;
  tags: Set<string>;
  contentStart: number;
  contentEnd: number;
  normal: string;
  infinitive?: string;
  sentence: number;
}

// The library's json() return type is any; describe only the fields we consume.
interface TaggedSentence {
  terms: Array<{
    tags: string[];
    offset: { start: number; length: number };
  }>;
}

interface TaggedVerb extends TaggedSentence {
  verb: { infinitive: string };
}

interface ChunkSpan {
  start: number;
  end: number;
}

type VisualKind = "noun" | "description" | "action" | "number";

function resolveOptions(options: ChunkOptions): Required<ChunkOptions> {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Chunk options must be an object.");
  }
  const resolved = {
    maxWords: options.maxWords ?? 8,
    wordsPerMinute: options.wordsPerMinute ?? 150,
  };
  if (!Number.isSafeInteger(resolved.maxWords) || resolved.maxWords < 1) {
    throw new RangeError("maxWords must be a positive safe integer.");
  }
  if (!Number.isFinite(resolved.wordsPerMinute) || resolved.wordsPerMinute <= 0) {
    throw new RangeError("wordsPerMinute must be a positive finite number.");
  }
  return resolved;
}

function visualKind(word: Word): VisualKind | undefined {
  const tags = word.tags;
  // Pronouns are tagged as Noun too; auxiliaries/copulas are tagged as Verb.
  if (["my", "your", "his", "her", "its", "our", "their", "whose"].includes(word.normal)) return undefined;
  if (["Pronoun", "Determiner", "Conjunction", "Preposition", "QuestionWord", "Auxiliary", "Copula", "Modal", "Particle"].some((tag) => tags.has(tag))) {
    return undefined;
  }
  if (tags.has("Adjective")) return "description";
  if (tags.has("Noun")) return "noun";
  if (tags.has("Verb")) return "action";
  if (tags.has("Value")) return "number";
  return undefined;
}

function visualCandidates(script: string, words: Word[], span: ChunkSpan): VisualCandidate[] {
  return words.slice(span.start, span.end).flatMap((word) => {
    const kind = visualKind(word);
    if (kind === undefined) return [];
    return [{
      text: script.slice(word.contentStart, word.contentEnd),
      normal: word.normal,
      kind,
      ...(word.infinitive === undefined ? {} : { infinitive: word.infinitive }),
    }];
  });
}

/** Merge vague verb fragments, without absorbing independent abstract captions. */
function mergeGenericActions(script: string, words: Word[], spans: ChunkSpan[], maxWords: number): ChunkSpan[] {
  const merged: ChunkSpan[] = [];
  const isGeneric = (span: ChunkSpan): boolean => {
    const candidates = visualCandidates(script, words, span);
    return candidates.length > 0 && candidates.every(isGenericAction);
  };
  const fits = (left: ChunkSpan, right: ChunkSpan): boolean =>
    left.end === right.start && words[left.start]!.sentence === words[right.start]!.sentence &&
    right.end - left.start <= maxWords;

  for (let index = 0; index < spans.length; index += 1) {
    let current = { ...spans[index]! };
    if (isGeneric(current)) {
      const previous = merged[merged.length - 1];
      // "light to | help" is one idea; attach its infinitive backward before
      // considering "help | turn" as the beginning of the next image.
      const completesInfinitive = previous && words[previous.end - 1]!.normal === "to";
      if (previous && completesInfinitive && fits(previous, current)) {
        previous.end = current.end;
        continue;
      }
      // "use | light" and "try | to use | light" borrow the following subject.
      while (isGeneric(current) && spans[index + 1] && fits(current, spans[index + 1]!)) {
        current.end = spans[++index]!.end;
      }
      if (isGeneric(current) && previous && fits(previous, current)) {
        previous.end = current.end;
        continue;
      }
    }
    merged.push(current);
  }
  return merged;
}

function nounCompound(script: string, previous: Word, current: Word): boolean {
  if (visualKind(previous) !== "noun" || visualKind(current) !== "noun") return false;
  const between = script.slice(previous.contentEnd, current.contentStart);
  if (/^\s+$/u.test(between)) return true;
  // Keep honorifics and initials with names, without merging comma-separated nouns.
  const named = (word: Word) => word.tags.has("Person") || word.tags.has("ProperNoun");
  return named(previous) && named(current) && /^\.\s+$/u.test(between);
}

/**
 * Split before nouns, descriptive words, and actions that can suggest a new
 * image. Consecutive nouns form one visual phrase (for example, "group chat").
 * Leading function words stay with the first image; subsequent function words
 * remain with the preceding image. Generic verb fragments borrow neighboring
 * content where possible. Sentences are never merged, and every final chunk
 * receives an image-or-text rendering recommendation.
 *
 * English part-of-speech tags are a local heuristic for imageability, not a
 * semantic guarantee. Source whitespace inside chunks and UTF-16 offsets are
 * preserved, including words that the tagger does not recognize.
 */
export function chunkScript(script: string, options: ChunkOptions = {}): ScriptChunk[] {
  if (typeof script !== "string" || !script.trim()) {
    throw new TypeError("Script must be a non-empty string containing narration.");
  }
  const settings = resolveOptions(options);
  // Keep source words as the authority for output. The tagger may split a
  // hyphenated word or contraction into several terms; we merge their tags.
  const words: Word[] = Array.from(script.matchAll(/\S+/gu), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
    tags: new Set<string>(),
    contentStart: match.index + match[0].length,
    contentEnd: match.index,
    normal: match[0].toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""),
    sentence: 0,
  }));
  const sentenceStarts = new Set<number>([0]);
  const document = nlp(script);
  const sentences = document.json({ offset: true }) as TaggedSentence[];
  const wordsByOffset = new Map<number, Word>();
  let wordIndex = 0;
  for (const sentence of sentences) {
    let firstTerm = true;
    for (const term of sentence.terms) {
      // Expanded contraction terms can have zero length and no source text.
      if (term.offset.length === 0) continue;
      const termStart = term.offset.start;
      while (wordIndex < words.length && words[wordIndex]!.end <= termStart) wordIndex += 1;
      const word = words[wordIndex];
      if (!word || termStart < word.start) continue;
      if (firstTerm) {
        sentenceStarts.add(wordIndex);
        firstTerm = false;
      }
      for (const tag of term.tags) word.tags.add(tag);
      wordsByOffset.set(termStart, word);
      word.contentStart = Math.min(word.contentStart, termStart);
      word.contentEnd = Math.max(word.contentEnd, termStart + term.offset.length);
    }
  }
  for (const phrase of document.verbs().json({ offset: true }) as TaggedVerb[]) {
    for (const term of phrase.terms) {
      const word = wordsByOffset.get(term.offset.start);
      if (word && visualKind(word) === "action") word.infinitive = phrase.verb.infinitive;
    }
  }
  for (let index = 1; index < words.length; index += 1) {
    const gap = script.slice(words[index - 1]!.end, words[index]!.start);
    if (/(?:\r?\n)[\t ]*(?:\r?\n)/u.test(gap)) sentenceStarts.add(index);
  }

  const boundaries = new Set<number>([0, words.length]);
  let hasVisual = false;
  let sentenceIndex = -1;
  for (let index = 0; index < words.length; index += 1) {
    if (sentenceStarts.has(index)) {
      boundaries.add(index);
      hasVisual = false;
      sentenceIndex += 1;
    }
    const word = words[index]!;
    word.sentence = sentenceIndex;
    if (visualKind(word) === undefined) continue;
    const previous = words[index - 1];
    if (hasVisual && !(previous && nounCompound(script, previous, word))) {
      boundaries.add(index);
    }
    hasVisual = true;
  }

  const spans: ChunkSpan[] = [];
  const breaks = [...boundaries].sort((left, right) => left - right);
  for (let index = 0; index < breaks.length - 1; index += 1) {
    const visualEnd = breaks[index + 1]!;
    // The safety limit also handles long stretches with no imageable words.
    // It never merges adjacent visual chunks to meet a minimum length.
    for (let start = breaks[index]!; start < visualEnd;) {
      const end = start + Math.min(settings.maxWords, visualEnd - start);
      spans.push({ start, end });
      start = end;
    }
  }
  return mergeGenericActions(script, words, spans, settings.maxWords).map((span, index) => {
    const startOffset = words[span.start]!.start;
    const endOffset = words[span.end - 1]!.end;
    const wordCount = span.end - span.start;
    return {
      index,
      text: script.slice(startOffset, endOffset),
      startOffset,
      endOffset,
      wordCount,
      estimatedDurationSeconds: Number(((wordCount / settings.wordsPerMinute) * 60).toFixed(3)),
      ...suggestRendering(visualCandidates(script, words, span)),
    };
  });
}
