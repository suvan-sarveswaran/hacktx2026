import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const hash = value => createHash('sha256').update(value).digest('hex');
const integer = (value, name, min, max) => {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
};
async function atomicJson(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2));
  await rename(temp, file);
}
export function retryAfterMs(value, now = Date.now()) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}
function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (/^GIF8[79]a/.test(bytes.toString('ascii', 0, 6))) return 'gif';
  throw new Error('Response is not a supported raster image (PNG/JPEG/WebP/GIF)');
}
class ApiError extends Error {
  constructor(status) { super(`Pollinations returned HTTP ${status}`); this.status = status; }
}

/** Server-side only. No paid requests are made until this function is called. */
export async function generateImages(prompts, options = {}) {
  if (!Array.isArray(prompts) || prompts.some(p => typeof p !== 'string' || !p.trim()))
    throw new Error('prompts must be an array of nonempty strings');
  const {
    apiKey = process.env.POLLINATIONS_API_KEY,
    model = process.env.POLLINATIONS_MODEL,
    outDir = 'generated', concurrency = 4, width = 1024, height = 1024,
    seed = 42, seedMode = 'fixed', maxRetries = 4, timeoutMs = 120000,
    maxJobWaitMs = 1800000, pollMs = 5000, signal, onProgress = () => {},
    // Override only for local tests or a trusted compatible gateway.
    baseUrl = 'https://gen.pollinations.ai', retryBaseMs = 1000, minIntervalMs = 1100,
  } = options;
  if (!apiKey) throw new Error('Set POLLINATIONS_API_KEY on the server');
  if (!model) throw new Error('Choose a model from https://gen.pollinations.ai/image/models and set POLLINATIONS_MODEL');
  if (!['fixed','prompt'].includes(seedMode)) throw new Error('seedMode must be fixed or prompt');
  integer(concurrency, 'concurrency', 1, 64);
  integer(width, 'width', 64, 4096); integer(height, 'height', 64, 4096);
  integer(seed, 'seed', 0, 2147483647); integer(maxRetries, 'maxRetries', 0, 20);
  for (const [name, value] of Object.entries({ timeoutMs, maxJobWaitMs, pollMs, retryBaseMs, minIntervalMs }))
    integer(value, name, 1, 2147483647);

  const root = path.resolve(outDir);
  const cacheDir = path.join(root, '.cache');
  await mkdir(cacheDir, { recursive: true });
  // Only one batch writer may use this directory at a time.
  const lockPath = path.join(root, '.batch.lock');
  const lock = await import('node:fs/promises').then(fs => fs.open(lockPath, 'wx'))
    .catch(() => { throw new Error(`Output directory is locked: ${root}. See README for crash recovery.`); });
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const stop = new AbortController();
  const combined = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  let stoppedReason = null, active = 0, limit = Math.min(2, concurrency), cooldown = 0, successes = 0;
  const startedAt = new Date().toISOString();
  const settings = { model, width, height, seed, baseUrl };
  const rows = prompts.map((prompt, index) => {
    const sceneSeed=seedMode==='prompt'?parseInt(hash(prompt).slice(0,8),16)%2147483647:seed;
    return { index, prompt, seed:sceneSeed, status:'pending', key:hash(JSON.stringify({...settings,seed:sceneSeed,prompt})) };
  });
  const unique = [...new Map(rows.map(row => [row.key, row])).values()];
  let next = 0, writeQueue = Promise.resolve();
  const manifest = () => ({ version: 1, startedAt, updatedAt: new Date().toISOString(), settings:{...settings,seedMode},
    stoppedReason, total: rows.length, unique: unique.length,
    succeeded: rows.filter(r => r.status === 'done').length,
    failed: rows.filter(r => r.status === 'failed').length, scenes: rows });
  const persist = () => {
    const snapshot = JSON.parse(JSON.stringify(manifest()));
    writeQueue = writeQueue.then(() => atomicJson(path.join(root, 'manifest.json'), snapshot));
    return writeQueue;
  };
  const progress = event => { try { onProgress({ ...event, concurrency: limit }); } catch { /* UI cannot interrupt downloads. */ } };
  const wait = ms => delay(ms, undefined, { signal: combined });
  const awaitCooldown = async () => { while (cooldown > Date.now()) await wait(cooldown - Date.now()); };
  const halt = status => {
    stoppedReason = `HTTP ${status}: ${status === 402 ? 'Pollen or key budget exhausted' : 'API key invalid or access denied'}`;
    stop.abort(new Error(stoppedReason));
  };

  let nextRequestAt = 0;
  async function request(endpoint, { image = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      await awaitCooldown();
      const startAt = Math.max(Date.now(), nextRequestAt);
      nextRequestAt = startAt + minIntervalMs;
      if (startAt > Date.now()) await wait(startAt - Date.now());
      await awaitCooldown();
      combined.throwIfAborted();
      try {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}${endpoint}`, {
          headers: { Authorization: `Bearer ${apiKey}`, Prefer: 'respond-async' },
          signal: AbortSignal.any([combined, AbortSignal.timeout(timeoutMs)]),
          redirect: 'error',
        });
        if ([401, 402, 403].includes(response.status)) {
          await response.body?.cancel(); halt(response.status); throw new ApiError(response.status);
        }
        if (!response.ok) {
          const retryMs = retryAfterMs(response.headers.get('retry-after'));
          await response.body?.cancel();
          if (response.status === 429) {
            limit = Math.max(1, Math.floor(limit / 2)); successes = 0;
            cooldown = Math.max(cooldown, Date.now() + Math.max(retryMs, retryBaseMs * 2 ** attempt));
          } else if (retryMs) cooldown = Math.max(cooldown, Date.now() + retryMs);
          if (response.status !== 429 && ![408, 500, 502, 503, 504].includes(response.status)) throw new ApiError(response.status);
          throw Object.assign(new ApiError(response.status), { retryable: true });
        }
        // Consume bodies within the timeout. Avoid unbounded buffers for bad responses.
        const chunks = []; let size = 0;
        const maxBytes = image ? 30 * 1024 * 1024 : 1024 * 1024;
        for await (const chunk of response.body ?? []) {
          size += chunk.length;
          if (size > maxBytes) throw new Error('API response exceeds size limit');
          chunks.push(chunk);
        }
        const bytes = Buffer.concat(chunks);
        return { status: response.status, headers: response.headers, bytes };
      } catch (error) {
        if (combined.aborted) throw combined.reason;
        const retryable = error.retryable || error.name === 'TimeoutError' || error.name === 'TypeError';
        if (!retryable || attempt >= maxRetries) throw error;
        const ms = retryBaseMs * 2 ** attempt + Math.random() * retryBaseMs;
        progress({ type: 'retry', attempt: attempt + 1, status: error.status ?? 'network', waitMs: Math.ceil(Math.max(ms, cooldown - Date.now())) });
        await wait(ms);
      }
    }
  }

  async function generate(row) {
    const metadataFile = path.join(cacheDir, `${row.key}.json`);
    let cached;
    try { cached = JSON.parse(await readFile(metadataFile, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    if (cached?.file && /^assets\/[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(cached.file)) {
      try {
        const bytes = await readFile(path.join(root, cached.file));
        if (hash(bytes) === cached.sha256) return { file: cached.file, cached: true };
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    let jobId = cached?.jobId;
    let response;
    if (!jobId) {
      const params = new URLSearchParams({ model, width: String(width), height: String(height), seed: String(row.seed) });
      response = await request(`/image/${encodeURIComponent(row.prompt)}?${params}`, { image: true });
      if (response.status === 202) {
        jobId = JSON.parse(response.bytes.toString()).id;
        if (typeof jobId !== 'string' || !jobId) throw new Error('Async response has no job id');
        // Save before polling so interruption can resume without submitting again.
        await atomicJson(metadataFile, { jobId });
      }
    }
    if (jobId) {
      const deadline = Date.now() + maxJobWaitMs;
      let firstPoll = true;
      while (true) {
        if (Date.now() >= deadline) throw new Error('Job wait timed out; rerun to resume the saved job');
        const providerWait = firstPoll ? retryAfterMs(response?.headers.get('retry-after')) : 0;
        if (firstPoll && response?.status === 202) await wait(Math.max(pollMs, providerWait));
        firstPoll = false;
        let stateResponse;
        try { stateResponse = await request(`/v1/jobs/${encodeURIComponent(jobId)}`); }
        catch (error) {
          if (error.status === 404) throw new Error('Saved job expired or unavailable. Remove its .cache metadata to explicitly allow a new generation.');
          throw error;
        }
        const state = JSON.parse(stateResponse.bytes.toString());
        if (state.status === 'succeeded') break;
        if (['failed', 'cancelled', 'canceled'].includes(state.status)) throw new Error('Provider generation job failed');
        await wait(Math.max(pollMs, retryAfterMs(stateResponse.headers.get('retry-after'))));
      }
      response = await request(`/v1/jobs/${encodeURIComponent(jobId)}/result`, { image: true });
    }
    const extension = imageType(response.bytes);
    await mkdir(path.join(root, 'assets'), { recursive: true });
    const file = `assets/${row.key}.${extension}`;
    const destination = path.join(root, file);
    const temp = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temp, response.bytes); await rename(temp, destination);
    await atomicJson(metadataFile, { file, sha256: hash(response.bytes) });
    return { file, cached: false };
  }

  async function worker() {
    while (!combined.aborted) {
      if (active >= limit || cooldown > Date.now()) { await wait(50); continue; }
      if (next >= unique.length) return;
      const row = unique[next++]; active++;
      const group = rows.filter(r => r.key === row.key);
      group.forEach(r => { r.status = 'running'; });
      progress({ type: 'started', index: row.index });
      try {
        const result = await generate(row);
        group.forEach(r => Object.assign(r, result, { status: 'done' }));
        if (!result.cached && ++successes >= 4 && limit < concurrency) { limit++; successes = 0; }
        progress({ type: 'done', index: row.index, ...result });
      } catch (error) {
        group.forEach(r => Object.assign(r, { status: combined.aborted ? 'pending' : 'failed', error: combined.aborted ? 'Batch stopped; safe to resume' : error.message }));
        progress({ type: 'failed', index: row.index, error: group[0].error });
      } finally { active--; await persist(); }
    }
  }
  try {
    await persist();
    const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
    const broken = settled.find(result => result.status === 'rejected' && !combined.aborted);
    if (broken) throw broken.reason;
    if (signal?.aborted && !stoppedReason) stoppedReason = 'Interrupted; rerun with the same output directory to resume';
    await persist();
    return { ...manifest(), outputDirectory: root };
  } finally {
    await lock.close();
    await import('node:fs/promises').then(fs => fs.unlink(lockPath));
  }
}
