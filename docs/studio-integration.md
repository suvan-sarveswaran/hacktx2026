# Integrated lesson production

The main app at port 3000 now owns the entire text/PDF → Groq script → Pollinations images → ElevenLabs narration → MP4 workflow. No JSON upload into a second UI is needed.

## Code boundaries

- `src/production-service.ts`: durable project lifecycle, per-operation credentials, stage validation, retries, cancellation, image versions and output history.
- `src/production-settings.ts`: shared art presets, image models, text styles, aspect ratios, voice defaults.
- `src/visual-plan.ts`, `src/visual-planner.ts`: illustration-first plans (80–90% target), duration-based coverage checks, exact-offset validation and resumable free-tier replanning. Plans below 60% estimated image time receive a bounded corrective pass. Cache version 3 separates these from older text-heavy plans.
- Final MP4s require more than half their duration to show images, checked before voice generation and again using actual rendered frame timing. Explicit text-fallback previews are exempt and labeled in saved versions.
- `studio/text-cards.mjs`: measured, centered typography with four matching art themes.
- `src/server.ts`: lesson/stage routes, PDF imports, downloads, local media streaming with byte ranges.
- `web/src/Production.tsx`: phased production UI, image gallery/prompt edits, voice selection, audio/video playback and saved text.
- `studio/images.mjs`, `studio/lesson-images.mjs`, `studio/video.mjs`: shared provider clients, prompts, caching, exact speech alignment and FFmpeg assembly.
- `studio/archive/public/`: preserved standalone UI. `pnpm studio` opens it explicitly on port 4317. Its SQLite data remains untouched in `studio/data/`; new integrated projects use a separate folder.

## Main app API

- `POST /api/lessons`: `{text, mode, audience, targetWords, apiKey}`. Material/topic modes require a Groq key. Script mode uses exact supplied narration with no writing request.
- `GET /api/lessons`: durable library summaries.
- `GET /api/lessons/:id`: current public state, result, frames, source text, settings and outputs. No credentials.
- `POST /api/lessons/:id/script`: retry failed writing with `{apiKey}`.
- `POST /api/lessons/:id/plan`: `{apiKey}` replans exact existing narration with Groq; commits only a complete valid plan and clears scene mappings, preserving prior output files. Completed batches/cooldowns live in `plan-cache/` without credentials.
- `POST /api/lessons/:id/settings`: save `{settings, prompts}` without provider calls. Prompts map image chunk indexes to custom scene ideas.
- `POST /api/lessons/:id/images`: `{apiKey, settings?, prompts?, count?}`. Omit count for all missing images. A completed image is persisted immediately and reused on retry.
- `POST /api/lessons/:id/video`: `{apiKey, settings?, audioOnly?}`. Requires all images unless `settings.fallbackText` explicitly allows a partial test video. Uses the unchanged narration and actual character timestamps. Voice cache keys include script, voice and model.
- `POST /api/lessons/:id/stop`: stop visual-planning/image/voice/video work. Completed media remains available; a new key is needed to continue.
- `POST /api/voices`: `{apiKey}` lists ElevenLabs voices without generating audio.
- `GET /api/lessons/:id/json`: original `PipelineResult` contract.
- `GET /api/lessons/:id/export`: result plus image prompts/mapping, art settings and saved output references.
- `GET /api/lessons/:id/source` and `/script`: text downloads.
- `GET /api/lessons/:id/assets/...`: validated local image/audio/video paths; media supports HEAD and Range requests.

Image and video aspects independently support landscape (1280 × 720), square (1024 × 1024), and portrait (720 × 1280). Changing the image ratio in the UI initially matches the video ratio; it can then be overridden. Art presets are doodle, flat editorial, colored pencil, cinematic and custom. Both original ElevenLabs models are supported. Keys may be pasted or loaded from a single-line text file; they are never persisted.

## Persistence and recovery

The default store is `output/lessons/`, overridden with `LESSON_DATA_DIR`. Each UUID folder contains `project.json` (atomically replaced), `source.txt`, `script.txt`, `lesson.json`, `frames/`, `image-cache/`, `voice-cache/`, and `videos/` with immutable output versions. Preserve this folder to preserve the library. Serve one app process per data directory. Interrupted stages are marked for explicit continuation on startup. There is no automatic paid generation after restart.

The default image model is `black-forest-labs/flux.1-schnell`. Counts distinguish missing images, saved images and locally rendered text cards. Voice estimates are approximate and plan-dependent. Image prompts preserve narration meaning, vary composition, and apply a shared palette and drawing style and aspect-specific framing; generated identity consistency remains best effort. The voice stage supports scripts up to 10,000 characters, matching the original renderer validation. The bundled FFmpeg dependency is installed from the root package. Text cards use Canvas with system font fallbacks; they no longer require copying a Windows font file into the output. `displayText` carries the short caption while `text` and offsets remain exact narration. Image cache identity includes model, dimensions, prompt and per-scene seed.

The default server binds to localhost and has no multi-user authentication. Do not expose this shared local library as a public service without authentication and isolated per-user data. Browser keys are sent only to this backend and then to their intended provider. Provider error bodies are not forwarded.

## Verification

Run `pnpm typecheck`, `pnpm test`, `pnpm test:studio`, `pnpm build`, and `pnpm build:web`. Tests use mocked providers and synthetic media, including real FFmpeg encoding and timing checks; they do not spend API credits. A paid provider run still requires the user's keys in the main UI.
