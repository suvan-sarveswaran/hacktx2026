# Entertainify Lesson Studio



One local browser workflow: **lesson JSON → styled images → narration → synchronized MP4**.



## Start



Requires Node.js 24+. On this computer, the dependency is installed and the server is running at **http://127.0.0.1:4317/**. Both `/` and `/video` open the same unified workflow.



For a fresh copy, run `npm install`, then `npm start`. On Windows, double-click **Start Studio.cmd**; it installs the FFmpeg dependency if needed. The server listens on 127.0.0.1 only.



## Use one JSON throughout



1. Upload the upstream JSON containing `title`, the full `script`, and ordered `chunks`. Or click **Load example**. Lessons and progress save in SQLite; choose a saved lesson to continue after reopening the browser.

2. Choose an art-style preset or write custom art direction. Choose **Landscape · 16:9 · 1280 × 720** for YouTube images, then click **Apply image settings + prompt edits**. The same art direction is appended to every image prompt.

3. Expand **Pollinations connection**, enter your secret key locally, and Connect. Keys stay in server memory. Connect does not make a generation request.

4. Click **Generate 1** to test the next missing image. Set the numeric count and click **Generate a few**, or click **Generate all missing**. You can also generate an individual chunk from its card.

5. Each finished image is automatically attached to the correct lesson chunk. There is no separate image upload or manual mapping step. Text and skip chunks do not generate images. Prompt edits are available on each image card.

6. Enter the ElevenLabs key on the same page. Load available voices, choose one you can access, and use Flash v2.5 for lower-cost tests.

7. Click **Generate audio only** to listen and download an MP3, then **Create MP4**. Or click Create MP4 directly to generate narration and stitch the video in one job. Exact matches of script, voice and model reuse cached narration.

8. Play/download the final MP4 and its cut timings. Export the lesson plus its image mapping using the link below the lesson selector.



The MP4 button waits for all image chunks to have images. For a partial-image timing test, explicitly enable **Allow text cards for missing images in a test video**. Audio-only generation does not require images. Narration is never based on image prompts: it always uses the unchanged full script from the lesson JSON.



## JSON and image prompts



Input matches your teammate's current format:



```json

{

  "title": "A lesson",

  "script": "A leaf makes sugar.",

  "chunks": [

    {

      "index": 0,

      "text": "A leaf makes sugar.",

      "startOffset": 0,

      "endOffset": 19,

      "renderHint": "image",

      "visualFocus": "leaf",

      "imagePrompt": "A leaf working in a tiny solar-powered kitchen."

    }

  ]

}

```



`imagePrompt` is optional; `image_prompt` and `prompt` are also accepted. When no prompt is supplied, the app creates an editable prompt using the title, chunk text, visual focus and neighboring chunks. This local fallback does not make an LLM call. It is a simple starting prompt; a storyboard writer with full-script context can provide better visual jokes. The fallback sees only the previous/current/next chunks, not the entire sentence or script. Single-word chunks such as “tiny” are therefore weak image descriptions. Use a concrete scene description in `imagePrompt` (subject, action, setting and composition), and keep the same named character across related scenes. Each image card has **View complete generation prompt** to inspect the saved prompt, visual metadata and style without calling an API.



The upload area shows the loaded filename, or identifies a restored saved lesson. **View or edit lesson JSON** is collapsed by default. Open it to inspect all fields, edit the JSON, and click **Validate + apply JSON**. Invalid drafts are kept in the editor and do not overwrite the saved lesson. Apply or discard a draft before generating. Editing script text still requires updating its chunk offsets to match.



Custom top-level and chunk metadata is preserved in saved lessons and exports. Chunk visual requirements (including nested metadata and render reasons) and lesson-wide visual constraints are included in each image prompt even when an explicit image prompt is supplied. Bookkeeping fields such as offsets, word counts and measured generation times are omitted from the image instructions. Combined prompts over 4,000 characters fail validation instead of silently dropping requirements. Re-upload the original JSON to restore metadata discarded by older versions of this prototype.



When **Create MP4** is unavailable, a visible explanation and hover/focus tooltip identify missing images, unconnected ElevenLabs credentials, running jobs, or unapplied edits. Disabled controls use a not-allowed cursor rather than a loading cursor.



Chunk indexes are zero-based and consecutive. Offsets must match `script.slice(startOffset, endOffset)` exactly in JavaScript UTF-16 units. Chunks must cover all non-whitespace narration. The app validates this before any paid generation. Accepted render hints: `image`, `text` (text card), and `skip` (hold previous visual). Text length is limited to 10,000 characters and lessons to 1,000 chunks.



## Style, versions and conserving credits



The image model is **black-forest-labs/flux.1-schnell**, 1024×1024. Image requests use two concurrent jobs with start spacing and throttling backoff. The displayed estimate uses your quoted **0.002 Pollen per image**; check current provider pricing. Your 76-chunk example has 72 image chunks, for approximately **0.144 Pollen** before retries. Opening a lesson or editing a style does not generate images.



