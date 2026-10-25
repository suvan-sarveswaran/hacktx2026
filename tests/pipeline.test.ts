import assert from "node:assert/strict";
import test from "node:test";
import { entertainify } from "../src/pipeline.js";

const requestOptions = {
  provider: "openai" as const,
  apiKey: "test-key",
  model: "test-model",
  baseUrl: "https://api.openai.com/v1",
};

test("the full pipeline preserves narration, creates usable chunks, and only requests generation once", async (t) => {
  const narration = "Energy is the universe's accounting system, and it refuses to lose a receipt.\n\n" +
    "It can move between objects or change forms, but the total stays the same in an isolated system. " +
    "A falling ball trades gravitational potential energy for kinetic energy. " +
    "When it hits the floor, some energy becomes sound and heat. Nobody gets free energy; the bill simply changes departments.";
  const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({
    choices: [{
      finish_reason: "stop",
      message: { content: JSON.stringify({ title: "Energy Keeps the Receipts", script: narration }) },
    }],
  }));

  const result = await entertainify("Energy is conserved in an isolated system.", {
    ...requestOptions,
    chunking: { maxWords: 8, wordsPerMinute: 120 },
  });

  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(result.title, "Energy Keeps the Receipts");
  assert.equal(result.script, narration);
  assert.ok(result.chunks.length > 1);
  assert.equal(result.chunks.map((chunk) => chunk.text).join(" ").replace(/\s+/gu, " "), narration.replace(/\s+/gu, " "));

  let previousEnd = 0;
  for (const [index, chunk] of result.chunks.entries()) {
    assert.equal(chunk.index, index);
    assert.equal(narration.slice(chunk.startOffset, chunk.endOffset), chunk.text);
    assert.match(narration.slice(previousEnd, chunk.startOffset), /^\s*$/u);
    assert.ok(chunk.wordCount > 0 && chunk.wordCount <= 8);
    assert.equal(chunk.estimatedDurationSeconds, chunk.wordCount / 2);
    previousEnd = chunk.endOffset;
  }
  assert.match(narration.slice(previousEnd), /^\s*$/u);
  assert.equal(result.metadata.model, "test-model");
  assert.equal(result.metadata.provider, "openai");
  assert.equal(result.metadata.wordCount, narration.split(/\s+/u).length);
  assert.equal(result.metadata.chunkCount, result.chunks.length);
  assert.equal(result.metadata.estimatedDurationSeconds, result.metadata.wordCount / 2);
  assert.ok(Number.isFinite(result.metadata.generationMs) && result.metadata.generationMs >= 0);
  assert.ok(Number.isFinite(result.metadata.chunkingMs) && result.metadata.chunkingMs >= 0);
});

test("invalid chunk options fail before a billable generation request", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network request");
  });
  await assert.rejects(entertainify("Lesson", {
    ...requestOptions,
    chunking: { maxWords: 0 },
  }));
  assert.equal(fetchMock.mock.callCount(), 0);
});
