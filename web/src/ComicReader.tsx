import { useEffect, useRef, useState } from "react";
import { Download, ZoomIn, ZoomOut } from "lucide-react";
import type { LessonJob } from "../../src/web-contract";

export function ComicReader({ job }: { job: LessonJob }) {
  const [selection, setSelection] = useState("");
  const [mode, setMode] = useState<"page" | "panels">("page");
  const [zoom, setZoom] = useState(false);
  const [error, setError] = useState(false);
  const latest = useRef(job.comicUrl);
  useEffect(() => { if (latest.current !== job.comicUrl) { latest.current = job.comicUrl; setSelection(""); setError(false); } }, [job.comicUrl]);
  const output = job.comicOutputs?.find(o => o.url === selection) ?? job.comicOutputs?.at(-1);
  const url = output?.url ?? job.comicUrl;
  if (!url) return null;
  return <section className="phase-card comic-reader" aria-label="Comic reader">
    <div className="player-heading"><div><span className="eyebrow">YOUR COMIC READER</span><h2>A page worth keeping.</h2></div><span className="small-sticker">READ LEFT TO RIGHT ↘</span></div>
    <div className="result-actions"><div className="input-mode-switch" role="group" aria-label="Reading view"><button aria-pressed={mode === "page"} onClick={() => setMode("page")}>Full page</button><button aria-pressed={mode === "panels"} disabled={!output?.panels} onClick={() => setMode("panels")}>Panel by panel</button></div>{mode === "page" && <button className="ink-button" aria-pressed={zoom} onClick={() => setZoom(value => !value)}>{zoom ? <ZoomOut size={16}/> : <ZoomIn size={16}/>} {zoom ? "Fit page" : "Zoom in"}</button>}<a className="ink-button primary" href={url} download="entertainify-comic.png"><Download size={16}/>Download comic</a></div>
    {mode === "page" ? <div className={`comic-page-viewport ${zoom ? "zoomed" : ""}`} tabIndex={0} aria-label="Comic page; scroll to read"><img src={url} alt={`${job.result?.title ?? "Your comic"}. Numbered panels read left to right, then down. Use the panel view for individual captions.`} onError={() => setError(true)} onLoad={() => setError(false)}/></div> : <div className="comic-reading-panels">{output?.panels?.map((panel, index) => <figure key={index}><span className="eyebrow">PANEL {index + 1}</span><img src={panel.imageUrl} alt={panel.caption} loading="lazy"/><figcaption>{panel.caption}</figcaption></figure>)}</div>}
    {error && <p role="alert" className="error-box">The comic could not load. Refresh this lesson or use the download above.</p>}
    {(job.comicOutputs?.length ?? 0) > 1 && <label className="comic-version">Saved editions<select value={output?.url ?? ""} onChange={e => { setSelection(e.target.value); setError(false); }}>{job.comicOutputs?.map((version, i) => <option value={version.url} key={version.url}>Edition {i + 1} · {new Date(version.createdAt).toLocaleString()}</option>)}</select></label>}
  </section>;
}
