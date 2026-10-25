import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, FileText, LoaderCircle, Upload } from "lucide-react";
import type { LessonJob, LessonRequest, PdfProgress, PdfSource } from "../../src/web-contract";
import { Book, Pencil, Pixel, Spark } from "./Art";
import { readLessonFile } from "./files";
import { api } from "./api";
import { ApiKeyField, Production } from "./Production";

const suggestions = [
  { label: "Tiny cell, big energy", text: "Teach me about mitochondria at a 7th grade level.", icon: "✳" },
  { label: "Why is the sky blue?", text: "Explain why the sky is blue for someone who has never studied physics.", icon: "☁" },
  { label: "Supply, demand & pizza", text: "Explain supply and demand using a pizza shop as an example.", icon: "△" },
];

interface StudioProps {
  kind: "upload" | "scratch";
  job: LessonJob | null;
  busy: boolean;
  restoring: boolean;
  error: string;
  visible: boolean;
  onGenerate: (request: LessonRequest) => Promise<LessonJob | undefined>;
  onReset: () => void;
  onRetryConnection: () => void;
  onUpdate: (job: LessonJob) => void;
}

export function Studio({ kind, job, busy, restoring, error, visible, onGenerate, onReset, onRetryConnection, onUpdate }: StudioProps) {
  const storageKey = `entertainify-draft-v2-${kind}`;
  const [draft] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? "null") ?? { text: sessionStorage.getItem(`entertainify-draft-${kind}`) ?? "" }; } catch { return {}; }
  });
  const [text, setText] = useState<string>(typeof draft.text === "string" ? draft.text : "");
  const [audience, setAudience] = useState<string>(draft.audience ?? "Middle school students (grades 6–8)");
  const [targetWords, setTargetWords] = useState<number>([75, 150, 300, 600, 900].includes(draft.targetWords) ? draft.targetWords : 300);
  const [fileName, setFileName] = useState<string>(draft.fileName ?? "");
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [scriptMode, setScriptMode] = useState(draft.scriptMode === true);
  const [groqKey, setGroqKey] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileProgress, setFileProgress] = useState<PdfProgress | null>(null);
  const [pdfInfo, setPdfInfo] = useState<Omit<PdfSource, "text"> | null>(draft.pdfInfo ?? null);
  const fileController = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileVersion = useRef(0);
  useEffect(() => () => { fileVersion.current++; fileController.current?.abort(); }, []);
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify({ text, audience, targetWords, fileName, scriptMode, pdfInfo })); } catch { /* A blocked browser store should not prevent generation. */ } }, [storageKey, text, audience, targetWords, fileName, scriptMode, pdfInfo]);
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  async function loadFile(file?: File) {
    if (!file) return;
    const version = ++fileVersion.current;
    fileController.current?.abort();
    const controller = new AbortController();
    fileController.current = controller;
    setFileError("");
    setPdfInfo(null);
    setFileProgress(null);
    setLoadingFile(true);
    try {
      const content = await readLessonFile(file, async () => {
        setFileProgress({ page: 0, totalPages: 0, progress: 0, message: "Uploading your PDF…" });
        const result = await api.importPdf(file, (progress) => { if (version === fileVersion.current) setFileProgress(progress); }, controller.signal);
        if (version === fileVersion.current) setPdfInfo({ pageCount: result.pageCount, ocrPages: result.ocrPages, warnings: result.warnings });
        return result.text;
      });
      if (version !== fileVersion.current) return;
      setText(content); setFileName(file.name);
    } catch (e) { if (version === fileVersion.current && !controller.signal.aborted) setFileError(e instanceof Error ? e.message : "Couldn't read that file. Please try again."); }
    finally { if (version === fileVersion.current) setLoadingFile(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || loadingFile) return;
    const created = await onGenerate({ text, mode: kind === "scratch" ? "topic" : scriptMode ? "script" : "material", audience, targetWords, ...(groqKey.trim() ? { apiKey: groqKey } : {}) });
    setGroqKey("");
    if (created) { setText(""); setFileName(""); setPdfInfo(null); setFileError(""); }
  }

  if (job) return <div className="studio-content"><Production key={job.id} job={job} visible={visible} onUpdate={onUpdate} onReset={onReset} connectionError={error} onRetryConnection={onRetryConnection}/></div>;
  if (restoring && error) return <div className="studio-content"><div className="error-box" role="alert">{error}<button className="ink-button" onClick={onRetryConnection}>Retry loading this lesson</button></div><button className="text-link" onClick={onReset}>Start a new lesson</button></div>;
  if (busy) return <div className="studio-content"><div className="production-status" role="status"><LoaderCircle className="spin"/> Opening your saved lesson…</div></div>;

  return <div className="studio-content">
    <div className="studio-heading"><div><span className="eyebrow">{kind === "upload" ? "ISSUE 01 / THE REMIX" : "ISSUE 02 / THE BLANK PAGE"}</span><h1>{kind === "upload" ? <>A boring chapter.<br/><span>A better story.</span></> : <>Big ideas start<br/><span>with a little scribble.</span></>}</h1><p>{kind === "upload" ? "Hand over the notes. We’ll find the plot, the punchlines, and the part that finally clicks." : "What’s living rent-free in your head? Give us a topic. We’ll make it make sense."}</p></div>{kind === "upload" ? <Book className="studio-art"/> : <Pencil className="studio-art"/>}</div>
    <form onSubmit={submit} className="studio-form">
      <div className="input-column">
        {kind === "upload" && <>
          <input ref={fileInput} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" className="sr-only" tabIndex={-1} aria-label="Upload lesson text or PDF" onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" className={`drop-zone ${dragging ? "dragging" : ""}`} disabled={loadingFile} onClick={() => fileInput.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); void loadFile(e.dataTransfer.files[0]); }}>
            {loadingFile ? <LoaderCircle className="spin" size={30}/> : fileName ? <FileText size={30}/> : <Upload size={30}/>}<strong>{loadingFile ? "Reading your notes…" : fileName || "Drop your notes right here"}</strong><span>{loadingFile ? "Finding the good stuff, one page at a time" : fileName ? "Click to swap this file" : "textbook pages, slide PDFs, or your trusty notes"}</span><small>PDF · TXT · MD / PDF: 25 MB, 60 PAGES / 80,000 CHARACTERS</small>
          </button>
          {loadingFile && fileProgress && <div className="pdf-import-status"><div className="flex justify-between gap-3"><span role="status" aria-live="polite">{fileProgress.message}</span><button type="button" className="text-link" onClick={() => fileController.current?.abort()}>Cancel</button></div><div className="progress-track" role="progressbar" aria-label="Reading PDF" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fileProgress.progress}><div style={{ width: `${Math.max(2, fileProgress.progress)}%` }}/></div><p className="input-note">Scanned pages take a little longer. You can close this panel while we read; your import will keep going.</p></div>}
          {!loadingFile && pdfInfo && <div className="pdf-import-status" role="status"><strong>✓ {pdfInfo.pageCount} {pdfInfo.pageCount === 1 ? "page" : "pages"} unpacked{pdfInfo.ocrPages.length ? ` · ${pdfInfo.ocrPages.length} read with OCR` : ""}.</strong><p>Review and edit the source text below, then make your lesson.</p>{pdfInfo.warnings.length > 0 && <details><summary>A few things to check ({pdfInfo.warnings.length})</summary><ul>{pdfInfo.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}</div>}
          <div className="or-divider"><span>OR PASTE THE GOOD STUFF</span></div>
        </>}
        <div className="flex justify-between gap-3 mb-2"><label htmlFor={`${kind}-lesson-text`} className="eyebrow">{kind === "scratch" ? "WHAT ARE WE LEARNING?" : "YOUR SOURCE TEXT"}</label><span className="text-counter">{wordCount.toLocaleString()} words</span></div>
        <textarea id={`${kind}-lesson-text`} className={kind === "scratch" ? "topic-textarea" : "source-textarea"} required disabled={loadingFile} maxLength={80_000} value={text} onChange={(e) => { setText(e.target.value); setFileName(""); setFileError(""); }} placeholder={kind === "scratch" ? "Teach me about mitochondria at a 7th grade level. Make it feel like the world's tiniest office…" : "Chapter 4: The incredibly important thing you almost fell asleep reading…"} />
        <div className="flex justify-between items-center mt-2 gap-3"><span className="input-note">{kind === "scratch" ? "A topic, a question, a wildly specific curiosity." : "A short chapter or a few pages works best."}</span><span className="text-counter">{text.length.toLocaleString()} / 80,000</span></div>
        {kind === "scratch" ? <div className="suggestions"><span className="handwriting">or borrow a little inspiration ↴</span>{suggestions.map((s) => <button type="button" key={s.label} onClick={() => setText(s.text)}><span>{s.icon}</span>{s.label}<ArrowRight size={14}/></button>)}</div> : <label className="script-checkbox"><input type="checkbox" checked={scriptMode} onChange={(e) => setScriptMode(e.target.checked)}/><span>I already have a narration script. Keep my words.<small>Keeps your words as text cards. Add a visual plan in the next step.</small></span></label>}
      </div>
      <aside className="recipe-card"><span className="eyebrow">YOUR LESSON RECIPE</span><div className="recipe-doodle"><Spark className="w-10"/><span className="handwriting">one order of “ohhh, I get it”</span></div><label htmlFor={`${kind}-audience`}>Who’s watching?</label><select id={`${kind}-audience`} value={audience} onChange={(e) => setAudience(e.target.value)} disabled={scriptMode && kind === "upload"}><option>Curious beginners (all ages)</option><option>Middle school students (grades 6–8)</option><option>High school students (grades 9–12)</option><option>College students</option></select><label htmlFor={`${kind}-length`}>How much story?</label><select id={`${kind}-length`} value={targetWords} onChange={(e) => setTargetWords(Number(e.target.value))} disabled={scriptMode && kind === "upload"}><option value={75}>A tiny story · ~30 seconds</option><option value={150}>A quick bite · ~1 minute</option><option value={300}>The sweet spot · ~2 minutes</option><option value={600}>A deeper dive · ~4 minutes</option><option value={900}>The full story · ~6 minutes</option></select><p className="input-note">Approximate time at 150 words/minute.</p><div className="recipe-style"><span className="eyebrow">THE HOUSE STYLE</span><p>Little doodles.<br/>Dry humor.<br/>Actual learning.</p><span className="style-stamp">100% LESS ZZZ</span></div>{!(scriptMode && kind === "upload") && <><span className="eyebrow">STEP 01 / WRITE THE STORY</span><ApiKeyField provider="Groq" value={groqKey} onChange={setGroqKey}/></>}<button type="submit" className="ink-button primary" disabled={!text.trim() || busy || loadingFile || (!(scriptMode && kind === "upload") && !groqKey.trim())}>{scriptMode && kind === "upload" ? "Make my scene plan" : "Entertain my brain"}<ArrowRight size={19}/></button><p className="privacy-note">{scriptMode && kind === "upload" ? "Your words become text cards locally. Groq can plan illustrations next." : "Groq writes the script and scene prompts in one request. Then add Pollinations for pictures and ElevenLabs for voice + video. For the free tier, start with a quick bite and a short source."}</p></aside>
    </form>
    {(error || fileError) && <div role="alert" className="error-box"><strong>A tiny plot twist.</strong> {fileError || error}</div>}

    <div className="studio-bottom"><span className="handwriting">No pop quiz. We promise.</span><span className="input-note">Your draft stays here until you’re ready.</span></div>
  </div>;
}

export function Mystery() {
  const [knocks, setKnocks] = useState(0);
  return <div className="mystery-content"><div className="mystery-stars">✦ <span>✧</span> ✦</div><span className="eyebrow">TOP SECRET / ISSUE 03</span><button className={`ghost-door ${knocks % 2 ? "knocked" : ""}`} onClick={() => setKnocks((n) => n + 1)} aria-label="Knock on the mystery door"><Pixel kind="ghost"/></button><h1>Something weird.<br/><span>Something wonderful.</span></h1><p>There’s a new way to learn hiding behind this door.<br/>Our little ghost isn’t ready to spill the beans.</p><div className="mystery-message" aria-live="polite">{["COMING SOON-ISH", "knock knock. …nobody's home. probably.", "okay, somebody's definitely in there.", "the ghost requests more development time.", "you have unlocked: absolutely nothing. impressive."][Math.min(knocks, 4)]}</div><span className="handwriting">curiosity looks good on you.</span></div>;
}
