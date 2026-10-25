# Entertainify

Turn educational text into an entertaining, factual YouTube narration script and small chunks for future illustrations. This TypeScript starter implements **text → LLM script → local narration chunks**. Generation defaults to Groq, which offers a free developer tier, with OpenAI available as an explicit alternative.

The writing prompt asks for approachable explanations, dry humor, and useful visual analogies while keeping the teaching content grounded in the supplied material. The narration uses an original, conversational voice.

## Images, narration and MP4 Studio

The image/voice/video application lives in [`studio/`](studio/README.md), with its own local browser interface and SQLite storage. It accepts the unchanged lesson JSON produced by this app, generates Pollinations images, synthesizes ElevenLabs narration, and stitches an MP4 locally.

```sh
npm --prefix studio install
npm run studio
```

Open **http://127.0.0.1:4317/video**. On Windows, you can also double-click **Start Image and Video Studio.cmd**. Studio requires Node.js **24+**. Run its checks with `npm run test:studio`; tests use mocks and do not spend AI credits.

For now, download a lesson JSON from the dashboard at port 3000 and upload it into Studio at port 4317. The automatic renderer adapter is not connected yet. See [Studio integration and upload preparation](docs/studio-integration.md) for the boundary and the branch workflow. Keep provider keys and generated assets local; `studio/data/`, dependencies, caches and `.env` files are ignored by Git.

## Interactive dashboard

Entertainify now includes a React + Tailwind dashboard with custom SVG doodles and pixel sprites, an interactive comic landing page, expanding full-screen panels, a drawing pad, and a lesson studio. Fonts are bundled locally; no external image or font service is needed.

After installing the dependencies and configuring `.env` below, start the site:

```sh
npm run dev
```

Open **http://127.0.0.1:3000**. On PowerShell, use `npm.cmd` if needed. Both the API and Vite share this address. The existing CLI commands still work unchanged.

- **Upload text:** choose or drop a UTF-8 `.txt` / `.md` file, or paste course material. AI writes the narration and the existing chunker creates the visual plan.
- **Existing narration:** check “I already have a narration script” to keep the original words and run the local chunker without any AI request.
- **From scratch:** describe a topic and choose an audience and approximate runtime. A topic-specific prompt teaches from general knowledge rather than treating the request as source evidence.
- **Sample lesson:** a clearly marked, prewritten mitochondria lesson demonstrates real scene splitting without an API key or renderer.
- **Results:** read the narration, explore or play a silent storyboard, download the exact `PipelineResult` JSON, and watch the finished video when the renderer is connected. Placeholder doodles in a storyboard are not generated illustrations.
- **My lessons:** recent titles are saved in this browser. Source drafts and the current job ID stay in browser session storage. Server jobs are held in memory for up to one hour (maximum 40), and disappear on restart or capacity eviction. Download JSON to retain it.

To build and run the production app locally:

```sh
npm run build
npm run build:web
npm run start:web
```

The frontend is in `web/`; the HTTP server and integration are in `src/server.ts`, `src/lesson-service.ts`, and `src/video-renderer.ts`. Type-check both with `npm run typecheck`, and run the suite with `npm test`. Node **22.18+ or 24+** is recommended for the dashboard toolchain.

The video stage is intentionally a separate adapter for your partner's pipeline. Set `VIDEO_RENDERER_URL` in `.env` when that service is ready, then restart the server. Without it, the app honestly stops at “script & scene plan ready.” See **[the video pipeline merge guide](docs/video-pipeline.md)** for the exact endpoints, status shape, and in-process integration option. No reformatting of existing lesson JSON is needed.

The local server binds to `127.0.0.1` by default. It applies a 400 KB request-body limit, 80,000-character source cap, three concurrent jobs, and ten job requests per minute per socket IP. These are demo safeguards, not a public authentication system. Before hosting publicly, add user authentication, durable job storage, and deployment-aware rate limits. Provider keys and the optional renderer token remain on the server.

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

