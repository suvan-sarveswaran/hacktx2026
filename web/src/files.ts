/** A small structural interface also usable in Node tests, without browser globals. */
export interface LessonFile {
  name: string;
  size: number;
  text(): Promise<string>;
}

export async function readLessonFile(file: LessonFile): Promise<string> {
  if (!/\.(txt|md)$/i.test(file.name)) throw new Error("Please choose a .txt or .md file. Export slides or textbook excerpts as text first.");
  if (file.size > 320_000) throw new Error("This file is too big. Choose a short chapter under 80,000 characters.");
  const content = await file.text();
  if (!content.trim()) throw new Error("This file is empty. Try one with a little more to say.");
  if (content.includes("\0") || content.includes("�")) throw new Error("Please save the file as UTF-8 plain text and try again.");
  if (content.length > 80_000) throw new Error("Keep your text under 80,000 characters. A chapter at a time works best.");
  return content;
}
