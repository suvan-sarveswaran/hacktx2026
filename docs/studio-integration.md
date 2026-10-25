# Studio integration and upload preparation

## Current layout

- `src/`, `web/`, and their existing tests: the upstream text/script/chunk app, unchanged.
- `studio/`: the existing Pollinations image generation, ElevenLabs narration and local FFmpeg application. It has an independent package/lockfile and starts on port 4317.
- `studio/data/`: private local SQLite database, images, audio cache and videos. Moved with Studio on this computer, but excluded from Git.
- `studio/node_modules/` and `.npm-cache/`: local dependencies/caches, excluded from Git.

## Run locally

Use Node.js 24 or newer. From the repository root:

```sh
npm --prefix studio install
npm run studio
```

On the machine where Studio was moved, its dependencies are already present. Windows users can double-click `Start Image and Video Studio.cmd` instead. Enter Pollinations and ElevenLabs keys in the local Studio interface, or use `studio/.env` based on `studio/.env.example`. The root app and Studio load their own `.env` files; do not put secrets into tracked examples.

Run the teammate's dashboard separately following the root README. The two apps use different ports: dashboard 3000, Studio 4317. Download the dashboard's lesson JSON and upload it once into Studio. Choose style and image aspect ratio, generate one/few/all images, then generate audio or MP4. Existing saved assets remain available in Studio.

```sh
npm run test:studio
```

Studio tests use local mock providers and synthetic media. They do not spend API credits.

## Automatic integration remains separate work

The root app's `src/video-renderer.ts` expects `POST /jobs` with a bare `PipelineResult`, followed by `GET /jobs/:id`, as described in `docs/video-pipeline.md`.

Studio currently exposes `POST /api/projects` with `{ lesson }`, explicit image generation through `/api/projects/:id/images`, and audio/video jobs through `/api/video/jobs`. These are not the same service contract. Setting `VIDEO_RENDERER_URL` to Studio alone will not connect the apps.

An adapter must preserve the lesson script and offsets, create/reuse a Studio project, queue missing images, wait for those images, create a voice/video job, and translate Studio statuses into the dashboard's task contract. It must return quickly, persist the task mapping, serve a playable media URL, and avoid automatically resubmitting paid jobs. Decide when the user approves image and narration costs before making that workflow automatic.

## Prepared branch and upload

The local branch is `feature/image-voice-studio`, created from the cloned `main`. Studio source, its tests and sanitized configuration examples are intended for Git; saved output, real keys and installed dependencies are not.

Before committing, inspect the staged changes:

```sh
git status --short
git diff --cached --stat
git diff --cached
```

After review, commit and push the branch:

```sh
git commit -m "Add image, narration and MP4 Studio"
git push -u origin feature/image-voice-studio
```

Then open a pull request into `main`. Push requires write access to the friend's repository. If access is denied, request collaborator access or push this branch to your own fork. No commit, push or pull request is performed as part of this preparation.
