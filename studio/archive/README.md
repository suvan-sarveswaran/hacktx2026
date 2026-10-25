# Archived standalone UI

The original JSON-upload image and video screens are preserved in `public/`.
The main React app now owns the text/PDF → script → images → voice → MP4 flow.

The image, speech, and video modules in the parent directory remain active shared
implementation code. The old server is retained for compatibility and reviewing
previous projects; run `pnpm studio` explicitly to open the archived interface.
Its data stays in `studio/data/`. New integrated projects are stored separately in
`output/lessons/` (or `LESSON_DATA_DIR`). No old projects or source screens were deleted.
