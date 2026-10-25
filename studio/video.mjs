import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, open, unlink, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { createTextCard } from './text-cards.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
export const DEFAULT_VOICE_MODEL = 'eleven_flash_v2_5';
export function validateLesson(value) {
  if (!value || typeof value.script !== 'string' || !value.script.trim() || value.script.length > 10000)
    throw new Error('Lesson JSON must contain a nonempty script of at most 10,000 characters.');
  if (!Array.isArray(value.chunks) || !value.chunks.length || value.chunks.length > 1000)
    throw new Error('Lesson JSON must contain 1–1,000 chunks.');
  let end = 0;
  const chunks = value.chunks.map((c, i) => {
    if (!c || c.index !== i || !Number.isInteger(c.startOffset) || !Number.isInteger(c.endOffset) ||
        c.startOffset < end || c.endOffset <= c.startOffset || c.endOffset > value.script.length ||
        typeof c.text !== 'string' || !c.text.trim() || value.script.slice(c.startOffset, c.endOffset) !== c.text ||
        value.script.slice(end, c.startOffset).trim())
      throw new Error(`Chunk ${i}: index, text, or offsets do not match the exact script. Do not edit the script after chunking.`);
    if (c.renderHint && !['image', 'text', 'skip'].includes(c.renderHint)) throw new Error(`Chunk ${i}: unsupported renderHint.`);
    end = c.endOffset;
    return { index: i, text: c.text, startOffset: c.startOffset, endOffset: c.endOffset,
      renderHint: c.renderHint ?? 'image', visualFocus: typeof c.visualFocus === 'string' ? c.visualFocus : null,
      displayText: typeof c.displayText === 'string' && c.displayText.trim() ? c.displayText.slice(0, 300) : c.text };
  });
  if (value.script.slice(end).trim()) throw new Error('Chunks omit narration at the end of the script.');
  return { title: typeof value.title === 'string' ? value.title.slice(0, 200) : 'Entertainify', script: value.script, chunks };
}

/** Match original text, allowing whitespace normalization only. All offsets stay UTF-16. */
export function characterTimings(script, alignment) {
  if (!alignment || !Array.isArray(alignment.characters) ||
      !Array.isArray(alignment.character_start_times_seconds) || !Array.isArray(alignment.character_end_times_seconds) ||
      alignment.characters.length !== alignment.character_start_times_seconds.length ||
      alignment.characters.length !== alignment.character_end_times_seconds.length) throw new Error('No valid original-text character alignment returned by ElevenLabs.');
  const source = []; let previousStart = 0, previousEnd = 0;
  alignment.characters.forEach((part, i) => {
    const start = alignment.character_start_times_seconds[i], end = alignment.character_end_times_seconds[i];
    if (typeof part !== 'string' || !Number.isFinite(start) || !Number.isFinite(end) || start < previousStart || end < start || end < previousEnd)
      throw new Error('Character alignment contains invalid or non-monotonic timings.');
    previousStart = start; previousEnd = end;
    for (let j = 0; j < part.length; j++) if (!/\s/u.test(part[j])) source.push({ char: part[j], start, end });
  });
  const map = new Map(); let p = 0;
  for (let offset = 0; offset < script.length; offset++) {
    if (/\s/u.test(script[offset])) continue;
    if (script[offset] !== source[p]?.char) throw new Error(`Voice alignment differs from the original script at character ${offset}. Refusing guessed cuts; use original-text alignment or forced alignment.`);
    map.set(offset, source[p++]);
  }
  if (p !== source.length) throw new Error('Voice alignment contains extra text.');
  return map;
}

