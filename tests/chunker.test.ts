import assert from "node:assert/strict";
import test from "node:test";
import { chunkScript, type ChunkOptions } from "../src/chunker.js";

function assertPreserved(script: string, options: ChunkOptions = {}): void {
  const chunks = chunkScript(script, options);
  assert.ok(chunks.length > 0);
  let previousEnd = 0;
  for (const [index, chunk] of chunks.entries()) {
    assert.equal(chunk.index, index);
    assert.equal(chunk.text, script.slice(chunk.startOffset, chunk.endOffset));
    assert.ok(chunk.startOffset >= previousEnd);
    assert.equal(script.slice(previousEnd, chunk.startOffset).trim(), "");
    assert.equal(chunk.wordCount, chunk.text.split(/\s+/u).length);
    assert.ok(chunk.wordCount <= (options.maxWords ?? 40));
    assert.equal(chunk.estimatedDurationSeconds,
      Number(((chunk.wordCount / (options.wordsPerMinute ?? 150)) * 60).toFixed(3)));
    previousEnd = chunk.endOffset;
  }
  assert.equal(script.slice(previousEnd).trim(), "");
  assert.equal(chunks.map((chunk) => chunk.text).join("").replace(/\s/gu, ""),
    script.replace(/\s/gu, ""));
}

test("preserves source text, whitespace within chunks, offsets, and estimated timing", () => {
  const script = "  Biology is the study of living things.\r\n\r\nCells\tare tiny factories with surprisingly complicated office politics.  ";
  assertPreserved(script, { minWords: 3, targetWords: 8, maxWords: 12, wordsPerMinute: 120 });
  const chunks = chunkScript(script, { minWords: 3, targetWords: 8, maxWords: 12 });
  assert.equal(chunks[0]!.text, "Biology is the study of living things.");
  assert.ok(chunks[1]!.text.includes("Cells\tare"));
});

test("prefers full sentences and preserves titles, initials, and dotted abbreviations", () => {
  const first = "Dr. J. Rivera teaches biology in the U.S. every Monday.";
  const second = "Today, we explore why mitochondria deserve better public relations.";
  const chunks = chunkScript(`${first} ${second}`, { minWords: 3, targetWords: 8, maxWords: 12 });
  assert.deepEqual(chunks.map((chunk) => chunk.text), [first, second]);
  assertPreserved(`${first} ${second}`, { minWords: 3, targetWords: 8, maxWords: 12 });
});

test("keeps decimals and comma-separated numbers intact", () => {
  const script = "The result was 3.14 after testing 10,000 samples, which is a surprisingly large number of tiny experiments for one afternoon in the lab.";
  const chunks = chunkScript(script, { minWords: 4, targetWords: 10, maxWords: 16 });
  assert.ok(chunks.some((chunk) => chunk.text.includes("3.14")));
  assert.ok(chunks.some((chunk) => chunk.text.includes("10,000")));
  assert.equal(chunks[0]!.text, "The result was 3.14 after testing 10,000 samples,");
  assertPreserved(script, { minWords: 4, targetWords: 10, maxWords: 16 });
});

test("uses a conjunction before resorting to a word boundary in a long sentence", () => {
  const script = "The professor starts with a simple explanation of gravity but the room quickly discovers that falling objects do not care about anyone's confidence";
  const chunks = chunkScript(script, { minWords: 5, targetWords: 12, maxWords: 15 });
  assert.equal(chunks[0]!.text, "The professor starts with a simple explanation of gravity");
  assert.ok(chunks[1]!.text.startsWith("but "));
  assertPreserved(script, { minWords: 5, targetWords: 12, maxWords: 15 });
});

test("avoids comma-list breaks when the whole list fits", () => {
  const script = "This sentence names several familiar objects including apples, pears, oranges, bananas, and grapes before explaining what these examples have in common";
  const chunks = chunkScript(script, { minWords: 4, targetWords: 10, maxWords: 15 });
  assert.ok(chunks.some((chunk) => chunk.text.includes("apples, pears, oranges, bananas, and grapes")));
  assertPreserved(script, { minWords: 4, targetWords: 10, maxWords: 15 });
});

test("splits long unpunctuated narration with a hard word maximum", () => {
  const script = Array.from({ length: 153 }, (_, index) => `word${index}`).join(" ");
  const chunks = chunkScript(script);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.wordCount >= 8 && chunk.wordCount <= 40));
  assertPreserved(script);
});

test("short scripts remain valid even below the preferred minimum", () => {
  assert.equal(chunkScript("Hello there.")[0]!.text, "Hello there.");
  assert.equal(chunkScript("Hello there.")[0]!.estimatedDurationSeconds, 0.8);
});

test("retains Unicode and uses JavaScript string offsets, including surrogate pairs", () => {
  const script = "\u2003🧠 Café science asks why naïve assumptions fail. “Voilà!” says Zoë, while José writes notes—very carefully—about cells and energy.\u00a0";
  assertPreserved(script, { minWords: 3, targetWords: 7, maxWords: 10 });
  assert.equal(chunkScript(script)[0]!.startOffset, 1);
});

test("handles quoted sentence endings and paragraph pauses", () => {
  const script = "She said, “Cells are remarkably busy!”\n\nThen we counted all their jobs today";
  const chunks = chunkScript(script, { minWords: 3, targetWords: 6, maxWords: 9 });
  assert.equal(chunks[0]!.text, "She said, “Cells are remarkably busy!”");
  assertPreserved(script, { minWords: 3, targetWords: 6, maxWords: 9 });
});

test("preserves all content across varied generated inputs and settings", () => {
  const phrases = ["Cells are busy.", "They make energy,", "but they need food", "e.g. sugar and oxygen", "3.14 is a number;", "🧠 Voilà!", "apples, pears, and grapes"];
  for (let length = 1; length <= 45; length += 1) {
    const script = Array.from({ length }, (_, index) => phrases[(index * 3 + length) % phrases.length]).join(" \n");
    assertPreserved(script, { minWords: 2, targetWords: 5, maxWords: 9 });
  }
});

test("rejects empty scripts and invalid options", () => {
  for (const script of ["", " \t\r\n ", null, 42]) {
    assert.throws(() => chunkScript(script as string), /Script must/);
  }
  for (const options of [
    { minWords: 0 }, { maxWords: -1 }, { targetWords: 1.5 }, { minWords: Infinity },
    { minWords: 25 }, { maxWords: 20 }, { wordsPerMinute: 0 }, { wordsPerMinute: NaN },
    { wordsPerMinute: Infinity }, { minWords: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.throws(() => chunkScript("Some actual narration.", options), RangeError);
  }
  assert.throws(() => chunkScript("Some actual narration.", null as unknown as ChunkOptions), TypeError);
});
