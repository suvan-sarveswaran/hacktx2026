# Entertainify

Turn educational text into an entertaining, factual YouTube narration script and small chunks for future illustrations. This TypeScript starter implements **text → LLM script → local narration chunks**. Generation defaults to Groq, which offers a free developer tier, with OpenAI available as an explicit alternative.

The writing prompt asks for approachable explanations, dry humor, and useful visual analogies while keeping the teaching content grounded in the supplied material. The narration uses an original, conversational voice.

## One app, from notes to video

Run `npm install`, then `npm run dev`, and open **http://127.0.0.1:3000**. On PowerShell, use `npm.cmd install` and `npm.cmd run dev` if needed. Node 24 is recommended; pnpm is optional. You can also double-click **Start Image and Video Studio.cmd**: it starts the app directly with Node when dependencies are installed, or installs missing dependencies with npm first.

With dependencies already installed, you can start directly without a package manager:

```sh
node --env-file-if-exists=.env --import tsx src/server.ts --dev
```

1. Upload PDF/text or paste material. Enter or upload a **Groq API key** to write the script. Existing narration can skip writing.
2. Choose doodles, editorial vector, colored pencil, cinematic, or custom art direction; choose landscape, square, or portrait. Enter a **Pollinations API key**, then generate one, a few, or all missing images. Scene counts, saved previews, and editable prompts are shown before proceeding.
3. Enter an **ElevenLabs API key**. Select a voice (or load available voices), Flash v2.5 or Multilingual v2, and an output format. Generate audio only or create the MP4. Optional text fallback supports partial test videos.
4. Watch the finished video in the same screen. **My lessons** restores the source, script, settings, images, narration, and video versions after browser/server restarts.

Keys are used only for their requested operation and are never written to project files or browser storage. No second UI or manual JSON handoff is required. The old screens are preserved in [`studio/archive/public/`](studio/archive/README.md); `pnpm studio` explicitly opens the archived app and its existing `studio/data/` projects.

New projects live in **`output/lessons/`**, configurable with `LESSON_DATA_DIR`. Keep that folder to retain your library. Each project includes `source.txt`, `script.txt`, `lesson.json`, `project.json`, image versions, cached audio, and MP4 versions. All generated media stays out of Git. See [integration details](docs/studio-integration.md).

## Purposeful visuals and text cards

New main-app lessons start with one structured Groq response for narration and visual direction. Illustrations are the default, targeting 80–90% of narrated time. Objects, mechanisms, diagrams, comparisons and relevant visual analogies can represent abstract ideas too. Centered text is reserved for beats with no useful depiction. Scenes aim for 6–12 spoken words (roughly 2.4–4.8 seconds), with exact cuts determined by ElevenLabs timestamps. Long image scenes stay illustrated across their balanced cuts, each with a narration-specific prompt. Repeated prompts receive a specific shot focus rather than becoming text. The selected style and aspect ratio apply consistently, and each illustration has a distinct stable seed. Captions remain separate from the spoken script.

For an existing lesson, open its visual-plan panel, enter Groq and choose **Replan visuals**, then generate the new illustrations. Replanning keeps the exact narration, prior videos and voice cache. It uses GPT-OSS 20B in batches of at most 24 beats, waits at least 61 seconds between requests, and checkpoints completed batches. Plans below 60% estimated image time get one corrective attempt per batch; new stories also enter this repair flow when necessary, saving the original script first. Quota errors stop for explicit continuation; no provider fallback or automatic paid upgrade occurs. Interrupted batches resume; explicitly replanning a completed plan starts fresh. The new policy uses a separate cache version, so older text-heavy plans are not reused. Free-tier limits still apply; start with a quick bite and a short source.

The dashboard shows estimated image time. Final MP4s require more than 50% image coverage both before voice generation (estimated narration duration) and at rendering (actual frame timing, including pauses). An explicitly selected **Test preview** may use text fallback and bypass that minimum; saved versions identify these previews.

FLUX.1 Schnell stays the budget default. You can test FLUX.2 Klein 4B, Z-Image Turbo or GPT Image 1 Mini using **Generate 1** before committing to a batch; model prices and availability differ. Pollinations' direct image endpoint accepts individual prompts and has no conversation-history field. The old repeated-character instructions, tiny chunks and shared seed were the repetition risks. The new prompts explicitly describe each scene independently and avoid a generic human presenter. Model outputs are still nondeterministic in quality.

Text cards render locally with matching doodle, editorial, pencil or cinematic type/palette. **Match the art direction** recognizes those style families; choose a card style explicitly for custom art directions. No image request is made for text cards.

