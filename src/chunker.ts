/** Options for grouping narration into image-sized beats. */
export interface ChunkOptions {
  minWords?: number;
  targetWords?: number;
  maxWords?: number;
  wordsPerMinute?: number;
}

export interface ScriptChunk {
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
  text: string;
  start: number;
  end: number;
}

type BoundaryKind = "sentence" | "clause" | "conjunction";

const DEFAULTS: Required<ChunkOptions> = {
  minWords: 8,
  targetWords: 24,
  maxWords: 40,
  wordsPerMinute: 150,
};

// These are deliberately conservative: missing one pause is preferable to
// turning a title, initial, or abbreviation into its own narration beat.
const ABBREVIATIONS = new Set([
  "mr.", "mrs.", "ms.", "dr.", "prof.", "sr.", "jr.", "st.",
  "vs.", "etc.", "e.g.", "i.e.", "a.m.", "p.m.", "no.", "fig.",
  "eq.", "dept.", "inc.", "approx.", "est.", "al.",
]);

const CONJUNCTIONS = new Set([
  "and", "but", "or", "so", "yet", "because", "although", "though",
  "while", "whereas", "unless", "however", "therefore", "instead",
]);

const CLAUSE_STARTERS = new Set([
  "i", "you", "he", "she", "it", "we", "they", "this", "that",
  "these", "those", "there", "the", "a", "an", "our", "your",
  "their", "his", "her", "its", "my",
]);

