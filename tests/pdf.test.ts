import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { PDFDocument } from "pdf-lib";
import { extractPdf } from "../src/pdf-extractor.js";
import { cleanSourceText, imageTextAdditions } from "../src/pdf-text.js";
import { PdfService } from "../src/pdf-service.js";
import { LessonService, parseNarration } from "../src/lesson-service.js";
import { scannedPdf, slidesPdf, textbookPdf } from "./pdf-fixtures.js";

test("textbook PDFs keep columns in reading order and remove repeated headers/footers", async () => {
  const result = await extractPdf(await textbookPdf());
  assert.equal(result.pageCount, 3);
  assert.equal(result.ocrPages.length, 0);
  assert.doesNotMatch(result.text, /Biology textbook|Page [123]/);
  assert.match(result.text, /Lesson 1: Cell energy/);
  assert.ok(result.text.indexOf("Leaves make sugar") < result.text.indexOf("Mitochondria release energy"));
  assert.ok(result.text.indexOf("Cells use ATP") < result.text.indexOf("Lesson 2"));
});

test("landscape slideshow PDFs retain headings and bullets in page order", async () => {
  const result = await extractPdf(await slidesPdf());
  assert.equal(result.pageCount, 2);
  assert.match(result.text, /• Energy cannot be created or destroyed/);
  assert.ok(result.text.indexOf("rolling ball") < result.text.indexOf("Potential energy"));
});

test("image-only, mixed-content, and sideways scanned PDFs yield actual OCR text", { timeout: 120_000 }, async () => {
  for (const options of [{}, { mixed: true }, { sideways: true }, { rotatedPage: true }]) {
    const result = await extractPdf(await scannedPdf(options));
    assert.match(result.text, /Plants use sunlight to make sugar/i);
    assert.match(result.text, /Oxygen is released during photosynthesis/i);
    if (options.mixed) assert.match(result.text, /Lesson notes: Photosynthesis takes place in plant cells/);
    assert.deepEqual(result.ocrPages, [1]);
    assert.ok(result.warnings.some((warning) => warning.includes("diagrams")));
  }
});

test("cleanup preserves bullets and math, repairs ligatures and wrapped words without duplicating native text", () => {
  assert.equal(cleanSourceText("  An ofﬁce\r\nphoto-\nsynthesis\n\n• E = mc²\u0000  "), "An office\nphotosynthesis\n\n• E = mc²");
  assert.equal(imageTextAdditions("Leaves absorb sunlight.", "Leaves absorb sunlight.\nWater enters through roots."), "Water enters through roots.");
});

test("invalid, empty, oversized, and overlong PDFs fail clearly instead of truncating", async () => {
  await assert.rejects(extractPdf(new Uint8Array()), /empty/);
  await assert.rejects(extractPdf(Buffer.from("not a PDF")), /valid PDF/);
  await assert.rejects(extractPdf(Buffer.from("%PDF-1.7\ncorrupt")), /couldn't be read/);
  await assert.rejects(extractPdf(new Uint8Array(25 * 1024 * 1024 + 1)), /25 MB/);
  const long = await PDFDocument.create();
  for (let i = 0; i < 61; i++) long.addPage();
  await assert.rejects(extractPdf(await long.save()), /60 pages/);
  const verbose = await PDFDocument.create();
  for (let i = 0; i < 9; i++) {
    const page = verbose.addPage();
    for (let line = 0; line < 90; line++) page.drawText("a".repeat(100), { x: 40, y: 740 - line * 7, size: 6 });
  }
  await assert.rejects(extractPdf(await verbose.save()), /80,000 characters/);
});

test("PDF jobs complete in isolated workers; cancellation and timeouts release capacity", { timeout: 30_000 }, async (t) => {
  const service = new PdfService(); t.after(() => service.close());
  const bytes = await slidesPdf();
  const job = service.create(bytes);
  const cancelled = service.create(bytes);
  assert.throws(() => service.create(bytes), /Two PDFs/);
  service.cancel(cancelled.id);
  assert.equal(service.get(cancelled.id), undefined);
  for (let i = 0; i < 200 && job.status === "reading"; i++) await delay(50);
  assert.equal(job.status, "ready", job.error);
  assert.equal(job.progress, 100);
  assert.match(job.result!.text, /Energy in motion/);
  const short = new PdfService(1); t.after(() => short.close());
  const timeout = short.create(bytes);
  await delay(50);
  assert.equal(timeout.status, "failed");
  assert.match(timeout.error!, /too long/);
});

test("PDF source goes through the existing writing and renderer contracts unchanged", async () => {
  const source = await extractPdf(await slidesPdf());
  let rendered = false;
  const service = new LessonService({
    generate: async (text, options) => {
      assert.equal(text, source.text); assert.equal(options?.inputMode, "material");
      return parseNarration("A rolling ball has kinetic energy. A raised book stores potential energy.");
    },
    renderer: {
      submit: async (lesson) => {
        assert.deepEqual(Object.keys(lesson), ["title", "script", "chunks", "metadata"]);
        assert.ok(lesson.chunks.length); rendered = true;
        return { id: "pdf-video", status: "complete", videoUrl: "https://video.example/pdf.mp4" };
      },
      getStatus: async () => { throw new Error("Already complete"); },
    },
  });
  const job = service.create({ text: source.text, mode: "material", audience: "Students", targetWords: 150 });
  for (let i = 0; i < 100 && job.status !== "complete"; i++) await delay(5);
  assert.ok(rendered); assert.equal(job.status, "complete");
  assert.equal(job.videoUrl, "https://video.example/pdf.mp4");
});
