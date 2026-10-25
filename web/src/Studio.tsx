import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Download, FileText, LoaderCircle, Pause, Play, RotateCcw, Sparkles, Upload } from "lucide-react";
import { motion } from "motion/react";
import type { LessonJob, LessonRequest, ServerHealth, PdfProgress, PdfSource } from "../../src/web-contract";
import { Book, Brain, Pencil, Pixel, Spark } from "./Art";
import { readLessonFile } from "./files";
import { api } from "./api";
import { ApiKeyField, Production } from "./Production";

const suggestions = [
  { label: "Tiny cell, big energy", text: "Teach me about mitochondria at a 7th grade level.", icon: "✳" },
  { label: "Why is the sky blue?", text: "Explain why the sky is blue for someone who has never studied physics.", icon: "☁" },
  { label: "Supply, demand & pizza", text: "Explain supply and demand using a pizza shop as an example.", icon: "△" },
];
const terminal = (job: LessonJob) => ["complete", "script-ready", "failed"].includes(job.status);

interface StudioProps {
  kind: "upload" | "scratch";
  job: LessonJob | null;
  busy: boolean;
  error: string;
  health: ServerHealth | null;
  onGenerate: (request: LessonRequest) => void;
  onDemo: () => void;
  onReset: () => void;
  onRetryConnection: () => void;
  onUpdate: (job: LessonJob) => void;
}