One/few/all means the next missing images for the current style and prompts. Existing completed matches are skipped. Duplicate exact prompts share the underlying image cache. Changing a style, prompt or image ratio selects a new version; old images remain saved. Returning to identical style/prompt/dimensions restores matching saved versions. Every image request contains the shared art direction, but character identity is still best effort. A seed is not an identity guarantee.



**Use images you already made** is an optional import tool for the earlier standalone batches. Imported images are explicitly mapped in order and may have a different style. The old free-form prompt sandbox remains available at `/images-only`.



ElevenLabs currently lists 10,000 monthly credits on Free; Flash API use is listed at 0.5–1 credit per character before voice modifiers. The 969-character example is about 485–969 credits, subject to account pricing. Credits used in ElevenCreative and the API share your account's pool. Free content requires noncommercial use and attribution under ElevenLabs' published terms. No top-up or subscription purchase is performed by this app.



Stitching uses local FFmpeg and consumes no API credits. Voice generation is not automatically retried; a lost response can still have consumed credits. Stop does not guarantee provider-side cancellation or refunds.



## Storage and recovery



- `data/studio.sqlite`: saved lessons, art direction, prompt edits, image-version mappings, image batches and voice/video job metadata.

- `data/images/assets/`: downloaded raster images; SQLite stores references.

- `data/images/.cache/`: verified image hashes and in-progress provider job IDs.

- `data/voice-cache/`: audio and original/normalized character alignment, cached by script, voice, model and format.

- `data/videos/<job-id>/`: rendered segments, MP4 and `timeline.json`.



Back up the entire `data/` folder together. It is excluded from Git and from the distributable archive. `.env` is also ignored; no keys are stored in SQLite, browser storage or exports. Keys entered in the browser need re-entry after a server restart; optional environment variables are documented in `.env.example`.



A restarted active generation becomes interrupted. Generate the missing images again to resume their cached provider jobs, or use Retry for an interrupted audio/video job. After a hard crash, verify no Studio server is running before removing `data/images/.batch.lock`. Failed or expired provider jobs may require deleting the associated `.cache/<key>.json` to explicitly authorize another generation. Do not delete cached paid results merely to rerender a video.



## Timing



Narration is generated in one request to ElevenLabs' `/v1/text-to-speech/{voice_id}/with-timestamps`. Original-text character alignment is mapped to exact chunk offsets, with whitespace normalization allowed. Non-whitespace differences are rejected instead of guessing. Forced Alignment is a separate possible workflow, not automatically billed here.



Cuts occur at each chunk's first spoken character, rounded to the nearest frame at 30 fps (up to about 16.7 ms relative to the reported timestamp). Actual model alignment may be imperfect. Estimated word-count durations are ignored. The title covers leading silence, and the last visual covers the decoded audio tail. A skipped chunk keeps the previous visual.



FFmpeg encodes exact frame-count segments and joins them with narration into H.264/AAC MP4. Formats: 1280×720, 720×1280, and 1024×1024. The Windows renderer uses Segoe UI for text cards.



## API and tests



- `GET/POST /api/projects`: list/create saved lessons.

- `GET /api/projects/:id`: current lesson and automatic chunk/image mapping.

- `POST /api/projects/:id/settings`: save style, prompt edits and `imageAspect` (`landscape`, `square`, `portrait`).

- `POST /api/projects/:id/images`: `{ "mode": "one" }`, `{ "mode": "few", "count": 5 }`, `{ "mode": "all" }`, or `{ "indices": [0, 3] }`.

- `POST /api/projects/:id/map`: explicitly reuse older image scenes.

- `GET /api/projects/:id/export`: lesson plus art direction and image mappings.

- `POST /api/video/jobs`: `{ "projectId": "...", "voiceId": "...", "model": "eleven_flash_v2_5", "format": "landscape", "audioOnly": false }`.

- `GET /api/video/jobs/:id`, `/narration.mp3`, `/video.mp4`, `/timeline.json`; POST `/retry` or `/stop`.



Mutations require JSON and an Origin header matching the local website. Original standalone image endpoints are retained for compatibility.



Run `npm test`. Tests use a local mock API, temporary SQLite databases and synthetic audio. They cover one/few/all images from one JSON, nonconsecutive image chunk indexes, shared styles, version restoration, audio-only followed by cached MP4 creation, restart persistence, cancellation and export. A real MP4 is also decoded frame by frame to verify cut boundaries. Tests do not spend AI credits.



This local prototype is included in the repository under `studio/`. It remains a separate app; see `../docs/studio-integration.md` for the manual JSON handoff and the automatic adapter still to implement.



Sources checked October 24, 2026: https://gen.pollinations.ai/, https://elevenlabs.io/pricing, https://elevenlabs.io/docs/overview/administration/billing, https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps.