References: [Pollinations image API](https://github.com/pollinations/pollinations/blob/main/gen.pollinations.ai/src/docs/image-generation.md), [current image models](https://gen.pollinations.ai/image/models), [Groq rate limits](https://console.groq.com/docs/rate-limits).

## Interactive dashboard

Entertainify now includes a React + Tailwind dashboard with custom SVG doodles and pixel sprites, an interactive comic landing page, expanding full-screen panels, a drawing pad, and a lesson studio. Fonts are bundled locally; no external image or font service is needed.

After installing dependencies, start the site (dashboard keys are entered at each step; `.env` is optional):

```sh
npm run dev
```

Open **http://127.0.0.1:3000**. On PowerShell, use `npm.cmd` if needed. Both the API and Vite share this address. The existing CLI commands still work unchanged.

- **Upload material:** choose or drop a `.pdf`, UTF-8 `.txt` / `.md` file, or paste course material. PDFs become editable source text first; Groq writes narration, per-scene image prompts, and text-card captions together.
- **Existing narration:** check “I already have a narration script” to keep the original words as readable text cards with no AI request. Use **Replan visuals** to add Groq-directed illustrations later.
- **From scratch:** describe a topic and choose an audience and approximate runtime, including a 30-second story (75 words). Upload and topic workflows have separate drafts and current lessons.
- **Coming-soon widget:** the former sample panel is an independent placeholder with no generation or API behavior. Old sample records are retired from the library on server startup into `output/lessons/.retired-samples/`, preserving their files.
- **Results:** one lesson player shows narration/rendering progress, then the finished video with browser playback and downloads. Saved-version Watch/Listen controls focus that same player and start playback. Audio appears separately only for an explicitly generated audio-only version.
- **My lessons:** only started lessons appear, including recoverable failures. Start another lesson at any stage and reopen any earlier one from history. Production continues independently on the server. Source, recipe, script, settings, images and output versions survive restarts. Per-workflow drafts/selections and per-lesson unfinished settings/prompt edits stay in local browser storage; API keys do not.

To build and run the production app locally:

```sh
npm run build
npm run build:web
npm run start:web
```

The frontend is in `web/`; the HTTP server and integration are in `src/server.ts`, `src/production-service.ts`, and the shared generation modules in `studio/`. Type-check both with `npm run typecheck`, and run the suite with `npm test`. Node **22.18+ or 24+** is recommended for the dashboard toolchain.

The main app imports the shared image, voice, and FFmpeg functions directly. `VIDEO_RENDERER_URL` is no longer used by the main UI. The original renderer adapter remains available as a library integration contract.

The local server binds to `127.0.0.1` by default. It applies a 400 KB JSON request-body limit, 25 MB PDF limit, 80,000-character source cap, three concurrent lesson jobs, two concurrent PDF imports, and ten creation requests per minute per socket IP. These are demo safeguards, not a public authentication system. Before hosting publicly, add user authentication, per-user storage isolation, and deployment-aware rate limits. This is a local single-user library; other clients with access to the server can read its projects. Keys stay in memory only while their operation is running.

### Textbook and slideshow PDFs

Upload a PDF in the existing text panel. The studio shows page-by-page progress, then places the extracted text in the editable source field. Review it and generate the lesson as usual. PowerPoint files should be exported as PDF first. The CLI still accepts text files.

The server uses PDF.js to read digital text in spatial order, including textbook columns, headings, and slide bullets. It cleans line wrapping, ligatures, and repeated text in page margins. Pages containing images, scans, or rotated text are rendered and read with local Tesseract OCR. Mixed pages retain their digital text and add readable text from figures. PDF fonts, character maps, and English OCR data are bundled with the dependencies; PDF extraction requires no AI key, network download, or external document service.

Limits are **25 MB, 60 pages, and 80,000 extracted characters**. Oversized sources are rejected instead of silently truncated. Imports run in separate workers with a ten-minute limit. Closing the panel keeps the import running; canceling or leaving/reloading the app stops the browser's import session. Completed server source text is removed once retrieved by the browser. Abandoned imports expire after an hour and at most 20 import jobs are retained. Files are processed in memory, without saving uploads to disk.

No extractor can guarantee perfect text from every PDF. Digital text can include Unicode; OCR currently supports **English**. Blurry scans, handwriting, equations, and diagrams may need corrections or a short explanation in the preview. The app flags uncertain OCR and pages without readable text. Password-protected PDFs need an unlocked export. The original PDF never goes to the writing provider; only the reviewed source text is submitted when you generate a lesson.

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

The CLI and library can read provider keys from environment variables. The dashboard sends each user-entered key to the local backend for one stage; the backend calls the provider and never saves or returns the key. Never embed credentials in the frontend bundle.

All visitors using your Groq key share the organization's free quota. Check the current [Groq rate limits](https://console.groq.com/docs/rate-limits) and your account's limits before deployment. The local dashboard includes input caps, concurrency limits, and basic IP request limits; public deployment still needs per-user controls. Free-tier access can support a hackathon demo, but does not guarantee unlimited public traffic. If a large lesson exceeds the allowance, shorten the source or request a shorter script with `--words`.

An OpenAI or Grok consumer account is not a shared free backend credential for a public website. OpenAI's [Sign in with ChatGPT integration](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) can let eligible Plus/Pro users authorize use of **their own** plan allowance. The documented local open-source/personal integration does not grant general hosted-app access; hosted or paid apps need approval through the access process. That would require a separate per-user sign-in integration, and would not pool your subscription for every visitor. This starter uses provider API keys instead.

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

The video renderer uses these hints to choose an image or an on-screen word:

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

PDF/slideshow extraction and all generation stages are integrated in the dashboard. The original script and chunk offsets pass unchanged to voice synthesis and video timing. Prompts combine the lesson opening, nearby narration, visual focus, scene-specific composition, art direction, and aspect ratio. Text chunks become local text cards.

## Checks

```sh
npm run build
npm test
```

The local examples and chunk-only mode work without credentials. A live generation run requires a key for the selected provider; the default is a free-tier Groq API key.