export function Studio({ kind, job, busy, error, health, onGenerate, onDemo, onReset, onRetryConnection, onUpdate }: StudioProps) {
  const storageKey = `entertainify-draft-${kind}`;
  const [text, setText] = useState(() => { try { return sessionStorage.getItem(storageKey) ?? ""; } catch { return ""; } });
  const [audience, setAudience] = useState("Middle school students (grades 6–8)");
  const [targetWords, setTargetWords] = useState(300);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [scriptMode, setScriptMode] = useState(false);
  const [groqKey, setGroqKey] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileProgress, setFileProgress] = useState<PdfProgress | null>(null);
  const [pdfInfo, setPdfInfo] = useState<Omit<PdfSource, "text"> | null>(null);
  const fileController = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileVersion = useRef(0);
  useEffect(() => () => { fileVersion.current++; fileController.current?.abort(); }, []);
  useEffect(() => { try { sessionStorage.setItem(storageKey, text); } catch { /* A blocked browser store should not prevent generation. */ } }, [storageKey, text]);
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
        if (version === fileVersion.current) setPdfInfo(result);
        return result.text;
      });
      if (version !== fileVersion.current) return;
      setText(content); setFileName(file.name);
    } catch (e) { if (version === fileVersion.current && !controller.signal.aborted) setFileError(e instanceof Error ? e.message : "Couldn't read that file. Please try again."); }
    finally { if (version === fileVersion.current) setLoadingFile(false); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || loadingFile) return;
    onGenerate({ text, mode: kind === "scratch" ? "topic" : scriptMode ? "script" : "material", audience, targetWords, ...(groqKey.trim() ? { apiKey: groqKey } : {}) });
    setGroqKey("");
  }

  if (job && !job.demo) return <div className="studio-content"><Production key={job.id} job={job} onUpdate={onUpdate} onReset={onReset} connectionError={error} onRetryConnection={onRetryConnection}/></div>;
  if (job || busy) return <div className="studio-content"><LessonOutput job={job} busy={busy} error={error} onReset={onReset} onRetryConnection={onRetryConnection} /></div>;

  return <div className="studio-content">
    <div className="studio-heading"><div><span className="eyebrow">{kind === "upload" ? "ISSUE 01 / THE REMIX" : "ISSUE 02 / THE BLANK PAGE"}</span><h1>{kind === "upload" ? <>A boring chapter.<br/><span>A better story.</span></> : <>Big ideas start<br/><span>with a little scribble.</span></>}</h1><p>{kind === "upload" ? "Hand over the notes. We’ll find the plot, the punchlines, and the part that finally clicks." : "What’s living rent-free in your head? Give us a topic. We’ll make it make sense."}</p></div>{kind === "upload" ? <Book className="studio-art"/> : <Pencil className="studio-art"/>}</div>
    <form onSubmit={submit} className="studio-form">
      <div className="input-column">
        {kind === "upload" && <>
          <input ref={fileInput} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" className="sr-only" tabIndex={-1} aria-label="Upload lesson text or PDF" onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" className={`drop-zone ${dragging ? "dragging" : ""}`} disabled={loadingFile} onClick={() => fileInput.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); void loadFile(e.dataTransfer.files[0]); }}>
            {loadingFile ? <LoaderCircle className="spin" size={30}/> : fileName ? <FileText size={30}/> : <Upload size={30}/>}<strong>{loadingFile ? "Reading your notes…" : fileName || "Drop your notes right here"}</strong><span>{loadingFile ? "Finding the good stuff, one page at a time" : fileName ? "Click to swap this file" : "textbook pages, slide PDFs, or your trusty notes"}</span><small>PDF · TXT · MD / PDF: 25 MB, 60 PAGES / 80,000 CHARACTERS</small>
          </button>
          {loadingFile && fileProgress && <div className="pdf-import-status"><div className="flex justify-between gap-3"><span role="status" aria-live="polite">{fileProgress.message}</span><button type="button" className="text-link" onClick={() => fileController.current?.abort()}>Cancel</button></div><div className="progress-track" role="progressbar" aria-label="Reading PDF" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fileProgress.progress}><div style={{ width: `${Math.max(2, fileProgress.progress)}%` }}/></div><p className="input-note">Scanned pages take a little longer. Keep this panel open while we read.</p></div>}
          {!loadingFile && pdfInfo && <div className="pdf-import-status" role="status"><strong>✓ {pdfInfo.pageCount} {pdfInfo.pageCount === 1 ? "page" : "pages"} unpacked{pdfInfo.ocrPages.length ? ` · ${pdfInfo.ocrPages.length} read with OCR` : ""}.</strong><p>Review and edit the source text below, then make your lesson.</p>{pdfInfo.warnings.length > 0 && <details><summary>A few things to check ({pdfInfo.warnings.length})</summary><ul>{pdfInfo.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}</div>}
          <div className="or-divider"><span>OR PASTE THE GOOD STUFF</span></div>
        </>}
        <div className="flex justify-between gap-3 mb-2"><label htmlFor="lesson-text" className="eyebrow">{kind === "scratch" ? "WHAT ARE WE LEARNING?" : "YOUR SOURCE TEXT"}</label><span className="text-counter">{wordCount.toLocaleString()} words</span></div>
        <textarea id="lesson-text" className={kind === "scratch" ? "topic-textarea" : "source-textarea"} required disabled={loadingFile} maxLength={80_000} value={text} onChange={(e) => { setText(e.target.value); setFileName(""); setFileError(""); }} placeholder={kind === "scratch" ? "Teach me about mitochondria at a 7th grade level. Make it feel like the world's tiniest office…" : "Chapter 4: The incredibly important thing you almost fell asleep reading…"} />
        <div className="flex justify-between items-center mt-2 gap-3"><span className="input-note">{kind === "scratch" ? "A topic, a question, a wildly specific curiosity." : "A short chapter or a few pages works best."}</span><span className="text-counter">{text.length.toLocaleString()} / 80,000</span></div>
        {kind === "scratch" ? <div className="suggestions"><span className="handwriting">or borrow a little inspiration ↴</span>{suggestions.map((s) => <button type="button" key={s.label} onClick={() => setText(s.text)}><span>{s.icon}</span>{s.label}<ArrowRight size={14}/></button>)}</div> : <label className="script-checkbox"><input type="checkbox" checked={scriptMode} onChange={(e) => setScriptMode(e.target.checked)}/><span>I already have a narration script. Keep my words.<small>Keeps your words as text cards. Add a visual plan in the next step.</small></span></label>}
      </div>
      <aside className="recipe-card"><span className="eyebrow">YOUR LESSON RECIPE</span><div className="recipe-doodle"><Spark className="w-10"/><span className="handwriting">one order of “ohhh, I get it”</span></div><label htmlFor="audience">Who’s watching?</label><select id="audience" value={audience} onChange={(e) => setAudience(e.target.value)} disabled={scriptMode && kind === "upload"}><option>Curious beginners (all ages)</option><option>Middle school students (grades 6–8)</option><option>High school students (grades 9–12)</option><option>College students</option></select><label htmlFor="length">How much story?</label><select id="length" value={targetWords} onChange={(e) => setTargetWords(Number(e.target.value))} disabled={scriptMode && kind === "upload"}><option value={150}>A quick bite · ~1 minute</option><option value={300}>The sweet spot · ~2 minutes</option><option value={600}>A deeper dive · ~4 minutes</option><option value={900}>The full story · ~6 minutes</option></select><p className="input-note">Approximate time at 150 words/minute.</p><div className="recipe-style"><span className="eyebrow">THE HOUSE STYLE</span><p>Little doodles.<br/>Dry humor.<br/>Actual learning.</p><span className="style-stamp">100% LESS ZZZ</span></div>{!(scriptMode && kind === "upload") && <><span className="eyebrow">STEP 01 / WRITE THE STORY</span><ApiKeyField provider="Groq" value={groqKey} onChange={setGroqKey}/></>}<button type="submit" className="ink-button primary" disabled={!text.trim() || busy || loadingFile || (!(scriptMode && kind === "upload") && !groqKey.trim())}>{scriptMode && kind === "upload" ? "Make my scene plan" : "Entertain my brain"}<ArrowRight size={19}/></button><p className="privacy-note">{scriptMode && kind === "upload" ? "Your words become text cards locally. Groq can plan illustrations next." : "Groq writes the script and scene prompts in one request. Then add Pollinations for pictures and ElevenLabs for voice + video. For the free tier, start with a quick bite and a short source."}</p></aside>
    </form>
    {(error || fileError) && <div role="alert" className="error-box"><strong>A tiny plot twist.</strong> {fileError || error}</div>}

    <div className="studio-bottom"><span className="handwriting">No pop quiz. We promise.</span><button type="button" className="text-link" onClick={onDemo}>Just looking? Try a sample <ArrowRight size={15}/></button></div>
  </div>;
}

