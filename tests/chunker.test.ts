import assert from "node:assert/strict";
import test from "node:test";
import { chunkScript, type ChunkOptions } from "../src/chunker.js";

function texts(script: string, options: ChunkOptions = {}): string[] {
  return chunkScript(script, options).map((chunk) => chunk.text);
}

function assertPreserved(script: string, options: ChunkOptions = {}): void {
  const chunks = chunkScript(script, options);
  assert.ok(chunks.length > 0);
  let previousEnd = 0;
  for (const [index, chunk] of chunks.entries()) {
    assert.equal(chunk.index, index);
    assert.ok(chunk.text.length > 0);
    assert.equal(chunk.text, chunk.text.trim());
    assert.equal(chunk.text, script.slice(chunk.startOffset, chunk.endOffset));
    assert.ok(chunk.startOffset >= previousEnd);
    assert.ok(chunk.endOffset > chunk.startOffset);
    assert.equal(script.slice(previousEnd, chunk.startOffset).trim(), "");
    assert.equal(chunk.wordCount, chunk.text.split(/\s+/u).length);
    assert.ok(chunk.wordCount <= (options.maxWords ?? 8));
    assert.equal(chunk.estimatedDurationSeconds,
      Number(((chunk.wordCount / (options.wordsPerMinute ?? 150)) * 60).toFixed(3)));
    previousEnd = chunk.endOffset;
  }
  assert.equal(script.slice(previousEnd).trim(), "");
  assert.equal(chunks.map((chunk) => chunk.text).join("").replace(/\s/gu, ""),
    script.replace(/\s/gu, ""));
}

test("splits the requested narration at individual visual concepts", () => {
  const script = "A leaf is a tiny solar-powered kitchen, and somehow it runs without a group chat.";
  assert.deepEqual(texts(script), [
    "A leaf is a",
    "tiny",
    "solar-powered",
    "kitchen, and somehow it",
    "runs without a",
    "group chat.",
  ]);
  assertPreserved(script);
});

test("starts separate beats at adjacent descriptive words", () => {
  assert.deepEqual(texts("A tiny green leaf."), ["A tiny", "green", "leaf."]);
});

test("retains leading function words and later connecting words with the previous concept", () => {
  assert.deepEqual(texts("A cat is a dog."), ["A cat is a", "dog."]);
});

test("commas and conjunctions wait for the next imageable word", () => {
  assert.deepEqual(texts("Water flows, and then it freezes."), [
    "Water",
    "flows, and then it",
    "freezes.",
  ]);
});

test("separates comma-delimited nouns while keeping the conjunction attached", () => {
  assert.deepEqual(texts("Apples, pears, and grapes."), ["Apples,", "pears, and", "grapes."]);
});

test("keeps adjacent nouns in familiar compound concepts together", () => {
  const chunks = texts("The carbon dioxide enters a group chat.");
  assert.ok(chunks.some((chunk) => chunk.includes("carbon dioxide")));
  assert.ok(chunks.some((chunk) => chunk.includes("group chat")));
  assertPreserved("The carbon dioxide enters a group chat.");
});

test("creates action beats without creating beats for auxiliary verbs", () => {
  const chunks = texts("A robot is running and it can jump.");
  assert.ok(chunks.some((chunk) => chunk.startsWith("running")));
  assert.ok(chunks.some((chunk) => chunk.startsWith("jump")));
  assert.ok(chunks.every((chunk) => !/^(?:is|can|and|it)\b/u.test(chunk)));
  assertPreserved("A robot is running and it can jump.");
});

test("always ends a chunk at a sentence boundary, even for short sentences", () => {
  const script = "A cat sleeps. A dog runs! Is it? It is.";
  const chunks = chunkScript(script);
  for (const ending of ["sleeps.", "runs!", "it?", "is."]) {
    const endOffset = script.indexOf(ending) + ending.length;
    assert.ok(chunks.some((chunk) => chunk.endOffset === endOffset), ending);
    assert.ok(chunks.every((chunk) => !(chunk.startOffset < endOffset && chunk.endOffset > endOffset)), ending);
  }
  assertPreserved(script);
});

