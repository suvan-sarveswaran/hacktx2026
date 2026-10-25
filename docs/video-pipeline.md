# Connecting the video pipeline

The React app calls the Node server. The Node server calls the existing `entertainify()` function and passes its **unchanged `PipelineResult`** to the video renderer. The browser never receives API keys or the renderer token.

```text
React studio → POST /api/lessons → entertainify() → PipelineResult
                                                    ↓
                                          VideoRenderer.submit()
                                                    ↓
React progress ← GET /api/lessons/:id ← VideoRenderer.getStatus()
                                                    ↓
                                     complete + videoUrl → <video>
```

## Option A: connect a separate HTTP service

Add to the server's `.env`, then restart:

```dotenv
VIDEO_RENDERER_URL=http://127.0.0.1:8000
# Optional. Sent only by the Node server, as Authorization: Bearer <token>.
VIDEO_RENDERER_TOKEN=your-renderer-service-token
```

Your service implements two endpoints:

### `POST /jobs`

The request body is the lesson JSON itself, **not wrapped in `{ lesson: ... }`**:

```ts
interface PipelineResult {
  title: string;
  script: string;
  chunks: ScriptChunk[];
  metadata: {
    provider: "groq" | "openai" | "none";
    model: string;
    wordCount: number;
    chunkCount: number;
    estimatedDurationSeconds: number;
    generationMs: number;
    chunkingMs: number;
  };
}
```

Import the actual types from `src/pipeline.ts` and `src/chunker.ts`. Each chunk retains `index`, `text`, `startOffset`, `endOffset`, `wordCount`, `estimatedDurationSeconds`, `renderHint`, `visualFocus`, and `renderReason`. Preserve order. Use `script` for global context and narration; use the hints to decide between an illustration and on-screen text. Once TTS is available, derive real timing from audio alignment rather than the estimated word-count durations.

Return a JSON task immediately (HTTP 200 or 202), then generate asynchronously:

```json
{ "id": "render-123", "status": "queued", "progress": 0 }
```

A synchronous renderer may instead return a complete task with `videoUrl` immediately.

### `GET /jobs/:id`

The adapter URL-encodes the ID and polls every two seconds. Return the same ID and one of these states:

```json
{ "id": "render-123", "status": "rendering", "progress": 62 }
```

```json
{
  "id": "render-123",
  "status": "complete",
  "progress": 100,
  "videoUrl": "https://your-video-host.example/lessons/render-123.mp4"
}
```

```json
{ "id": "render-123", "status": "failed" }
```

`progress` is optional and must be a finite number from 0–100 when supplied. The UI reserves the first 45% for script preparation and maps renderer progress into the remaining range. It never simulates completed rendering. `complete` requires a valid video URL. Internal errors, credentials, and arbitrary task fields are not forwarded to the browser.

The renderer base URL and video URL must use HTTPS, except that HTTP on localhost/127.0.0.1 is supported for development. Credentials must not be embedded in URLs. The `videoUrl` must be directly playable by the **browser**; it cannot require the server-only bearer token. A sufficiently long-lived signed URL or a same-deployment media endpoint is suitable. Serve `video/mp4` (e.g. H.264/AAC) or another browser-supported format, ideally with byte-range support for seeking. The UI uses native video controls and reports playback errors.

HTTP requests have a 30-second timeout. The renderer must accept/poll within that time, while the asynchronous job may take up to ten minutes. A failure or timeout preserves the lesson JSON and shows an error. There are no automatic resubmissions that might duplicate rendering work.

## Option B: merge a TypeScript renderer directly

Implement `VideoRenderer` from `src/video-renderer.ts`:

```ts
const renderer: VideoRenderer = {
  async submit(lesson) {
    const id = await yourPipeline.enqueue(lesson);
    return { id, status: "queued", progress: 0 };
  },
  async getStatus(id) {
    return yourPipeline.status(id);
  },
};
const service = new LessonService({ renderer });
```

Pass this renderer when creating `LessonService` in `src/server.ts`. `LessonService` validates the adapter's returned statuses regardless of integration style. No frontend edits are needed.

## Dashboard API

PDF import is a preprocessing step: `POST /api/documents` (raw bytes, `Content-Type: application/pdf`) → poll `GET /api/documents/:id` → review `result.text` → the existing `POST /api/lessons` with `mode: "material"`. **The renderer still receives exactly the same `PipelineResult`; it does not receive PDF bytes or extraction metadata.** No partner-side changes are required.

Document jobs have `status: "reading" | "ready" | "failed"`, `progress`, `page`, `totalPages`, and a readable `message`. Ready jobs include `result: { text, pageCount, ocrPages, warnings }`. Failed jobs include `error`. `DELETE /api/documents/:id` cancels processing and releases temporary text; the browser calls it after retrieving a result or when leaving/canceling. Imports are bounded to 25 MB, 60 pages, 80,000 characters, two concurrent workers, and ten minutes each. PDF.js and local English OCR handle extraction without using the writing provider.

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Boolean AI/renderer configuration flags only. |
| `POST /api/documents` | Raw PDF upload; returns HTTP 202 and an import job. |
| `GET /api/documents/:id` | Page progress, extracted source text, and review warnings. |
| `DELETE /api/documents/:id` | Cancel/discard a temporary PDF import. |
| `POST /api/lessons` | `{ text, mode, audience, targetWords }`; returns HTTP 202 and a job. |
| `GET /api/lessons/:id` | Current status, progress, lesson result when ready, video URL when complete. |
| `GET /api/lessons/:id/json` | Downloads the exact existing `PipelineResult`. |
| `POST /api/demo` | `{}`; prewritten sample processed by the real chunker. Never calls AI or the renderer. |

`mode` is `material` (source-grounded AI writing), `topic` (general-knowledge teaching), or `script` (local chunking, no AI writing). `targetWords` is an integer from 50–2,000 and `audience` is a nonempty string up to 300 characters. For script mode, these options are accepted for a consistent request shape but do not change the narration.

Job status is `writing`, `rendering`, `script-ready` (renderer absent or sample), `complete`, or `failed`. The job envelope is separate from the stable result JSON. In-memory jobs expire after an hour and terminal jobs may be evicted at the 40-job capacity; restart also clears them. Production deployments should replace this with durable job storage and add authentication.

The browser remembers the active job ID across refreshes in the same tab and continues polling when a panel is closed. Navigating back does not cancel a job. Failed polling can be retried without starting another generation request. Draft text remains in session storage; recent lesson titles are stored locally. No automatic paid-provider fallback is introduced.

## Checks

`npm test` includes contract validation, exact JSON handoff, renderer progress/completion/failure, timeout handling, topic-mode forwarding, sample isolation, concurrency limits, and HTTP request/download tests. PDF tests generate real multi-column textbook pages, landscape slides, image-only scans, mixed pages, and sideways scans, then verify text extraction and the unchanged renderer handoff. Tests use local OCR, mocks, or local requests; they do not consume provider quota.
