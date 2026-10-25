import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, FileText, LoaderCircle, Upload } from "lucide-react";
import type { LessonFormat, LessonJob, LessonRequest, PdfProgress, PdfSource } from "../../src/web-contract";
import { Book, Pencil, Spark } from "./Art";
import { readLessonFile } from "./files";
import { api } from "./api";
import { ApiKeyField, Production } from "./Production";

interface StudioProps {
  kind: LessonFormat; job: LessonJob | null; busy: boolean; restoring: boolean; error: string; visible: boolean;
  onGenerate: (request: LessonRequest) => Promise<LessonJob | undefined>;
  onReset: () => void; onRetryConnection: () => void; onUpdate: (job: LessonJob) => void;
}
const names = { youtube: "YouTube Video", short: "Short-form", comic: "Comic Book" };
export function Studio({ kind, job, busy, restoring, error, visible, onGenerate, onReset, onRetryConnection, onUpdate }: StudioProps) {
  const storageKey = `entertainify-draft-v3-${kind}`;
  const [draft] = useState(() => { try { return JSON.parse(localStorage.getItem(storageKey) ?? "{}") ?? {}; } catch { return {}; } });
  const [text, setText] = useState<string>(typeof draft.text === "string" ? draft.text : "");
  const [audience, setAudience] = useState<string>(draft.audience ?? "Middle school students (grades 6–8)");
  const lengths = kind === "short" ? [75, 150, 300] : [75, 150, 300, 600, 900];
  const [targetWords, setTargetWords] = useState<number>(lengths.includes(draft.targetWords) ? draft.targetWords : kind === "short" ? 75 : 300);
  const [fileName, setFileName] = useState<string>(draft.fileName ?? "");
  const [inputMode, setInputMode] = useState<"topic" | "material">(draft.inputMode === "material" ? "material" : "topic");
  const [scriptMode, setScriptMode] = useState(draft.scriptMode === true && kind !== "comic");
  const [brainrot, setBrainrot] = useState(draft.brainrot === true);
  const [comicPanels, setComicPanels] = useState<4 | 6 | 8>([4, 6, 8].includes(draft.comicPanels) ? draft.comicPanels : 6);
  const [groqKey, setGroqKey] = useState("");
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileProgress, setFileProgress] = useState<PdfProgress | null>(null);
  const [pdfInfo, setPdfInfo] = useState<Omit<PdfSource, "text"> | null>(draft.pdfInfo ?? null);
  const fileController = useRef<AbortController | null>(null), fileInput = useRef<HTMLInputElement>(null), fileVersion = useRef(0);
  useEffect(() => () => { fileVersion.current++; fileController.current?.abort(); }, []);
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify({ text, audience, targetWords, fileName, inputMode, scriptMode, brainrot, comicPanels, pdfInfo })); } catch { /* Optional local draft. */ } }, [storageKey, text, audience, targetWords, fileName, inputMode, scriptMode, brainrot, comicPanels, pdfInfo]);
  async function loadFile(file?: File) {
    if (!file) return;
    const version = ++fileVersion.current;
    fileController.current?.abort(); const controller = new AbortController(); fileController.current = controller;
    setFileError(""); setPdfInfo(null); setFileProgress(null); setLoadingFile(true);
    try {
      const content = await readLessonFile(file, async () => {
        setFileProgress({ page: 0, totalPages: 0, progress: 0, message: "Uploading your PDF…" });
        const result = await api.importPdf(file, progress => { if (version === fileVersion.current) setFileProgress(progress); }, controller.signal);
        if (version === fileVersion.current) setPdfInfo({ pageCount: result.pageCount, ocrPages: result.ocrPages, warnings: result.warnings });
        return result.text;
      });
      if (version !== fileVersion.current || controller.signal.aborted) return;
      setText(content); setFileName(file.name); setInputMode("material"); setScriptMode(false);
    } catch (e) { if (version === fileVersion.current && !controller.signal.aborted) setFileError(e instanceof Error ? e.message : "Couldn't read that file."); }
    finally { if (version === fileVersion.current) setLoadingFile(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!text.trim() || loadingFile) return;
    const created = await onGenerate({ text, mode: scriptMode ? "script" : inputMode, audience, targetWords, format: kind, brainrot: kind === "short" && brainrot, ...(kind === "comic" ? { comicPanels } : {}), ...(groqKey.trim() ? { apiKey: groqKey } : {}) });
    if (created) { setGroqKey(""); setText(""); setFileName(""); setPdfInfo(null); setFileError(""); setInputMode("topic"); setScriptMode(false); }
  }
  if (job) return <div className="studio-content"><Production key={job.id} job={job} visible={visible} onUpdate={onUpdate} onReset={onReset} connectionError={error} onRetryConnection={onRetryConnection}/></div>;
  if (restoring && error) return <div className="studio-content"><div className="error-box" role="alert">{error}<button className="ink-button" onClick={onRetryConnection}>Retry loading this lesson</button></div><button className="text-link" onClick={onReset}>Start a new lesson</button></div>;
  if (busy) return <div className="studio-content"><div className="production-status" role="status"><LoaderCircle className="spin"/> Opening your saved lesson…</div></div>;
  return <div className="studio-content">
    <div className="studio-heading"><div><span className="eyebrow">{names[kind].toUpperCase()} / YOUR NEXT AHA</span><h1>{kind === "comic" ? <>A little ink.<br/><span>A big idea.</span></> : kind === "short" ? <>Small screen.<br/><span>Big brain energy.</span></> : <>A boring chapter.<br/><span>A better story.</span></>}</h1><p>{kind === "comic" ? "From a question or your notes to a story you can read, one thoughtful frame at a time." : "Upload your notes or describe what you want to learn. We’ll find the story, the punchlines, and the part that clicks."}</p></div>{kind === "comic" ? <Pencil className="studio-art"/> : <Book className="studio-art"/>}</div>
    <form onSubmit={submit} className="studio-form"><div className="input-column">
      <input ref={fileInput} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" className="sr-only" tabIndex={-1} aria-label={`Upload ${names[kind]} source`} onChange={e => { void loadFile(e.target.files?.[0]); e.target.value = ""; }}/>
      <button type="button" className={`drop-zone ${dragging ? "dragging" : ""}`} disabled={loadingFile} onClick={() => fileInput.current?.click()} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void loadFile(e.dataTransfer.files[0]); }}>
        {loadingFile ? <LoaderCircle className="spin" size={30}/> : fileName ? <FileText size={30}/> : <Upload size={30}/>}<strong>{loadingFile ? "Reading your notes…" : fileName || "Drop your notes right here"}</strong><span>{fileName ? "Click to swap this file" : "Textbook pages, slide PDFs, or your trusty notes"}</span><small>PDF · TXT · MD / PDF: 25 MB, 60 PAGES / 80,000 CHARACTERS</small>
      </button>
      {loadingFile && <div className="pdf-import-status" role="status"><span>{fileProgress?.message ?? "Reading your file…"}</span><button type="button" className="text-link" onClick={() => fileController.current?.abort()}>Cancel</button><div className="progress-track"><div style={{ width: `${Math.max(2, fileProgress?.progress ?? 0)}%` }}/></div></div>}
      {!loadingFile && pdfInfo && <div className="pdf-import-status" role="status"><strong>✓ {pdfInfo.pageCount} pages unpacked.</strong><p>Review the extracted source below.</p>{pdfInfo.warnings.length > 0 && <details><summary>Things to check ({pdfInfo.warnings.length})</summary><ul>{pdfInfo.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>}</div>}
      <div className="or-divider"><span>OR START WITH A LITTLE CURIOSITY</span></div>
      <div className="input-mode-switch" role="group" aria-label="Input type"><button type="button" aria-pressed={inputMode === "topic"} disabled={loadingFile} onClick={() => { setInputMode("topic"); setScriptMode(false); setFileName(""); setPdfInfo(null); }}>Write a prompt</button><button type="button" aria-pressed={inputMode === "material"} disabled={loadingFile} onClick={() => setInputMode("material")}>Paste source text</button></div>
      <label htmlFor={`${kind}-lesson-text`} className="eyebrow">{inputMode === "topic" ? "WHAT ARE WE LEARNING?" : "YOUR SOURCE TEXT"}</label>
      <textarea id={`${kind}-lesson-text`} className={inputMode === "topic" ? "topic-textarea" : "source-textarea"} required disabled={loadingFile} maxLength={80_000} value={text} onChange={e => { setText(e.target.value); setFileError(""); }} placeholder={inputMode === "topic" ? "Teach me about mitochondria at a 7th grade level. Make it feel like the world's tiniest office…" : "Paste a chapter, notes, or the source text you want us to explain…"}/>
      <div className="flex justify-between mt-2 gap-3"><span className="input-note">{inputMode === "topic" ? "We’ll write a fresh explanation from your prompt." : "We’ll build the story from this source. File uploads switch here automatically."}</span><span className="text-counter">{text.length.toLocaleString()} / 80,000</span></div>
      {inputMode === "topic" && <div className="suggestions"><span className="handwriting">or borrow a little inspiration ↴</span>{["Why is the sky blue?", "Explain supply and demand using a pizza shop."].map(topic => <button key={topic} type="button" onClick={() => setText(topic)}>{topic}<ArrowRight size={14}/></button>)}</div>}
      {kind !== "comic" && inputMode === "material" && <label className="script-checkbox"><input type="checkbox" checked={scriptMode} onChange={e => setScriptMode(e.target.checked)}/><span>I already have a narration script. Keep my words.<small>Add a visual plan in the next step.</small></span></label>}
    </div><aside className="recipe-card"><span className="eyebrow">YOUR LESSON RECIPE</span><div className="recipe-doodle"><Spark className="w-10"/><span className="handwriting">one order of “ohhh, I get it”</span></div>
      <label htmlFor={`${kind}-audience`}>Who’s {kind === "comic" ? "reading" : "watching"}?</label><select id={`${kind}-audience`} value={audience} onChange={e => setAudience(e.target.value)} disabled={scriptMode}><option>Curious beginners (all ages)</option><option>Middle school students (grades 6–8)</option><option>High school students (grades 9–12)</option><option>College students</option></select>
      {kind === "comic" ? <><label htmlFor={`${kind}-panels`}>How many panels?</label><select id={`${kind}-panels`} value={comicPanels} onChange={e => setComicPanels(Number(e.target.value) as 4 | 6 | 8)}><option value={4}>4 panels · a quick idea</option><option value={6}>6 panels · the sweet spot</option><option value={8}>8 panels · a little more story</option></select><p className="input-note">One clear idea per frame. Legible captions, added after the illustrations.</p></> : <><label htmlFor={`${kind}-length`}>How much story?</label><select id={`${kind}-length`} value={targetWords} onChange={e => setTargetWords(Number(e.target.value))} disabled={scriptMode}>{lengths.map(words => <option key={words} value={words}>{words === 75 ? "A tiny story · ~30 seconds" : `${words / 150} minute${words === 150 ? "" : "s"} · ~${words} words`}</option>)}</select><p className="input-note">{kind === "youtube" ? "YouTube · 16:9 landscape" : "Short-form · 9:16 portrait"}. Timing follows the narration.</p></>}
      {kind === "short" && <div className="gameplay-option"><label className="script-checkbox"><input type="checkbox" checked={brainrot} onChange={e => setBrainrot(e.target.checked)}/><span>Add a brainrot clip<small>Lesson + captions on top. Gameplay below.</small></span></label><div className={`format-preview ${brainrot ? "split" : ""}`}><span>YOUR LESSON + CAPTIONS</span>{brainrot && <span>RUNNER PLACEHOLDER</span>}</div><p className="input-note">{brainrot ? "A local runner animation is included. Upload your Subway Surfers MP4 in the final-cut step to replace it." : "Your visuals fill the whole screen."}</p></div>}
      <div className="recipe-style"><span className="eyebrow">THE HOUSE STYLE</span><p>Little doodles.<br/>Dry humor.<br/>Actual learning.</p><span className="style-stamp">100% LESS ZZZ</span></div>
      {!scriptMode && <ApiKeyField provider="Groq" value={groqKey} onChange={setGroqKey}/>}
      <button type="submit" className="ink-button primary" disabled={!text.trim() || loadingFile || (!scriptMode && !groqKey.trim())}>{kind === "comic" ? "Plan my comic" : "Write my story"}<ArrowRight size={19}/></button>
      <p className="privacy-note">{kind === "comic" ? "Groq plans the story. Pollinations draws the panels. Page layout and captions are made locally; no voice key needed." : "Next: Pollinations for pictures, then ElevenLabs for narration. Each panel has its own draft and saved lessons."}</p>
    </aside></form>
    {(error || fileError) && <div role="alert" className="error-box"><strong>A tiny plot twist.</strong> {fileError || error}</div>}
    <div className="studio-bottom"><span className="handwriting">No pop quiz. We promise.</span><span className="input-note">Your draft stays here until you’re ready.</span></div>
  </div>;
}
