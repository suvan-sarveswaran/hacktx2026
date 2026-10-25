/** A small structural interface also usable in Node tests, without browser globals. */
export interface LessonFile {
  name: string;
  size: number;
  text(): Promise<string>;
}

export async function readLessonFile(file: LessonFile, readPdf?: () => Promise<string>): Promise<string> {
  if (/\.pdf$/i.test(file.name)) {
    if (!file.size) throw new Error("This PDF is empty. Try one with some pages.");
    if (file.size > 25 * 1024 * 1024) throw new Error("Choose a PDF under 25 MB. A chapter or a short slide deck works best.");
    if (!readPdf) throw new Error("The PDF reader isn't connected. Start the Entertainify server and try again.");
    return readPdf();
  }
  if (!/\.(txt|md)$/i.test(file.name)) throw new Error("Please choose a .pdf, .txt or .md file. Export PowerPoint slides as a PDF first.");
  if (file.size > 320_000) throw new Error("This file is too big. Choose a short chapter under 80,000 characters.");
  const content = await file.text();
  if (!content.trim()) throw new Error("This file is empty. Try one with a little more to say.");
  if (content.includes("\0") || content.includes("�")) throw new Error("Please save the file as UTF-8 plain text and try again.");
  if (content.length > 80_000) throw new Error("Keep your text under 80,000 characters. A chapter at a time works best.");
  return content;
}