function withoutClosingQuotes(text: string): string {
  return text.replace(/["'\u201d\u2019)\]}\u00bb]+$/u, "");
}

function bareWord(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase();
}

function endsSentence(text: string): boolean {
  const cleaned = withoutClosingQuotes(text).replace(/^["'\u201c\u2018(\[{\u00ab]+/u, "");
  if (/[!?]+$/u.test(cleaned)) return true;
  if (!cleaned.endsWith(".")) return false;
  if (ABBREVIATIONS.has(cleaned.toLowerCase())) return false;
  // Initials and dotted acronyms such as J., U.S., and Ph.D.
  if (/^\p{Lu}\.$/u.test(cleaned) || /^(?:\p{L}{1,3}\.){2,}$/u.test(cleaned)) {
    return false;
  }
  return true;
}

function resolveOptions(options: ChunkOptions): Required<ChunkOptions> {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Chunk options must be an object.");
  }
  const resolved = {
    minWords: options.minWords ?? DEFAULTS.minWords,
    targetWords: options.targetWords ?? DEFAULTS.targetWords,
    maxWords: options.maxWords ?? DEFAULTS.maxWords,
    wordsPerMinute: options.wordsPerMinute ?? DEFAULTS.wordsPerMinute,
  };
  for (const key of ["minWords", "targetWords", "maxWords"] as const) {
    if (!Number.isSafeInteger(resolved[key]) || resolved[key] < 1) {
      throw new RangeError(`${key} must be a positive safe integer.`);
    }
  }
  if (resolved.minWords > resolved.targetWords || resolved.targetWords > resolved.maxWords) {
    throw new RangeError("Chunk sizes must satisfy minWords <= targetWords <= maxWords.");
  }
  if (!Number.isFinite(resolved.wordsPerMinute) || resolved.wordsPerMinute <= 0) {
    throw new RangeError("wordsPerMinute must be a positive finite number.");
  }
  return resolved;
}

/**
 * Split an English narration without another model request. Sentence endings
 * take precedence over clause punctuation, then conjunctions, then word breaks.
 * The maximum is hard; the minimum and target are preferences. Only whitespace
 * between chunks is omitted, and every chunk retains its exact source offsets.
 *
 * Words are whitespace-delimited, so scripts in languages without word spaces
 * should use a language-specific segmenter before this function.
 */
export function chunkScript(script: string, options: ChunkOptions = {}): ScriptChunk[] {
  if (typeof script !== "string" || script.trim().length === 0) {
    throw new TypeError("Script must be a non-empty string containing narration.");
  }
  const settings = resolveOptions(options);
  const words: Word[] = Array.from(script.matchAll(/\S+/gu), (match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));

  const boundaries: Record<BoundaryKind, Set<number>> = {
    sentence: new Set([words.length]),
    clause: new Set(),
    conjunction: new Set(),
  };
  const avoidWordBreak = new Set<number>();
  const commas = new Set<number>();
  let previousComma: number | undefined;

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const end = index + 1;
    const cleaned = withoutClosingQuotes(word.text);
    const next = words[end];
    const gap = next ? script.slice(word.end, next.start) : "";
    if (endsSentence(word.text) || /(?:\r?\n)[\t ]*(?:\r?\n)/u.test(gap)) {
      boundaries.sentence.add(end);
      previousComma = undefined;
    } else if (/[;:\u2014\u2013]$/u.test(cleaned) || cleaned === "--") {
      boundaries.clause.add(end);
      previousComma = undefined;
    } else if (cleaned.endsWith(",")) {
      commas.add(end);
      boundaries.clause.add(end);
      // Short comma-separated phrases are probably list items. Keep the run
      // together when another legal break fits within the hard maximum.
      if (previousComma !== undefined && end - previousComma <= 3) {
        for (let position = previousComma; position <= end; position += 1) {
          avoidWordBreak.add(position);
        }
      }
      previousComma = end;
    }
  }

  for (let index = 1; index < words.length; index += 1) {
    const conjunction = bareWord(words[index]!.text);
    if (!CONJUNCTIONS.has(conjunction)) continue;
    // A fallback split immediately after "because" or "and" strands the
    // conjunction in the preceding beat.
    avoidWordBreak.add(index + 1);
    const nextWord = words[index + 1];
    const isCoordination = conjunction === "and" || conjunction === "or";
    const likelyClause = !isCoordination ||
      (nextWord !== undefined && CLAUSE_STARTERS.has(bareWord(nextWord.text)));
    if (!likelyClause || (commas.has(index) && avoidWordBreak.has(index))) {
      avoidWordBreak.add(index);
      continue;
    }
    boundaries.conjunction.add(index);
  }

  for (const end of commas) {
    if (avoidWordBreak.has(end)) boundaries.clause.delete(end);
  }

  const chunks: ScriptChunk[] = [];
  let start = 0;
  while (start < words.length) {
    const maximum = Math.min(start + settings.maxWords, words.length);
    const minimum = Math.min(start + settings.minWords, words.length);
    const target = start + settings.targetWords;

    const score = (end: number): number => {
      const remainder = words.length - end;
      // Avoid leaving a tiny last chunk when there is a comparable alternative.
      const shortTailPenalty = remainder > 0 && remainder < settings.minWords
        ? settings.maxWords
        : 0;
      return Math.abs(end - target) + shortTailPenalty;
    };
    const best = (candidates: ReadonlySet<number>): number | undefined => {
      let chosen: number | undefined;
      // Only inspect the current window, keeping the total work linear even
      // for scripts with thousands of sentence boundaries.
      for (let end = minimum; end <= maximum; end += 1) {
        if (!candidates.has(end)) continue;
        if (chosen === undefined || score(end) < score(chosen)) chosen = end;
      }
      return chosen;
    };

    let end = best(boundaries.sentence) ?? best(boundaries.clause) ?? best(boundaries.conjunction);
    if (end === undefined) {
      const wordBreaks = new Set<number>();
      for (let position = minimum; position <= maximum; position += 1) {
        if (!avoidWordBreak.has(position)) wordBreaks.add(position);
      }
      end = best(wordBreaks) ?? maximum;
    }

    const startOffset = words[start]!.start;
    const endOffset = words[end - 1]!.end;
    const wordCount = end - start;
    chunks.push({
      index: chunks.length,
      text: script.slice(startOffset, endOffset),
      startOffset,
      endOffset,
      wordCount,
      estimatedDurationSeconds: Number(((wordCount / settings.wordsPerMinute) * 60).toFixed(3)),
    });
    start = end;
  }
  return chunks;
}