export function createTimeline(lessonInput, alignment, duration, { fps = 30, cutMode = 'chunk', mapping = {}, fallbackText = false, requireImageMajority = false } = {}) {
  const lesson = validateLesson(lessonInput);
  if (![24, 30, 60].includes(fps) || !['chunk', 'focus'].includes(cutMode) || !Number.isFinite(duration) || duration <= 0)
    throw new Error('Invalid video timing settings.');
  const times = characterTimings(lesson.script, alignment), warnings = [], events = [];
  let previousTime = 0;
  for (const c of lesson.chunks) {
    if (c.renderHint === 'skip') continue;
    let offset = c.startOffset + c.text.search(/\S/u);
    if (cutMode === 'focus' && c.visualFocus && c.renderHint === 'image') {
      const at = c.text.toLocaleLowerCase().indexOf(c.visualFocus.toLocaleLowerCase());
      if (at >= 0) offset = c.startOffset + at;
      else warnings.push(`Chunk ${c.index}: visualFocus not found; used chunk start.`);
    }
    const at = times.get(offset)?.start;
    if (!Number.isFinite(at) || at < previousTime || at > duration) throw new Error(`Chunk ${c.index}: no usable aligned start time.`);
    previousTime = at;
    const imagePath = mapping[c.index];
    if (c.renderHint === 'image' && !imagePath && !fallbackText) throw new Error(`Chunk ${c.index} has no mapped image. Add one or explicitly enable text fallback.`);
    events.push({ chunkIndex: c.index, text: c.text, displayText: c.displayText, sourceOffset: offset, alignedStart: at,
      startFrame: Math.round(at * fps), kind: c.renderHint === 'text' || !imagePath ? 'text' : 'image', imagePath: imagePath ?? null });
  }
  const totalFrames = Math.ceil(duration * fps);
  if (!events.length || events[0].startFrame > 0) events.unshift({ chunkIndex: null, text: lesson.title, displayText: lesson.title, sourceOffset: null, alignedStart: 0, startFrame: 0, kind: 'text', imagePath: null });
  const scenes = [];
  for (const event of events) {
    if (event.startFrame >= totalFrames) { warnings.push(`Chunk ${event.chunkIndex} starts beyond the final video frame.`); continue; }
    if (scenes.at(-1)?.startFrame === event.startFrame) {
      warnings.push(`Chunk ${scenes.at(-1).chunkIndex} and ${event.chunkIndex} share a frame; only the latter can be displayed at ${fps} fps.`);
      scenes[scenes.length - 1] = event;
    } else scenes.push(event);
  }
  scenes.forEach((s, i) => { s.endFrame = scenes[i + 1]?.startFrame ?? totalFrames; s.startSeconds = s.startFrame / fps; s.durationSeconds = (s.endFrame - s.startFrame) / fps; });
  const imageTimeShare = scenes.reduce((sum, scene) => sum + (scene.kind === 'image' ? scene.endFrame - scene.startFrame : 0), 0) / totalFrames;
  if (requireImageMajority && imageTimeShare <= 0.5) throw new Error('The speech timestamps leave images on screen for half the video or less. Replan visuals with Groq to add illustrations; your saved narration can be reused.');
  return { fps, duration, totalFrames, imageTimeShare, cutMode, warnings, scenes };
}

async function atomicJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(value, null, 2)); await rename(temp, file);
}
export async function synthesizeNarration(script, { apiKey, voiceId, model = DEFAULT_VOICE_MODEL, cacheDir, fetchImpl = fetch, signal } = {}) {
  if (!/^[a-zA-Z0-9_-]{5,100}$/.test(voiceId ?? '')) throw new Error('Choose a valid ElevenLabs voice ID.');
  if (!['eleven_flash_v2_5', 'eleven_multilingual_v2'].includes(model)) throw new Error('Choose Flash v2.5 or Multilingual v2.');
  const key = hash(JSON.stringify({ script, voiceId, model, format: 'mp3_44100_128' }));
  const dir = path.join(cacheDir, key); await mkdir(dir, { recursive: true });
  const audioPath = path.join(dir, 'narration.mp3'), metadata = path.join(dir, 'voice.json');
  try {
    const record = JSON.parse(await readFile(metadata, 'utf8')), audio = await readFile(audioPath);
    if (record.audioHash === hash(audio)) return { ...record, audioPath, cached: true };
  } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
  if (!apiKey?.trim()) throw new Error('Connect an ElevenLabs key first.');
  // No automatic retries: a lost response can still have consumed credits.
  const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
    headers: { 'xi-api-key': apiKey.trim(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: script, model_id: model }),
  });
  if (!response.ok) throw new Error(`ElevenLabs HTTP ${response.status}: ${response.status === 401 ? 'check your key' : response.status === 402 || response.status === 429 ? 'check credits and rate limits' : 'check voice access and model settings'}. No automatic retry was made.`);
  const payload = await response.json();
  if (typeof payload.audio_base64 !== 'string' || !payload.audio_base64.length) throw new Error('ElevenLabs returned no audio.');
  const audio = Buffer.from(payload.audio_base64, 'base64');
  const record = { voiceId, model, scriptHash: hash(script), audioHash: hash(audio), alignment: payload.alignment ?? null,
    normalized_alignment: payload.normalized_alignment ?? null, created: new Date().toISOString() };
  await writeFile(audioPath, audio); await atomicJson(metadata, record);
  // Cache the paid response before validation so an alignment issue does not lose it.
  characterTimings(script, record.alignment);
  return { ...record, audioPath, cached: false };
}

