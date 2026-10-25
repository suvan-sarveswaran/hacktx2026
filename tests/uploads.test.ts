import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { readLessonFile } from "../web/src/files.js";

test("text uploads preserve UTF-8 source and the project's real sample file", async () => {
  const source = await readFile("examples/source.txt", "utf8");
  assert.equal(await readLessonFile({ name: "source.txt", size: Buffer.byteLength(source), text: async () => source }), source);
  const unicode = "# The sun ☀\n\nEnergy → ATP.\n";
  assert.equal(await readLessonFile({ name: "NOTES.MD", size: Buffer.byteLength(unicode), text: async () => unicode }), unicode);
});

test("uploads reject unsupported, empty, oversized, and non-text files with useful errors", async () => {
  for (const [name, size, text, error] of [
    ["slides.pptx", 20, "slides", /\.pdf, \.txt or \.md/],
    ["notes.txt", 5, " \r\n ", /empty/],
    ["large.txt", 320_001, "small content", /too big/],
    ["long.txt", 80_001, "a".repeat(80_001), /80,000/],
    ["binary.txt", 10, "a\0b", /UTF-8/],
    ["encoded.txt", 5, "�", /UTF-8/],
  ] as const) {
    await assert.rejects(readLessonFile({ name, size, text: async () => text }), error);
  }
});

test("PDF uploads use the document reader without decoding binary data as text", async () => {
  const file = { name: "SLIDES.PDF", size: 1024, text: async () => { throw new Error("Must not decode PDF as UTF-8"); } };
  assert.equal(await readLessonFile(file, async () => "Clean slide text."), "Clean slide text.");
  await assert.rejects(readLessonFile(file), /PDF reader isn't connected/);
  await assert.rejects(readLessonFile({ ...file, size: 26 * 1024 * 1024 }, async () => ""), /25 MB/);
  await assert.rejects(readLessonFile({ ...file, size: 0 }, async () => ""), /empty/);
});
