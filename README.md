# Entertainify

Turn educational text into an entertaining, factual YouTube narration script and small chunks for future illustrations. This TypeScript starter implements **text → OpenAI script → local narration chunks**.

The writing prompt asks for approachable explanations, dry humor, and useful visual analogies while keeping the teaching content grounded in the supplied material. The narration uses an original, conversational voice.

## Setup

Install **Node.js 22.14 or newer** in your regular Windows environment from the [official Node.js download page](https://nodejs.org/en/download). **Node.js 24 LTS** is a suitable choice and includes npm. A runtime bundled with an editor or Codex may not be available in your terminal.

After installation, restart your terminal and VS Code if it is open, then check:

```sh
node --version
npm --version
```

From the project folder, install dependencies and create your configuration:

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

TypeScript is a **local development dependency**, installed by `npm install`; a global `tsc` command is not required. `npm run build` uses the project's compiler, and `npx tsc --version` checks its version.

If PowerShell blocks `npm.ps1` because of its execution policy, use `npm.cmd` and `npx.cmd` in place of `npm` and `npx` (for example, `npm.cmd install` and `npm.cmd run build`). This does not require changing your execution policy.

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

Tune the chunk safety limit and estimated speaking speed:

```sh
npm start -- --chunk-only --input examples/narration.txt --max-chunk-words 8 --wpm 150
```

`--words` controls the approximate total script length (50–2,000 words, default 450). `--max-chunk-words` sets a hard limit for a chunk; visual words usually produce shorter chunks. Source text is limited to 80,000 characters for generation. `--audience` accepts up to 300 characters, and `--model` overrides the configured generation model. Generation flags are rejected with `--chunk-only` to catch mistakes. Use `npm start -- --help` for all flags.

## Use from TypeScript

```ts
import { entertainify, chunkScript } from "./src/index.js";

const lesson = await entertainify(
  "Photosynthesis uses light energy to help build organic molecules from carbon dioxide.",
  {
    targetWords: 400,
    audience: "high school biology students",
    chunking: {
      maxWords: 8,
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
- `chunks`: ordered objects containing `index`, `text`, `startOffset`, `endOffset`, `wordCount`, `estimatedDurationSeconds`, and the rendering hints below.
- `metadata`: `model`, `wordCount`, `chunkCount`, `estimatedDurationSeconds`, `generationMs`, and `chunkingMs`.

Offsets locate chunks in the original `script` using JavaScript string indices: `script.slice(startOffset, endOffset)` gives the chunk text. Chunk-only mode uses `model: "none"` and `generationMs: 0`.

Each chunk includes three fields to help choose a visual:

| Field | Meaning |
| --- | --- |
| `renderHint` | `"image"` when the chunk contains a likely visual subject, modifier, or action; otherwise `"text"`. |
| `visualFocus` | The word or phrase to use as an image prompt's starting point, or `null` for a text hint. |
| `renderReason` | A readable explanation of the suggestion. |

For example, `"use light to help"` is one chunk with `renderHint: "image"` and `visualFocus: "light"`. Standalone fragments such as `"use"`, `"help"`, or `"idea"` receive `renderHint: "text"` and `visualFocus: null`.

Your future video renderer can use these hints to choose an image or an on-screen word:

```ts
const visualPlan = lesson.chunks.map((chunk) => {
  if (chunk.renderHint === "text") {
    return { kind: "text" as const, text: chunk.text };
  }

  // Pass these inputs to your future image-prompt stage.
  return {
    kind: "image" as const,
    focus: chunk.visualFocus,
    narration: chunk.text,
    scriptContext: lesson.script,
  };
});
```

These are local heuristic suggestions, not guaranteed judgments of imageability or calibrated probabilities. The renderer can override them. An unfamiliar noun can still be ambiguous, while a scientific term may make an excellent diagram when interpreted using the full script.

Duration estimates come from word counts and the configured speaking rate. They do **not** account for the actual voice, punctuation pauses, or delivery speed. Once text-to-speech is added, use the audio's word or character alignment to derive real image transition times.

## Why split locally?

Only script generation needs an LLM request. The chunker uses the local `compromise` English part-of-speech tagger to identify nouns, descriptive modifiers, and action verbs as possible image changes, with lists of common vague and abstract terms to refine the rendering hints. Splitting and classification need no extra API request. Ordinary adverbs and grammatical words do not start new chunks. Compound nouns such as “group chat” stay together, and hyphenated words such as “solar-powered” stay intact.

A chunk begins at each significant word or phrase, with any introductory words attached to the first one. Connecting words stay with the preceding chunk until the next visual word. Commas and conjunctions do not create their own boundaries. Sentences always stay separate, including very short ones. For example:

```text
A leaf is a tiny solar-powered kitchen, and somehow it runs without a group chat.

→ "A leaf is a"
→ "tiny"
→ "solar-powered"
→ "kitchen, and somehow it"
→ "runs without a"
→ "group chat."
```

Chunks are typically 1–5 words. The default safety limit is **8 words per chunk**, at an estimated **150 words per minute**. The word limit is enforced even if a long compound or run of connecting words needs to be split. Word counts use whitespace-separated words. Part-of-speech tags are a heuristic for English narration, so ambiguous wording, unfamiliar technical vocabulary, or abstract words may still need a review when choosing images.

Generic verbs such as “use” and “help” attach to adjacent content when possible, within the same sentence and the word limit. This avoids unnecessary fragments such as `"use"`, `"light to"`, and `"help"`, combining them into `"use light to help"`. If a fragment still has no clear visual focus, its text hint lets the video display the words instead.

PDF parsing, image prompt generation, image generation, voice synthesis, and video assembly are future stages. They are not included in this starter.

## Checks

```sh
npm run build
npm test
```

The local examples and chunk-only mode work without credentials. A live generation run requires your OpenAI API key.
