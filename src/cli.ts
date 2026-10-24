#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { chunkScript, entertainify } from "./index.js";
import type { PipelineResult } from "./index.js";

const help = `Entertainify — turn educational text into narration and visual chunks.

Usage:
  npm start -- --input examples/source.txt [options]
  npm start -- --text "Photosynthesis converts light energy into chemical energy." [options]
  Get-Content -Raw examples/source.txt | npm start -- [options]

Input (choose one; otherwise reads piped stdin):
  -i, --input <path>              UTF-8 source text file
      --text <text>               Inline source text
      --chunk-only                Split existing narration without an API call

Output:
  -o, --output <path>             Write JSON to a file (default: stdout)
      --words <number>            Approximate narration length in words
      --audience <description>    Intended audience
      --model <name>              Override OPENAI_MODEL

Chunking:
      --min-chunk-words <number>  Minimum desired words per chunk
      --target-chunk-words <n>    Preferred words per chunk
      --max-chunk-words <number>  Maximum words per chunk
      --wpm <number>              Speaking rate for duration estimates

  -h, --help                     Show this help

Generation requires OPENAI_API_KEY. npm start loads .env if it exists.
Chunk timings are estimates; align them to the voiceover before rendering video.
`;

function positiveInteger(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return Number(value);
}

function positiveNumber(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (value.trim() === "" || !Number.isFinite(number) || number <= 0) {
    throw new Error(`${flag} must be a positive number.`);
  }
  return number;
}

function nonempty(value: string | undefined, flag: string): string | undefined {
  if (value !== undefined && value.trim() === "") {
    throw new Error(`${flag} must not be empty.`);
  }
  return value;
}

async function readStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) input += String(chunk);
  return input;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    strict: true,
    allowPositionals: false,
    options: {
      input: { type: "string", short: "i" },
      text: { type: "string" },
      output: { type: "string", short: "o" },
      words: { type: "string" },
      audience: { type: "string" },
      model: { type: "string" },
      "chunk-only": { type: "boolean", default: false },
      "min-chunk-words": { type: "string" },
      "target-chunk-words": { type: "string" },
      "max-chunk-words": { type: "string" },
      wpm: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(help);
    return;
  }
  if (values.input !== undefined && values.text !== undefined) {
    throw new Error("Use either --input or --text, not both.");
  }

  const inputPath = nonempty(values.input, "--input");
  const outputPath = nonempty(values.output, "--output");
  const model = nonempty(values.model, "--model");
  const audience = nonempty(values.audience, "--audience");
  const targetWords = positiveInteger(values.words, "--words");
  const minWords = positiveInteger(values["min-chunk-words"], "--min-chunk-words");
  const chunkTargetWords = positiveInteger(values["target-chunk-words"], "--target-chunk-words");
  const maxWords = positiveInteger(values["max-chunk-words"], "--max-chunk-words");
  const wordsPerMinute = positiveNumber(values.wpm, "--wpm");
  const chunking = {
    ...(minWords === undefined ? {} : { minWords }),
    ...(chunkTargetWords === undefined ? {} : { targetWords: chunkTargetWords }),
    ...(maxWords === undefined ? {} : { maxWords }),
    ...(wordsPerMinute === undefined ? {} : { wordsPerMinute }),
  };

  if (values["chunk-only"] && (model !== undefined || audience !== undefined || targetWords !== undefined)) {
    throw new Error("--model, --audience, and --words apply to script generation and cannot be used with --chunk-only.");
  }

  let sourceText: string;
  if (inputPath !== undefined) {
    sourceText = await readFile(resolve(inputPath), "utf8");
  } else if (values.text !== undefined) {
    sourceText = values.text;
  } else {
    if (process.stdin.isTTY) {
      throw new Error("Provide --input, --text, or piped stdin. Run with --help for usage.");
    }
    sourceText = await readStdin();
  }
  if (sourceText.trim() === "") throw new Error("Input text must not be empty.");

  let result: PipelineResult;
  if (values["chunk-only"]) {
    const started = performance.now();
    const chunks = chunkScript(sourceText, chunking);
    result = {
      title: "Provided narration",
      script: sourceText,
      chunks,
      metadata: {
        model: "none",
        wordCount: chunks.reduce((total, chunk) => total + chunk.wordCount, 0),
        chunkCount: chunks.length,
        estimatedDurationSeconds: Math.round(chunks.reduce((total, chunk) => total + chunk.estimatedDurationSeconds, 0) * 100) / 100,
        generationMs: 0,
        chunkingMs: Math.round((performance.now() - started) * 100) / 100,
      },
    };
  } else {
    process.stderr.write("Generating narration and splitting it into chunks...\n");
    result = await entertainify(sourceText, {
      ...(model === undefined ? {} : { model }),
      ...(audience === undefined ? {} : { audience }),
      ...(targetWords === undefined ? {} : { targetWords }),
      chunking,
    });
  }

  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath === undefined) {
    process.stdout.write(json);
  } else {
    const destination = resolve(outputPath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, json, "utf8");
    process.stderr.write(`Saved ${result.chunks.length} chunks to ${destination}\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Entertainify: ${message}\n`);
  process.exitCode = 1;
});
