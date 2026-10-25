import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LessonService, RequestError, validateLessonRequest } from "./lesson-service.js";
import { createHttpVideoRenderer } from "./video-renderer.js";
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

export async function createAppServer(dev = false) {
  const rendererUrl = process.env.VIDEO_RENDERER_URL?.trim();
  const service = new LessonService(rendererUrl ? { renderer: createHttpVideoRenderer(rendererUrl, process.env.VIDEO_RENDERER_TOKEN) } : {});
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
          json(res, 200, { generationConfigured: Boolean(process.env[provider === "openai" ? "OPENAI_API_KEY" : "GROQ_API_KEY"]?.trim()), rendererConfigured: Boolean(rendererUrl) });
          return;
        }
        if (req.method === "POST") {
          if (!["/api/lessons", "/api/demo", "/api/documents"].includes(path)) throw new RequestError("Page not found.", 404);
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
          const request = path === "/api/demo" ? { text: "Sample", mode: "script" as const, audience: "Everyone", targetWords: 150 } : validateLessonRequest(body);
          limit.count++;
          requests.set(ip, limit);
          json(res, 202, service.create(request, path === "/api/demo"));
          return;
        }
        const match = /^\/api\/lessons\/([a-f0-9-]+)(\/json)?$/.exec(path);
        if (req.method === "GET" && match?.[1]) {
          const job = service.get(match[1]);
          if (!job) throw new RequestError("This lesson has expired. Create a new one to get going again.", 404);
          if (match[2]) {
            if (!job.result) throw new RequestError("The script is still being written.", 409);
            res.setHeader("Content-Disposition", 'attachment; filename="entertainify-lesson.json"');
            json(res, 200, job.result);
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
  server.on("close", () => { documents.close(); void vite?.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  const server = await createAppServer(process.argv.includes("--dev"));
  server.listen(port, host, () => console.log(`Entertainify studio is open at http://${host}:${port}`));
  server.on("error", (error) => { console.error(`Could not open the studio: ${error.message}`); process.exitCode = 1; });
}
