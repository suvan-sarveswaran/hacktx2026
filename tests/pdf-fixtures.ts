import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";

export async function textbookPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const page = pdf.addPage([612, 792]);
    page.drawText("Biology textbook", { x: 50, y: 755, size: 10, font });
    page.drawText(`Lesson ${i}: Cell energy`, { x: 50, y: 700, size: 22, font });
    // Deliberately interleave the PDF drawing order. Reading order must be spatial.
    page.drawText("Mitochondria release energy.", { x: 330, y: 640, size: 12, font });
    page.drawText("Plants capture sunlight.", { x: 50, y: 640, size: 12, font });
    page.drawText("Cells use ATP to do work.", { x: 330, y: 616, size: 12, font });
    page.drawText("Leaves make sugar.", { x: 50, y: 616, size: 12, font });
    page.drawText(`Page ${i}`, { x: 290, y: 30, size: 10, font });
  }
  return pdf.save();
}

export async function slidesPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const [title, lines] of [
    ["Energy in motion", ["Energy cannot be created or destroyed.", "A rolling ball has kinetic energy."]],
    ["Potential energy", ["A raised book stores gravitational energy.", "When it falls, potential energy becomes kinetic energy."]],
  ] as const) {
    const page = pdf.addPage([960, 540]);
    page.drawText(title, { x: 55, y: 455, size: 34, font });
    lines.forEach((line, i) => page.drawText(`• ${line}`, { x: 55, y: 350 - i * 60, size: 23, font }));
  }
  return pdf.save();
}

export async function scannedPdf(options: { mixed?: boolean; sideways?: boolean; rotatedPage?: boolean } = {}): Promise<Uint8Array> {
  const canvas = createCanvas(1400, 800);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "black"; ctx.font = "bold 52px Arial";
  ctx.fillText("Photosynthesis", 80, 130);
  ctx.font = "36px Arial";
  ["Plants use sunlight to make sugar.", "Leaves absorb carbon dioxide from the air.", "Oxygen is released during photosynthesis.", "Water enters through the roots."].forEach((line, i) => ctx.fillText(line, 80, 240 + i * 85));
  let imageCanvas = canvas;
  if (options.sideways) {
    imageCanvas = createCanvas(canvas.height, canvas.width);
    const rotated = imageCanvas.getContext("2d");
    rotated.translate(imageCanvas.width, 0); rotated.rotate(Math.PI / 2); rotated.drawImage(canvas, 0, 0);
  }
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(imageCanvas.toBuffer("image/png"));
  const page = pdf.addPage([image.width / 2, image.height / 2 + (options.mixed ? 80 : 0)]);
  page.drawImage(image, { x: 0, y: 0, width: image.width / 2, height: image.height / 2 });
  if (options.mixed) page.drawText("Lesson notes: Photosynthesis takes place in plant cells.", { x: 35, y: image.height / 2 + 35, size: 16, font: await pdf.embedFont(StandardFonts.Helvetica) });
  if (options.rotatedPage) page.setRotation(degrees(90));
  return pdf.save();
}
