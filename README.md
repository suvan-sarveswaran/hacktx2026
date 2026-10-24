# Entertainify

Turn educational text into an entertaining, factual YouTube narration script and small chunks for future illustrations. This TypeScript starter implements **text → OpenAI script → local narration chunks**.

The writing prompt asks for approachable explanations, dry humor, and useful visual analogies while keeping the teaching content grounded in the supplied material. The narration uses an original, conversational voice.

## Setup

Install **Node.js 22.14 or newer**, then run:

```sh
npm install
cp .env.example .env
```

In PowerShell, use `Copy-Item .env.example .env` for the second command. Edit `.env` and set `OPENAI_API_KEY` to your own key, then build and run:

```sh
npm run build
npm start -- --input examples/source.txt --output output/lesson.json
```

`npm start` loads `.env` automatically. Keep API keys out of source control. OpenAI generation requires an API key and may incur usage charges.

A `pnpm-lock.yaml` is included for reproducible installs with `pnpm install --frozen-lockfile`. The equivalent `pnpm run build`, `pnpm start`, and `pnpm test` commands also work.

## Command line

Use a UTF-8 file, inline text, or piped text:

```sh
npm start -- --input examples/source.txt --words 500 --audience "first-year biology students"
npm start -- --text "A stack removes the most recently added item first. A queue removes the earliest added item first."
```

PowerShell pipeline:

```powershell
Get-Content -Raw examples/source.txt | node --env-file-if-exists=.env dist/cli.js --output output/lesson.json
```

POSIX shell pipeline:

```sh
cat examples/source.txt | node --env-file-if-exists=.env dist/cli.js --output output/lesson.json
```

Use `--input` or `--text`, with piped stdin as the fallback when neither is supplied. Output is formatted JSON on stdout unless `--output` is supplied, in which case parent folders are created and the JSON is saved there. Progress and errors go to stderr. For piping JSON into another program, run `node --env-file-if-exists=.env dist/cli.js` directly, or use `npm run --silent start -- ...` to suppress npm's own script banner.

Try the chunker offline, without an API key:

```sh
npm start -- --chunk-only --input examples/narration.txt --output output/chunks.json
```

Tune the chunk length and estimated speaking speed:

```sh
npm start -- --chunk-only --input examples/narration.txt --min-chunk-words 6 --target-chunk-words 18 --max-chunk-words 32 --wpm 150
```

`--words` controls the approximate total script length (50–2,000 words, default 450); `--target-chunk-words` controls the preferred length of each chunk. Source text is limited to 80,000 characters for generation. `--audience` accepts up to 300 characters, and `--model` overrides the configured generation model. Generation flags are rejected with `--chunk-only` to catch mistakes. Use `npm start -- --help` for all flags.

## Use from TypeScript

```ts
import { entertainify, chunkScript } from "./src/index.js";

const lesson = await entertainify(
  "Photosynthesis uses light energy to help build organic molecules from carbon dioxide.",
  {
    targetWords: 400,
    audience: "high school biology students",
    chunking: {
      minWords: 6,
      targetWords: 18,
      maxWords: 32,
      wordsPerMinute: 150,
    },
  },
);

console.log(lesson.script);
console.log(lesson.chunks);

// Local splitting also works independently of OpenAI.
const chunks = chunkScript("Light arrives. The leaf gets to work.");
```

The `.js` import extension is intentional for TypeScript's Node ESM resolution; it resolves the source `src/index.ts` during compilation. In compiled JavaScript, import from `./dist/index.js` instead. Adjust the relative path to match your project. Library calls read existing environment variables; load `.env` in your application's entry point (for example, with Node's `--env-file=.env`) or pass `apiKey` directly.

Configuration is available through environment variables or per-call options:

| Setting | Environment variable | Per-call option | Default |
| --- | --- | --- | --- |
| API key | `OPENAI_API_KEY` | `apiKey` | Required for generation |
| Model | `OPENAI_MODEL` | `model` | `gpt-4.1-mini` |
| API base URL | `OPENAI_BASE_URL` | `baseUrl` | `https://api.openai.com/v1` |
| Request timeout | — | `timeoutMs` | `120000` milliseconds |

Per-call values override environment variables. An alternative API base URL must support the OpenAI request format and structured output used by this project. The script generator requests a structured title and narration; see [OpenAI's Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat).

## Output

Each result includes:

- `title`: the generated lesson title; `Provided narration` in chunk-only mode.
- `script`: the complete narration, retained so future image prompts can use the context of the entire lesson.
- `chunks`: ordered objects containing `index`, `text`, `startOffset`, `endOffset`, `wordCount`, and `estimatedDurationSeconds`.
- `metadata`: `model`, `wordCount`, `chunkCount`, `estimatedDurationSeconds`, `generationMs`, and `chunkingMs`.

Offsets locate chunks in the original `script` using JavaScript string indices: `script.slice(startOffset, endOffset)` gives the chunk text. Chunk-only mode uses `model: "none"` and `generationMs: 0`.

Duration estimates come from word counts and the configured speaking rate. They do **not** account for the actual voice, punctuation pauses, or delivery speed. Once text-to-speech is added, use the audio's word or character alignment to derive real image transition times.

## Why split locally?

Only script generation needs an LLM request. Local splitting avoids a second network request and token cost, and is deterministic and fast enough that parallelizing it adds little value. The splitter looks for sentence endings, punctuation, and conjunctions while balancing chunk lengths. It is a heuristic: punctuation and conjunctions do not always mark a useful visual change, so inspect the chunks for your material. An LLM or an editing pass could improve scene selection later at the cost of latency.

Defaults are 8 minimum, 24 target, and 40 maximum words per chunk, at 150 words per minute. The minimum and target are preferences; the maximum is enforced. Short sentences can share a chunk, while long sentences can split at clause boundaries. Word counts and pause rules are intended for English narration with whitespace-separated words.

PDF parsing, image prompt generation, image generation, voice synthesis, and video assembly are future stages. They are not included in this starter.

## Checks

```sh
npm run build
npm test
```

The local examples and chunk-only mode work without credentials. A live generation run requires your OpenAI API key.
