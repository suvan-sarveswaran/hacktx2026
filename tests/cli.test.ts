import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { TestContext } from "node:test";
import type { PipelineResult } from "../src/index.js";

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const narration = "  A leaf captures light.\nThen it uses that energy to help build sugars, which provide energy and building material.\n";

function runCli(args: string[], input?: string) {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_MODEL;
  delete env.OPENAI_BASE_URL;
  delete env.LLM_PROVIDER;
  delete env.GROQ_API_KEY;
  delete env.GROQ_MODEL;
  delete env.GROQ_BASE_URL;
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    input: input ?? "",
    timeout: 15_000,
    env,
    windowsHide: true,
  });
}

function temporaryDirectory(context: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "entertainify-cli-"));
  // Only remove the dedicated temporary directory created by this test.
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("entertainify-cli-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function parsedResult(result: ReturnType<typeof runCli>): PipelineResult {
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as PipelineResult;
}

function assertOfflineResult(result: PipelineResult, script: string): void {
  assert.equal(result.script, script);
  assert.equal(result.title, "Provided narration");
  assert.equal(result.metadata.model, "none");
  assert.equal(result.metadata.provider, "none");
  assert.equal(result.metadata.generationMs, 0);
  assert.equal(result.metadata.chunkCount, result.chunks.length);
  assert.ok(result.chunks.length > 0);
  for (const chunk of result.chunks) {
    assert.equal(script.slice(chunk.startOffset, chunk.endOffset), chunk.text);
  }
}

test("CLI splits inline narration without a key and keeps stdout as JSON", () => {
  const processResult = runCli(["--chunk-only", "--text", narration]);
  assertOfflineResult(parsedResult(processResult), narration);
  assert.equal(processResult.stderr, "");
});

test("CLI splits narration into small visual words and phrases", () => {
  const script = "A leaf is a tiny solar-powered kitchen, and somehow it runs without a group chat.";
  const result = parsedResult(runCli(["--chunk-only", "--text", script]));
  assertOfflineResult(result, script);
  assert.deepEqual(result.chunks.map((chunk) => chunk.text), [
    "A leaf is a",
    "tiny",
    "solar-powered",
    "kitchen, and somehow it",
    "runs without a",
    "group chat.",
  ]);
});

test("CLI keeps short sentences in separate chunks", () => {
  const script = "Yes. No. Maybe.";
  const result = parsedResult(runCli(["--chunk-only", "--text", script]));
  assertOfflineResult(result, script);
  assert.deepEqual(result.chunks.map((chunk) => chunk.text), ["Yes.", "No.", "Maybe."]);
});

test("CLI accepts a UTF-8 file and preserves the full narration", (context) => {
  const directory = temporaryDirectory(context);
  const sourcePath = join(directory, "narration.txt");
  const script = "Café plants need light — chlorophyll absorbs it.\nWater supplies the oxygen released during photosynthesis.";
  writeFileSync(sourcePath, script, "utf8");
  assertOfflineResult(parsedResult(runCli(["--chunk-only", "--input", sourcePath])), script);
});

test("CLI reads piped stdin when neither explicit input flag is supplied", () => {
  assertOfflineResult(parsedResult(runCli(["--chunk-only"], narration)), narration);
});

test("CLI creates nested output directories and writes parseable JSON", (context) => {
  const directory = temporaryDirectory(context);
  const outputPath = join(directory, "nested", "output", "lesson.json");
  const result = runCli(["--chunk-only", "--text", narration, "--output", outputPath]);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Saved \d+ chunks/);
  assertOfflineResult(JSON.parse(readFileSync(outputPath, "utf8")) as PipelineResult, narration);
});

test("CLI accepts a chunk safety limit and a decimal speaking rate", () => {
  const result = parsedResult(runCli([
    "--chunk-only", "--text", narration,
    "--max-chunk-words", "3", "--wpm", "150.5",
  ]));
  assertOfflineResult(result, narration);
  assert.ok(result.chunks.every((chunk) => chunk.wordCount <= 3));
  for (const chunk of result.chunks) {
    assert.equal(chunk.estimatedDurationSeconds, Number(((chunk.wordCount / 150.5) * 60).toFixed(3)));
  }
});

test("CLI rejects conflicting input sources, empty input, unknown flags, and missing values", () => {
  const invalidArguments = [
    ["--chunk-only", "--input", "unused.txt", "--text", narration],
    ["--chunk-only", "--text", ""],
    ["--chunk-only", "--text", " \n\t "],
    ["--chunk-only", "--unknown"],
    ["--input"],
    ["--chunk-only", "--text", narration, "--output"],
    ["--chunk-only", "--text", narration, "--output", ""],
  ];
  for (const args of invalidArguments) {
    const result = runCli(args);
    assert.ifError(result.error);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^Entertainify: /);
  }
  const noInput = runCli(["--chunk-only"]);
  assert.equal(noInput.status, 1);
  assert.match(noInput.stderr, /Input text must not be empty/);
});

test("CLI rejects invalid numeric flags before generation", () => {
  const invalidOptions = [
    ["--words", "0"],
    ["--words", ""],
    ["--max-chunk-words", "-1"],
    ["--max-chunk-words", "1.5"],
    ["--max-chunk-words", "lots"],
    ["--max-chunk-words", "9007199254740993"],
    ["--wpm", "0"],
    ["--wpm", "NaN"],
    ["--wpm", "Infinity"],
    ["--wpm", ""],
  ];
  for (const args of invalidOptions) {
    const result = runCli(["--text", narration, ...args]);
    assert.ifError(result.error);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^Entertainify: /);
    assert.doesNotMatch(result.stderr, /Set (?:OPENAI|GROQ)_API_KEY/);
  }
});

test("CLI rejects generation-only flags in offline mode", () => {
  for (const args of [["--words", "100"], ["--audience", "students"], ["--model", "some-model"], ["--provider", "groq"]]) {
    const result = runCli(["--chunk-only", "--text", narration, ...args]);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /cannot be used with --chunk-only/);
  }
});

test("CLI reports the selected provider's missing key without making a live request", () => {
  for (const { args, key } of [
    { args: [], key: "GROQ_API_KEY" },
    { args: ["--provider", "groq"], key: "GROQ_API_KEY" },
    { args: ["--provider", "openai"], key: "OPENAI_API_KEY" },
  ]) {
    const result = runCli(["--text", narration, ...args]);
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, new RegExp(`Set ${key}`));
    assert.match(result.stderr, /--chunk-only/);
  }
});

test("CLI rejects unsupported providers before requesting a key", () => {
  const result = runCli(["--text", narration, "--provider", "unsupported"]);
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /provider/i);
  assert.doesNotMatch(result.stderr, /Set (?:OPENAI|GROQ)_API_KEY/);
});

test("CLI help works without input or credentials", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /--chunk-only/);
  assert.match(result.stdout, /--max-chunk-words/);
  assert.match(result.stdout, /--provider/);
  assert.equal(result.stderr, "");
});