function Storyboard({ job }: { job: LessonJob }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const chunks = job.result!.chunks;
  const chunk = chunks[index];
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      if (index >= chunks.length - 1) { setPlaying(false); return; }
      setIndex((i) => i + 1);
    }, Math.max(900, (chunk?.estimatedDurationSeconds ?? 2) * 1000));
    return () => clearTimeout(timer);
  }, [playing, index, chunks.length, chunk]);
  return <div className="storyboard">
    <div className="storyboard-top"><span className="eyebrow">{job.demo ? "SAMPLE STORYBOARD" : "STORYBOARD PREVIEW"}</span><span className="scene-counter">{index + 1} / {chunks.length}</span></div>
    <div className="scene-canvas"><div className="scene-orbit"/><Brain className="scene-brain"/><motion.div key={index} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="scene-caption">{chunk?.text}</motion.div><span className="scene-note handwriting">{chunk?.renderHint === "image" ? `picture this: ${chunk.visualFocus}` : "let the words do the talking"}</span></div>
    <div className="storyboard-controls"><button className="icon-button" aria-label="Previous scene" disabled={index === 0} onClick={() => { setIndex((i) => i - 1); setPlaying(false); }}><ChevronLeft size={21}/></button><button className="play-button" aria-label={playing ? "Pause storyboard" : "Play storyboard"} onClick={() => { if (index === chunks.length - 1) setIndex(0); setPlaying((v) => !v); }}>{playing ? <Pause size={18}/> : <Play size={18}/>}</button><button className="icon-button" aria-label="Next scene" disabled={index === chunks.length - 1} onClick={() => { setIndex((i) => i + 1); setPlaying(false); }}><ChevronRight size={21}/></button><input aria-label="Storyboard scene" type="range" min={0} max={chunks.length - 1} value={index} onChange={(e) => { setIndex(Number(e.target.value)); setPlaying(false); }}/><span className="text-counter">NO AUDIO</span></div>
  </div>;
}