export async function runFfmpeg(args, { cwd, signal } = {}) {
  const logPath = path.join(cwd, `.ffmpeg-${randomUUID()}.log`);
  const log = await open(logPath, 'w');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.env.FFMPEG_PATH || ffmpeg.path, ['-hide_banner', '-nostdin', '-y', ...args], {
        cwd, windowsHide: true, stdio: ['ignore', log.fd, log.fd], ...(signal ? { signal } : {}),
      });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${code}`)));
    });
  } catch (e) {
    const detail = (await readFile(logPath, 'utf8')).slice(-2200);
    throw new Error(`${e.message}\n${detail}`);
  } finally { await log.close(); await unlink(logPath).catch(() => {}); }
}

export function wavDuration(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected PCM WAV.');
  let rate, data;
  for (let i = 12; i + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', i, i + 4), size = bytes.readUInt32LE(i + 4);
    if (name === 'fmt ') rate = bytes.readUInt32LE(i + 16);
    if (name === 'data') data = Math.min(size, bytes.length - i - 8);
    i += 8 + size + (size % 2);
  }
  if (!rate || !data) throw new Error('WAV has no usable audio samples.');
  return data / rate;
}
export async function renderVideo({ lesson, alignment, audioPath, mapping = {}, fallbackText = false, requireImageMajority = false, cutMode = 'chunk', artStyle = '', textStyle = 'auto', width = 1280, height = 720, fps = 30, outputDir, signal, onProgress = () => {} }) {
  validateLesson(lesson); characterTimings(lesson.script, alignment);
  if (![[1280,720],[720,1280],[1024,1024],[640,360]].some(([w,h])=>width===w&&height===h)) throw new Error('Unsupported render dimensions.');
  await mkdir(outputDir, { recursive: true });
  onProgress('Decoding narration');
  await runFfmpeg(['-i', audioPath, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', 'audio.wav'], { cwd: outputDir, signal });
  const duration = wavDuration(await readFile(path.join(outputDir, 'audio.wav')));
  const timeline = createTimeline(lesson, alignment, duration, { fps, mapping, fallbackText, cutMode, requireImageMajority });
  const prepared = new Map();
  for (let i = 0; i < timeline.scenes.length; i++) {
    signal?.throwIfAborted(); const scene = timeline.scenes[i];
    const identity = scene.kind === 'image' ? `image:${scene.imagePath}` : `text:${scene.displayText}`;
    if (!prepared.has(identity)) {
      onProgress(`Preparing frame ${i + 1} of ${timeline.scenes.length}`);
      const name = `frame-${String(prepared.size).padStart(4,'0')}.png`;
      if (scene.kind === 'image') {
        await stat(scene.imagePath);
        await runFfmpeg(['-i', scene.imagePath, '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0xfffdf6,setsar=1`, '-frames:v', '1', name], { cwd: outputDir, signal });
      } else {
        await writeFile(path.join(outputDir, name), createTextCard({ text: scene.displayText, width, height, artStyle, textStyle }));
      }
      prepared.set(identity, name);
    }
    scene.frameFile = prepared.get(identity);
  }
  // Encode exact frame counts, then concatenate identical stream formats.
  // This avoids image-demuxer time bases rounding cuts to 1/25 second.
  const concat = ['ffconcat version 1.0'];
  const segments = new Map();
  for (const [index, scene] of timeline.scenes.entries()) {
    const frames = scene.endFrame - scene.startFrame, identity = `${scene.frameFile}:${frames}`;
    if (!segments.has(identity)) {
      onProgress(`Encoding cut ${index + 1} of ${timeline.scenes.length}`);
      const name = `segment-${String(segments.size).padStart(4,'0')}.mp4`;
      await runFfmpeg(['-loop','1','-framerate',String(fps),'-i',scene.frameFile,'-frames:v',String(frames),
        '-an','-c:v','libx264','-preset','fast','-crf','20','-g','1','-bf','0','-pix_fmt','yuv420p',
        '-video_track_timescale','90000',name], {cwd:outputDir,signal});
      segments.set(identity,name);
    }
    concat.push(`file '${segments.get(identity)}'`);
  }
  await writeFile(path.join(outputDir,'frames.ffconcat'),concat.join('\n')+'\n');
  await atomicJson(path.join(outputDir,'timeline.json'),timeline);
  onProgress('Encoding MP4');
  await runFfmpeg(['-f','concat','-safe','0','-i','frames.ffconcat','-i','audio.wav','-map','0:v:0','-map','1:a:0',
    '-c:v','copy',
    '-c:a','aac','-b:a','128k','-af','apad','-t',String(timeline.totalFrames/fps),'-movflags','+faststart','video.mp4'], {cwd:outputDir,signal});
  return {file:path.join(outputDir,'video.mp4'),timeline};
}