test("recognizes sentence endings inside closing quotation marks", () => {
  const first = "She said, “Cells are busy!”";
  const script = `${first} Then they rest.`;
  const chunks = chunkScript(script);
  assert.ok(chunks.some((chunk) => chunk.endOffset === first.length));
  assert.ok(chunks.every((chunk) => !(chunk.startOffset < first.length && chunk.endOffset > first.length)));
  assertPreserved(script);
});

test("does not treat an abbreviation as a sentence ending", () => {
  assert.deepEqual(texts("It is e.g. as it was."), ["It is e.g. as it was."]);
});

test("preserves source whitespace inside chunks, offsets, and estimated timing", () => {
  const script = "  A\tleaf is a tiny solar-powered kitchen.\r\n\r\nIt runs without a group\tchat.  ";
  assertPreserved(script, { wordsPerMinute: 120 });
  const chunks = chunkScript(script);
  assert.equal(chunks[0]!.text, "A\tleaf is a");
  assert.ok(chunks.some((chunk) => chunk.text.includes("group\tchat")));
});

test("retains Unicode with JavaScript string offsets, including surrogate pairs", () => {
  const script = "\u2003🧠 Café science asks why naïve assumptions fail. “Voilà!” says Zoë, while José writes notes—very carefully—about cells and energy.\u00a0";
  assertPreserved(script);
  assert.equal(chunkScript(script)[0]!.startOffset, 1);
});

test("keeps decimal numbers, thousands separators, abbreviations, and hyphens intact", () => {
  const script = "Dr. J. Rivera found 3.14 in 10,000 solar-powered samples in the U.S. today.";
  const chunks = texts(script);
  for (const token of ["Dr.", "J.", "3.14", "10,000", "solar-powered", "U.S."]) {
    assert.ok(chunks.some((chunk) => chunk.split(/\s+/u).includes(token)), token);
  }
  assertPreserved(script);
});

test("preserves filler-only narration without inventing punctuation breaks", () => {
  const script = "It is, and it was, but it will be.";
  assert.deepEqual(texts(script, { maxWords: 20 }), [script]);
  assertPreserved(script, { maxWords: 20 });
});

test("uses an eight-word default safety limit when no semantic split is available", () => {
  const script = Array.from({ length: 53 }, () => "it").join(" ");
  const chunks = chunkScript(script);
  assert.deepEqual(chunks.map((chunk) => chunk.wordCount), [8, 8, 8, 8, 8, 8, 5]);
  assertPreserved(script);
});

test("enforces a custom word maximum even within a noun compound", () => {
  const script = "A group chat discusses carbon dioxide.";
  assert.deepEqual(texts(script, { maxWords: 1 }), script.split(" "));
  assertPreserved(script, { maxWords: 1 });
  assertPreserved("it and it and it and it and it and it", { maxWords: 3 });
});

test("calculates reading estimates for single-word and multiword visual beats", () => {
  const chunks = chunkScript("A tiny green leaf.", { wordsPerMinute: 120 });
  assert.deepEqual(chunks.map((chunk) => chunk.estimatedDurationSeconds), [1, 0.5, 0.5]);
  assertPreserved("A tiny green leaf.", { wordsPerMinute: 180 });
});

test("preserves every character across varied narrations and size limits", () => {
  const phrases = [
    "Cells are busy.", "They make energy,", "but they need food", "e.g. sugar and oxygen",
    "3.14 is a number;", "🧠 Voilà!", "apples, pears, and grapes", "a solar-powered group chat",
  ];
  for (let length = 1; length <= 30; length += 1) {
    const script = Array.from({ length }, (_, index) => phrases[(index * 3 + length) % phrases.length]).join(" \n");
    assertPreserved(script, { maxWords: (length % 9) + 1 });
  }
});

test("rejects empty or non-string scripts", () => {
  for (const script of ["", " \t\r\n ", null, undefined, 42]) {
    assert.throws(() => chunkScript(script as string), /Script must/);
  }
});

test("rejects invalid word limits and speech rates", () => {
  for (const maxWords of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => chunkScript("Some actual narration.", { maxWords }), RangeError);
  }
  for (const wordsPerMinute of [0, -1, NaN, Infinity]) {
    assert.throws(() => chunkScript("Some actual narration.", { wordsPerMinute }), RangeError);
  }
  for (const options of [null, [], "invalid", 42]) {
    assert.throws(() => chunkScript("Some actual narration.", options as unknown as ChunkOptions), TypeError);
  }
});