function LessonOutput({ job, busy, error, onReset, onRetryConnection }: { job: LessonJob | null; busy: boolean; error: string; onReset: () => void; onRetryConnection: () => void }) {
  const [tab, setTab] = useState<"script" | "scenes">("script");
  const [videoError, setVideoError] = useState(false);
  const running = busy || (job && !terminal(job));
  const result = job?.result;
  const steps = ["Your starting point", "Script & scene plan", "Illustrations & voice", "The big premiere"];
  function download() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "entertainify-lesson.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <>
    <div className="result-heading"><span className="eyebrow">{job?.demo ? "A LITTLE TASTE OF ENTERTAINIFY" : "THE DOODLE STUDIO"}</span><h1>{running ? <>Goodbye, boring.<br/><span>Hello, story.</span></> : job?.status === "complete" ? <>That’s a wrap.<br/><span>Press play.</span></> : result ? <>Aha! Your story<br/><span>starts here.</span></> : <>Well, that’s<br/><span>a plot twist.</span></>}</h1><p role="status" aria-live="polite">{job?.message ?? "Opening the studio…"}</p></div>
    {running && <div className="production-card"><div className="studio-cat"><div className="rainbow-trail"/><Pixel/></div><div className="flex justify-between gap-4"><strong>{job?.status === "rendering" ? "Your lesson is becoming a movie" : "Turning facts into a story"}</strong><span className="text-counter">{job?.progress ?? 0}%</span></div><div className="progress-track" role="progressbar" aria-label="Lesson production" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job?.progress ?? 0}><div style={{ width: `${job?.progress ?? 2}%` }}/></div><div className="production-steps">{steps.map((step, i) => <span className={(job?.progress ?? 0) >= [10, 45, 80, 100][i] ? "done" : ""} key={step}><span>{(job?.progress ?? 0) >= [10, 45, 80, 100][i] ? <Check size={13}/> : i + 1}</span>{step}</span>)}</div><p className="input-note">{job?.status === "rendering" ? "Progress is reported by the video renderer." : "AI writing can take a minute. The bar advances as each stage finishes."} You can return to the comic while we work.</p></div>}
    {(error || job?.error) && <div role="alert" className="error-box"><strong>{job?.status === "failed" ? "The studio hit a snag. " : "Connection interrupted. "}</strong>{error || job?.error}{error && <button className="text-link mt-2" onClick={onRetryConnection}>Check again <RotateCcw size={14}/></button>}</div>}
    {result && <>
      <div className="result-title-row"><h2>{result.title}</h2><span className="small-sticker">{job?.demo ? "SAMPLE LESSON" : "FRESHLY MADE"}</span></div>
      <div className="result-layout"><div>{job.videoUrl ? <div className="video-wrap"><video controls preload="metadata" src={job.videoUrl} onError={() => setVideoError(true)} aria-label={result.title}/>{videoError && <div role="alert" className="error-box">This video could not load. Check that the renderer’s video URL is reachable and has not expired.</div>}</div> : <Storyboard key={job.id} job={job}/>}
        {!job.videoUrl && <p className="preview-disclosure">{job.demo ? "This is a prewritten sample with real scene splitting. The preview is silent and uses placeholder doodles." : "This silent storyboard uses placeholder doodles. Your finished video will appear here when the video renderer completes."}</p>}
        <div className="result-stats"><span><strong>{result.metadata.wordCount}</strong> words</span><span><strong>{result.metadata.chunkCount}</strong> scenes</span><span><strong>~{Math.max(1, Math.round(result.metadata.estimatedDurationSeconds / 60))}</strong> min</span></div>
      </div><div className="script-panel"><div role="tablist" aria-label="Lesson details"><button id="script-tab" role="tab" aria-controls="lesson-detail" aria-selected={tab === "script"} onClick={() => setTab("script")}>The script</button><button id="scenes-tab" role="tab" aria-controls="lesson-detail" aria-selected={tab === "scenes"} onClick={() => setTab("scenes")}>Scene plan <span>{result.chunks.length}</span></button></div><div id="lesson-detail" role="tabpanel" aria-labelledby={`${tab}-tab`} tabIndex={0} className="script-scroll">{tab === "script" ? <p>{result.script}</p> : result.chunks.map((chunk) => <div className="scene-row" key={chunk.index}><span className="scene-number">{String(chunk.index + 1).padStart(2, "0")}</span><div><p>{chunk.text}</p><small>{chunk.renderHint === "image" ? `Illustration · ${chunk.visualFocus}` : "On-screen text"} · ~{chunk.estimatedDurationSeconds.toFixed(1)}s</small></div></div>)}</div></div></div>
      <div className="result-actions"><button className="ink-button primary" onClick={download}><Download size={17}/>Download lesson JSON</button>{job.videoUrl && <a className="ink-button" href={job.videoUrl} target="_blank" rel="noreferrer">Open video <ArrowRight size={16}/></a>}<button className="text-link" disabled={Boolean(running)} onClick={onReset}>Make another <Sparkles size={16}/></button></div>
    </>}
    {!running && !result && <button className="ink-button mt-6" onClick={onReset}><ChevronLeft size={16}/>Back to my draft</button>}
    {job?.status === "script-ready" && !job.demo && <div className="handoff-note"><FileText size={20}/><p><strong>Your words are ready for their close-up.</strong> Video rendering isn’t connected yet. Download the scene plan now; once the renderer is connected, new lessons will go all the way to the big screen.</p></div>}
  </>;
}

export function Mystery() {
  const [knocks, setKnocks] = useState(0);
  return <div className="mystery-content"><div className="mystery-stars">✦ <span>✧</span> ✦</div><span className="eyebrow">TOP SECRET / ISSUE 03</span><button className={`ghost-door ${knocks % 2 ? "knocked" : ""}`} onClick={() => setKnocks((n) => n + 1)} aria-label="Knock on the mystery door"><Pixel kind="ghost"/></button><h1>Something weird.<br/><span>Something wonderful.</span></h1><p>There’s a new way to learn hiding behind this door.<br/>Our little ghost isn’t ready to spill the beans.</p><div className="mystery-message" aria-live="polite">{["COMING SOON-ISH", "knock knock. …nobody's home. probably.", "okay, somebody's definitely in there.", "the ghost requests more development time.", "you have unlocked: absolutely nothing. impressive."][Math.min(knocks, 4)]}</div><span className="handwriting">curiosity looks good on you.</span></div>;
}
