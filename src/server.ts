import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RequestError, validateLessonRequest } from "./lesson-service.js";
import { ProductionService, requireKey } from "./production-service.js";
import type { StageRequest } from "./web-contract.js";
import { PdfService } from "./pdf-service.js";
import { PDF_MAX_BYTES } from "./pdf-limits.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(root, "web-dist");
const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".png": "image/png" };

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(value));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new RequestError("Please send JSON.", 415);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 400_000) throw new RequestError("That file is too large. Try a smaller lesson.", 413);
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new RequestError("That request wasn't valid JSON."); }
}

async function readPdf(req: IncomingMessage): Promise<Uint8Array> {
  if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/pdf") throw new RequestError("Please upload a PDF file.", 415);
  if (Number(req.headers["content-length"]) > PDF_MAX_BYTES) throw new RequestError("Choose a PDF under 25 MB.", 413);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > PDF_MAX_BYTES) throw new RequestError("Choose a PDF under 25 MB.", 413);
    chunks.push(Buffer.from(chunk));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export async function createAppServer(dev = false, service = new ProductionService()) {
  const documents = new PdfService();
  const vite = dev ? await (await import("vite")).createServer({ configFile: resolve(root, "web/vite.config.ts"), server: { middlewareMode: true }, appType: "spa" }) : undefined;
  const requests = new Map<string, { count: number; until: number }>();
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (path.startsWith("/api/")) {
        if (["POST", "DELETE"].includes(req.method ?? "") && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new RequestError("Please submit from the Entertainify app.", 403);
        const documentMatch = /^\/api\/documents\/([a-f0-9-]+)$/.exec(path);
        if (documentMatch?.[1] && (req.method === "GET" || req.method === "DELETE")) {
          const document = documents.get(documentMatch[1]);
          if (!document) throw new RequestError("This PDF import has expired. Please upload it again.", 404);
          if (req.method === "DELETE") { documents.cancel(document.id); json(res, 200, { cancelled: true }); }
          else json(res, 200, document);
          return;
        }
        if (req.method === "GET" && path === "/api/health") {
          const provider = process.env.LLM_PROVIDER?.trim() || "groq";
          json(res, 200, { generationConfigured: Boolean(process.env[provider === "openai" ? "OPENAI_API_KEY" : "GROQ_API_KEY"]?.trim()), rendererConfigured: true });
          return;
        }
        if (req.method === "POST") {
          const stage = /^\/api\/lessons\/([a-f0-9-]+)\/(script|plan|images|video|settings|stop)$/.exec(path);
          if (!["/api/lessons", "/api/demo", "/api/documents", "/api/voices"].includes(path) && !stage) throw new RequestError("Page not found.", 404);
          const now = Date.now();
          for (const [key, value] of requests) if (value.until < now) requests.delete(key);
          const ip = req.socket.remoteAddress ?? "local";
          const limit = requests.get(ip) ?? { count: 0, until: now + 60_000 };
          if (limit.count >= 10) throw new RequestError("Too many requests. Give the studio a minute, then try again.", 429);
          if (path === "/api/documents") {
            limit.count++; requests.set(ip, limit);
            json(res, 202, documents.create(await readPdf(req)));
            return;
          }
          const body = await readBody(req);
          if (stage?.[1] && stage[2]) {
            limit.count++; requests.set(ip, limit);
            json(res, 202, stage[2] === "stop" ? service.stop(stage[1]) : await service.advance(stage[1], stage[2], body as StageRequest)); return;
          }
          if (path === "/api/voices") {
            limit.count++; requests.set(ip, limit);
            const apiKey = requireKey((body as { apiKey?: unknown } | null)?.apiKey, "ElevenLabs");
            const response = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": apiKey }, redirect: "error", signal: AbortSignal.timeout(15_000) });
            if (!response.ok) throw new RequestError(`ElevenLabs voice list failed (HTTP ${response.status}). Check key permissions.`, 400);
            const result = await response.json() as { voices?: { voice_id: string; name: string }[] };
            json(res, 200, { voices: (result.voices ?? []).map(v => ({ id: v.voice_id, name: v.name })) }); return;
          }
          const request = path === "/api/demo" ? { text: "Sample", mode: "script" as const, audience: "Everyone", targetWords: 150 } : validateLessonRequest(body);
          limit.count++;
          requests.set(ip, limit);
          json(res, 202, service.create(request, path === "/api/demo"));
          return;
        }
        if (req.method === "GET" && path === "/api/lessons") { json(res, 200, service.list()); return; }
        const asset = /^\/api\/lessons\/([a-f0-9-]+)\/assets\/(.+)$/.exec(path);
        if ((req.method === "GET" || req.method === "HEAD") && asset?.[1] && asset[2]) {
          const file = service.assetPath(asset[1], asset[2]);
          const info = await stat(file).catch(() => { throw new RequestError("Saved asset not found.", 404); });
          let start = 0, end = info.size - 1, status = 200;
          if (req.headers.range) {
            const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
            if (!range || (!range[1] && !range[2])) { res.writeHead(416, { "Content-Range": `bytes */${info.size}` }); res.end(); return; }
            if (!range[1]) start = Math.max(0, info.size - Number(range[2]));
            else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
            if (start > end || start >= info.size) { res.writeHead(416, { "Content-Range": `bytes */${info.size}` }); res.end(); return; }
            status = 206; res.setHeader("Content-Range", `bytes ${start}-${end}/${info.size}`);
          }
          const types: Record<string, string> = { ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".png": "image/png", ".json": "application/json" };
          res.writeHead(status, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Content-Length": end - start + 1, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
          if (req.method === "HEAD") res.end();
          else { const stream = createReadStream(file, { start, end }); stream.on("error", () => res.destroy()); res.on("close", () => stream.destroy()); stream.pipe(res); }
          return;
        }
        const match = /^\/api\/lessons\/([a-f0-9-]+)(\/(json|export|source|script))?$/.exec(path);
        if (req.method === "GET" && match?.[1]) {
          const job = service.get(match[1]);
          if (!job) throw new RequestError("This saved lesson could not be found.", 404);
          if (match[3] === "source" || match[3] === "script") {
            const content = match[3] === "source" ? job.sourceText : job.result?.script;
            if (!content) throw new RequestError("This text is not ready yet.", 409);
            res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${match[3]}.txt"`, "Cache-Control": "no-store" }); res.end(content); return;
          }
          if (match[2]) {
            if (!job.result) throw new RequestError("The script is still being written.", 409);
            res.setHeader("Content-Disposition", 'attachment; filename="entertainify-lesson.json"');
            json(res, 200, match[3] === "export" ? { ...job.result, artStyle: job.settings?.style, imageAspect: job.settings?.imageAspect, imageModel: job.settings?.imageModel, textStyle: job.settings?.textStyle, images: job.frames ?? [], outputs: job.outputs ?? [] } : job.result);
          } else json(res, 200, job);
          return;
        }
        throw new RequestError("Page not found.", 404);
      }
      if (vite) { vite.middlewares(req, res); return; }
      if (req.method !== "GET" && req.method !== "HEAD") throw new RequestError("Method not allowed.", 405);
      const decoded = decodeURIComponent(path);
      let file = resolve(publicRoot, `.${decoded}`);
      if (!file.startsWith(publicRoot + sep) && file !== publicRoot) throw new RequestError("Page not found.", 404);
      try { if (!(await stat(file)).isFile()) file = resolve(publicRoot, "index.html"); }
      catch { if (extname(file)) throw new RequestError("Page not found.", 404); file = resolve(publicRoot, "index.html"); }
      const content = await readFile(file);
      res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (!res.headersSent) json(res, error instanceof RequestError ? error.statusCode : 500, { error: error instanceof RequestError ? error.message : "The studio hit a snag. Please try again." });
      else res.end();
    }
  });
  server.on("close", () => { documents.close(); void service.close(); void vite?.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  const server = await createAppServer(process.argv.includes("--dev"));
  server.listen(port, host, () => console.log(`Entertainify studio is open at http://${host}:${port}`));
  server.on("error", (error) => { console.error(`Could not open the studio: ${error.message}`); process.exitCode = 1; });
}