In PowerShell, use `Copy-Item .env.example .env` for the second command. Create a free [Groq Console account and API key](https://console.groq.com/keys), then edit `.env` and set `GROQ_API_KEY` to that key. Keep the account on the Free plan; a payment method is not required. Groq is a separate company from xAI's **Grok**, so your Grok account does not supply this key. See [Groq's billing FAQ](https://console.groq.com/docs/billing-faqs) for the Free and paid Developer plans.

Build and run:

```sh
npm run build
npm start -- --input examples/source.txt --output output/lesson.json
```

`npm start` loads `.env` automatically. Keep API keys out of source control. Free Groq usage has shared request and token limits; generation returns an error when those limits are reached. The program does not retry automatically or fall back to a paid provider.

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

`--words` controls the approximate total script length (50–2,000 words, default 450). `--max-chunk-words` sets a hard limit for a chunk; visual words usually produce shorter chunks. Source text is limited to 80,000 characters for generation, but a free provider's token limit can be reached with much shorter inputs. `--audience` accepts up to 300 characters. `--provider groq|openai` selects the provider, and `--model` overrides that provider's configured model. Generation flags are rejected with `--chunk-only` to catch mistakes. Use `npm start -- --help` for all flags.

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

// Local splitting also works independently of any LLM provider.
const chunks = chunkScript("Light arrives. The leaf gets to work.");
```

The `.js` import extension is intentional for TypeScript's Node ESM resolution; it resolves the source `src/index.ts` during compilation. In compiled JavaScript, import from `./dist/index.js` instead. Adjust the relative path to match your project. Library calls read existing environment variables; load `.env` in your application's entry point (for example, with Node's `--env-file=.env`) or pass `apiKey` directly.

Configuration is available through environment variables or per-call options:

| Setting | Environment variable | Per-call option | Default |
| --- | --- | --- | --- |
| Provider | `LLM_PROVIDER` | `provider` | `groq` (`groq` or `openai`) |
| Groq API key | `GROQ_API_KEY` | `apiKey` | Required when using Groq |
| Groq model | `GROQ_MODEL` | `model` | `openai/gpt-oss-120b` |
| Groq API base URL | `GROQ_BASE_URL` | `baseUrl` | `https://api.groq.com/openai/v1` |
| OpenAI API key | `OPENAI_API_KEY` | `apiKey` | Required when using OpenAI |
| OpenAI model | `OPENAI_MODEL` | `model` | `gpt-4.1-mini` |
| OpenAI API base URL | `OPENAI_BASE_URL` | `baseUrl` | `https://api.openai.com/v1` |
| Request timeout | — | `timeoutMs` | `120000` milliseconds |

Per-call values override environment variables. `apiKey`, `model`, and `baseUrl` apply to the selected provider. Existing OpenAI configurations must explicitly set `LLM_PROVIDER=openai` or pass `--provider openai`; this uses separately billed OpenAI API access.

The script generator requests a structured title and narration. Groq provides an [OpenAI-compatible endpoint](https://console.groq.com/docs/openai), and the default `openai/gpt-oss-120b` model supports [strict structured outputs](https://console.groq.com/docs/structured-outputs). Its `openai/` model prefix identifies the model family; requests still go to Groq using the Groq key. Any alternative model or endpoint must support the same request format and strict JSON schema.

## Free usage and a public website

The CLI, library, and dashboard call `entertainify` **on the server** and store the provider key in server environment variables. Never put the key in browser code or return it to visitors.

All visitors using your Groq key share the organization's free quota. Check the current [Groq rate limits](https://console.groq.com/docs/rate-limits) and your account's limits before deployment. The local dashboard includes input caps, concurrency limits, and basic IP request limits; public deployment still needs per-user controls. Free-tier access can support a hackathon demo, but does not guarantee unlimited public traffic. If a large lesson exceeds the allowance, shorten the source or request a shorter script with `--words`.

An OpenAI or Grok consumer account is not a shared free backend credential for a public website. OpenAI's [Sign in with ChatGPT integration](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) can let eligible Plus/Pro users authorize use of **their own** plan allowance. The documented local open-source/personal integration does not grant general hosted-app access; hosted or paid apps need approval through the access process. That would require a separate per-user sign-in integration, and would not pool your subscription for every visitor. This starter uses provider API keys instead.

## Local storyboard planning

After narration is chunked, a local storyboard pass adds an `imagePrompt` and `sceneContext` to image beats. It reads sentence context to disambiguate words, but sends an independent subject-led visual brief rather than copying whole narration sentences into each image request. A local visual vocabulary gives concepts such as atoms, pumps and coolant distinct depictions; other subjects use an isolated-object/action fallback. Shared art direction controls palette and medium, not recurring content or backgrounds. It does not call Groq, OpenAI, Pollinations or ElevenLabs. The script, chunk order, original text, offsets and timing estimates are unchanged.

The pass chooses text cards for isolated fillers, quantities and weak modifiers based on significance, without a percentage cap or target. Meaningful attributes stay visual when a nearby subject in the same sentence gives them context (for example, cold water or positive charge). It preserves authored text/skip decisions and explicit custom prompts. Older automatic storyboard decisions are reassessed when a new draft is built; version-1/2 automatic prompts are upgraded to independent scene briefs. Unchanged version-3 prompts are reused. This is a transparent local heuristic, not an LLM scene writer or a historical/scientific fact check. Short pronoun-heavy or complex passages can still need authored prompts.

New dashboard and CLI JSON includes this planning automatically. For older JSON in Studio, use **Build storyboard draft - no API credits**, inspect the opened JSON editor and click **Validate + apply JSON**. Previewing does not mutate the saved lesson or generate anything. Applying selects new image versions while retaining old files. Start with one or a few image tests. Cached narration can be reused when the script, voice and model are unchanged.

## Output

Each result includes:

- `title`: the generated lesson title; `Provided narration` in chunk-only mode.
- `script`: the complete narration, retained so future image prompts can use the context of the entire lesson.
- `chunks`: ordered objects containing `index`, `text`, `startOffset`, `endOffset`, `wordCount`, `estimatedDurationSeconds`, and the rendering hints below.
- `metadata`: `provider`, `model`, `wordCount`, `chunkCount`, `estimatedDurationSeconds`, `generationMs`, and `chunkingMs`.

Offsets locate chunks in the original `script` using JavaScript string indices: `script.slice(startOffset, endOffset)` gives the chunk text. Chunk-only mode uses `provider: "none"`, `model: "none"`, and `generationMs: 0`.

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

PDF/slideshow parsing, image prompt generation, image generation, voice synthesis, and video assembly are separate stages. The dashboard accepts exported text and has a ready-to-connect video renderer adapter; it does not implement your partner's image/audio/video pipeline.

## Checks

```sh
npm run build
npm test
```

The local examples and chunk-only mode work without credentials. A live generation run requires a key for the selected provider; the default is a free-tier Groq API key.
