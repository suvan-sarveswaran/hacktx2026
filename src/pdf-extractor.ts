import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument, OPS, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker, OEM, PSM } from "tesseract.js";
import type { Worker as OcrWorker } from "tesseract.js";
import type { PdfProgress, PdfSource } from "./web-contract.js";
import { cleanSourceText, imageTextAdditions, readTextBoxes, removeRunningFurniture } from "./pdf-text.js";
import { PDF_MAX_PAGES, validatePdfBytes } from "./pdf-limits.js";

const require = createRequire(import.meta.url);
const pdfRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const language = require("@tesseract.js-data/eng") as { langPath: string };

export async function extractPdf(bytes: Uint8Array, report: (progress: PdfProgress) => void = () => {}): Promise<PdfSource> {
  validatePdfBytes(bytes);
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0,
    standardFontDataUrl: join(pdfRoot, "standard_fonts") + "/",
    cMapUrl: join(pdfRoot, "cmaps") + "/", cMapPacked: true,
    wasmUrl: join(pdfRoot, "wasm") + "/", useSystemFonts: true });
  let worker: OcrWorker | undefined;
  let currentPage = 0, totalPages = 0;
  const pages: string[] = [], ocrPages: number[] = [], warnings: string[] = [];
  const margins: string[][] = [];
  const warn = (message: string) => { if (!warnings.includes(message)) warnings.push(message); };
  try {
    const pdf = await task.promise;
    totalPages = pdf.numPages;
    if (totalPages > PDF_MAX_PAGES) throw new Error("This PDF has more than 60 pages. Upload a chapter or a smaller set of slides.");
    for (currentPage = 1; currentPage <= totalPages; currentPage++) {
      report({ page: currentPage, totalPages, progress: Math.round((currentPage - 1) / totalPages * 95), message: `Reading page ${currentPage} of ${totalPages}…` });
      const page = await pdf.getPage(currentPage);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const boxes = content.items.flatMap((item) => {
          if (!("str" in item) || !item.str.trim()) return [];
          const t = Util.transform(viewport.transform, item.transform);
          const h = Math.hypot(t[2]!, t[3]!);
          return [{ text: item.str, x: t[4]!, y: t[5]! - h, width: item.width, height: h || item.height || 12 }];
        });
        let text = cleanSourceText(readTextBoxes(boxes));
        margins.push(cleanSourceText(readTextBoxes(boxes.filter((box) => box.y + box.height < viewport.height * .065 || box.y > viewport.height * .94))).split("\n"));
        const operations = await page.getOperatorList();
        const hasImages = operations.fnArray.some((op) => [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].includes(op));
        const rotatedText = content.items.some((item) => "transform" in item && Math.abs(item.transform[1]) > Math.abs(item.transform[0]));
        if (hasImages || text.length < 30 || text.includes("�") || rotatedText || page.rotate % 180 !== 0) {
          if (!worker) {
            worker = await createWorker("eng", OEM.LSTM_ONLY, { langPath: language.langPath, cacheMethod: "none", gzip: true,
              logger: (event) => { if (event.status === "recognizing text") report({ page: currentPage, totalPages, progress: Math.round(((currentPage - 1) + event.progress * .9) / totalPages * 95), message: `Reading images on page ${currentPage} of ${totalPages}…` }); } });
            await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: "1" });
          }
          // Enough detail for small slide labels, bounded for very large page dimensions.
          const scale = Math.min(3, 3200 / Math.max(viewport.width, viewport.height), Math.sqrt(8_000_000 / (viewport.width * viewport.height)));
          const rendered = page.getViewport({ scale });
          const canvas = createCanvas(Math.ceil(rendered.width), Math.ceil(rendered.height));
          await page.render({ canvas: canvas as never, canvasContext: canvas.getContext("2d") as never, viewport: rendered, background: "white" }).promise;
          let result = (await worker.recognize(canvas.toBuffer("image/png"), { rotateAuto: true })).data;
          // Scanners sometimes bake a sideways image into an otherwise upright PDF.
          if (result.confidence < 65 || cleanSourceText(result.text).length < 20) {
            for (const angle of [90, 180, 270]) {
              const rotated = createCanvas(angle === 180 ? canvas.width : canvas.height, angle === 180 ? canvas.height : canvas.width);
              const ctx = rotated.getContext("2d");
              ctx.translate(rotated.width / 2, rotated.height / 2); ctx.rotate(angle * Math.PI / 180);
              ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
              const candidate = (await worker.recognize(rotated.toBuffer("image/png"), { rotateAuto: true })).data;
              if (candidate.text.trim().length > 20 && candidate.confidence > result.confidence) result = candidate;
              if (result.confidence >= 80) break;
            }
          }
          const recognized = cleanSourceText(result.text);
          ocrPages.push(currentPage);
          if (!text || text.length < 30 || text.includes("�") || rotatedText || page.rotate % 180 !== 0) text = recognized || text;
          else if (recognized && result.confidence >= 65) {
            const extra = cleanSourceText(imageTextAdditions(text, recognized));
            if (extra) text += `\n\nText from figures:\n${extra}`;
          }
          if (recognized && result.confidence < 75) warn(`Page ${currentPage} has uncertain OCR. Check its text before generating.`);
          if (hasImages) warn("Image text was read with English OCR. Check diagrams, tables, equations, and handwriting; visual relationships may need a short explanation.");
        }
        if (!text.trim()) warn(`Page ${currentPage} has no readable text. If it contains a diagram, add its explanation below.`);
        pages.push(cleanSourceText(text));
        if (pages.join("\n\n").length > 80_000) throw new Error("This PDF contains more than 80,000 characters. Upload fewer pages; nothing has been cut off.");
      } finally { page.cleanup(); }
    }
    const text = cleanSourceText(removeRunningFurniture(pages, margins).join("\n\n"));
    if (!text) throw new Error("No readable text was found. Try a sharper scan, or paste a description of the pages.");
    return { text, pageCount: totalPages, ocrPages, warnings };
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") throw new Error("This PDF is password-protected. Export an unlocked copy and upload it again.");
    if (error instanceof Error && ["InvalidPDFException", "FormatError"].includes(error.name)) throw new Error("This PDF couldn't be read. Re-export it from your textbook or slideshow app and try again.");
    throw error;
  } finally {
    await worker?.terminate();
    await task.destroy();
  }
}
