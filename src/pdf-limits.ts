export const PDF_MAX_BYTES = 25 * 1024 * 1024;
export const PDF_MAX_PAGES = 60;

export function validatePdfBytes(bytes: Uint8Array): void {
  if (!bytes.length) throw new Error("This PDF is empty. Choose a file with some pages.");
  if (bytes.length > PDF_MAX_BYTES) throw new Error("Choose a PDF under 25 MB. Export just the chapter or slides you need.");
  if (!Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from("%PDF-"))) throw new Error("This file isn't a valid PDF. Export it as a PDF and try again.");
}
