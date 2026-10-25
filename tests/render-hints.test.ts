import assert from "node:assert/strict";
import test from "node:test";
import { chunkScript, type ChunkOptions } from "../src/chunker.js";

function assertChunkIntegrity(script: string, options: ChunkOptions = {}): void {
  const chunks = chunkScript(script, options);
  let previousEnd = 0;
  assert.ok(chunks.length > 0);
  for (const [index, chunk] of chunks.entries()) {
    assert.equal(chunk.index, index);
    assert.equal(chunk.text, script.slice(chunk.startOffset, chunk.endOffset));
    assert.ok(chunk.text.length > 0);
    assert.equal(chunk.text, chunk.text.trim());
    assert.ok(chunk.startOffset >= previousEnd);
    assert.equal(script.slice(previousEnd, chunk.startOffset).trim(), "");
    assert.equal(chunk.wordCount, chunk.text.split(/\s+/u).length);
    assert.ok(chunk.wordCount <= (options.maxWords ?? 8));
    assert.equal(chunk.estimatedDurationSeconds,
      Number(((chunk.wordCount / (options.wordsPerMinute ?? 150)) * 60).toFixed(3)));
    assert.ok(chunk.renderHint === "image" || chunk.renderHint === "text");
    assert.equal(typeof chunk.renderReason, "string");
    assert.ok(chunk.renderReason.trim().length > 0);
    if (chunk.renderHint === "image") {
      assert.equal(typeof chunk.visualFocus, "string");
      assert.ok(chunk.visualFocus!.trim().length > 0);
    } else {
      assert.equal(chunk.visualFocus, null);
    }
    previousEnd = chunk.endOffset;
  }
  assert.equal(script.slice(previousEnd).trim(), "");
  assert.equal(chunks.map((chunk) => chunk.text).join("").replace(/\s/gu, ""),
    script.replace(/\s/gu, ""));
}

test("combines generic verbs with light into one useful image beat", () => {
  const script = "Its chloroplasts use light to help turn carbon dioxide into ingredients for sugar.";
  const chunks = chunkScript(script);
  const merged = chunks.find((chunk) => chunk.text === "use light to help");
  assert.ok(merged, JSON.stringify(chunks.map((chunk) => chunk.text)));
  assert.equal(merged.renderHint, "image");
  assert.match(merged.visualFocus!, /\blight\b/iu);
  assertChunkIntegrity(script);
});

test("keeps the requested six visual beats and marks concrete subjects for images", () => {
  const script = "A leaf is a tiny solar-powered kitchen, and somehow it runs without a group chat.";
  const chunks = chunkScript(script);
  assert.deepEqual(chunks.map((chunk) => chunk.text), [
    "A leaf is a",
    "tiny",
    "solar-powered",
    "kitchen, and somehow it",
    "runs without a",
    "group chat.",
  ]);
  for (const subject of ["leaf", "kitchen", "group chat"]) {
    const chunk = chunks.find((candidate) => candidate.text.includes(subject));
    assert.ok(chunk);
    assert.equal(chunk.renderHint, "image", subject);
    assert.ok(chunk.visualFocus?.toLowerCase().includes(subject), subject);
  }
  assertChunkIntegrity(script);
});

test("uses text for isolated generic verbs and abstract ideas", () => {
  for (const script of ["use", "help", "Use.", "HELP!", "idea", "An idea."]) {
    const chunks = chunkScript(script);
    assert.ok(chunks.every((chunk) => chunk.renderHint === "text"), script);
    assert.ok(chunks.every((chunk) => chunk.visualFocus === null), script);
    assertChunkIntegrity(script);
  }
});

test("handles common generic verb inflections and capitalization in context", () => {
  const scripts = [
    "Leaves use light to help make sugar.",
    "A leaf uses light to help make sugar.",
    "The leaf used light to help make sugar.",
    "Using light helps the leaf make sugar.",
    "Light helped the leaf make sugar.",
    "USE light to HELP make sugar.",
  ];
  for (const script of scripts) {
    const chunks = chunkScript(script);
    assert.ok(!chunks.some((chunk) => /^(?:use|uses|used|using|help|helps|helped)[.!?]?$/iu.test(chunk.text)),
      `${script}: ${JSON.stringify(chunks.map((chunk) => chunk.text))}`);
    const lightChunk = chunks.find((chunk) => /\blight\b/iu.test(chunk.text));
    assert.ok(lightChunk);
    assert.equal(lightChunk.renderHint, "image", script);
    assertChunkIntegrity(script);
  }
});

test("a one-word maximum preserves generic verbs as text beats", () => {
  const script = "Use light to help.";
  const chunks = chunkScript(script, { maxWords: 1 });
  assert.deepEqual(chunks.map((chunk) => chunk.text), script.split(" "));
  for (const text of ["Use", "help."]) {
    const chunk = chunks.find((candidate) => candidate.text === text)!;
    assert.equal(chunk.renderHint, "text");
    assert.equal(chunk.visualFocus, null);
  }
  assertChunkIntegrity(script, { maxWords: 1 });
});

test("phrasal verbs keep particles with the action and borrow its subject", () => {
  for (const [script, expected, focus] of [
    ["Turn off the light.", "Turn off the light.", "light"],
    ["Take off your coat.", "Take off your coat.", "coat"],
    ["Plants make use of light.", "make use of light.", "light"],
  ]) {
    const chunks = chunkScript(script!);
    const chunk = chunks.find((candidate) => candidate.text === expected);
    assert.ok(chunk, JSON.stringify(chunks.map((candidate) => candidate.text)));
    assert.equal(chunk.renderHint, "image");
    assert.equal(chunk.visualFocus, focus);
    assertChunkIntegrity(script!);
  }
  const limited = chunkScript("Turn off the light.", { maxWords: 1 });
  for (const text of ["Turn", "off", "the"]) {
    assert.equal(limited.find((chunk) => chunk.text === text)!.renderHint, "text");
  }
});

test("generic verb merging respects sentence and paragraph boundaries", () => {
  for (const [first, separator, second] of [
    ["Use.", " ", "Light helps."],
    ["Help!", " ", "Light shines."],
    ["Use", "\n\n", "light to help"],
    ["Help", "\r\n\r\n", "light shines"],
  ]) {
    const script = `${first}${separator}${second}`;
    const chunks = chunkScript(script);
    assert.ok(chunks.some((chunk) => chunk.endOffset === first!.length), script);
    assert.ok(chunks.every((chunk) => !(chunk.startOffset < first!.length && chunk.endOffset > first!.length)), script);
    assert.equal(chunks[0]!.text, first);
    assert.equal(chunks[0]!.renderHint, "text");
    assertChunkIntegrity(script);
  }
});

test("merged beats retain source offsets, whitespace, size limits, and timing", () => {
  const scripts = [
    "  Its chloroplasts use\tlight to help turn carbon dioxide into ingredients for sugar.  ",
    "Leaves use light to help make sugar.\r\n\r\nA leaf uses light to help make sugar.",
    "🧠 Leaves used light to help make sugar. Café plants use light to help grow.",
  ];
  for (const script of scripts) {
    for (const maxWords of [1, 2, 3, 4, 8]) {
      assertChunkIntegrity(script, { maxWords, wordsPerMinute: 120 });
    }
  }
});

test("all beats provide a consistent rendering recommendation and explanation", () => {
  for (const script of [
    "It is, and it was, but it will be.",
    "An idea can help.",
    "Photosynthesis turns light into energy.",
    "Three green leaves grow in a kitchen.",
    "Cells use light to help make sugar, and people use words to explain it.",
  ]) {
    assertChunkIntegrity(script);
  }
});
