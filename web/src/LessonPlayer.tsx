import { useEffect, useRef, useState } from "react";
import { Download, LoaderCircle, Play } from "lucide-react";
import type { LessonJob, SavedOutput } from "../../src/web-contract";

/** One stable destination for rendering progress, playback and version selection. */
export function LessonPlayer({ job, visible, starting }: { job: LessonJob; visible: boolean; starting: "audio" | "video" | null }) {
  const region = useRef<HTMLElement>(null);
  const media = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [selection, setSelection] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [playRequest, setPlayRequest] = useState(0);
  const active = Boolean(starting) || job.status === "voice" || job.status === "rendering";
  const audioOnly = (starting ?? job.operation) === "audio";
  const outputs = job.outputs ?? [];
  const latest = outputs.at(-1);
  const fallback: SavedOutput | undefined = job.videoUrl ? { videoUrl: job.videoUrl, audioUrl: job.audioUrl ?? "", timelineUrl: job.timelineUrl, createdAt: job.createdAt, label: "Saved video" } : job.status === "audio-ready" && job.audioUrl ? { audioUrl: job.audioUrl, createdAt: job.createdAt, label: "Saved voiceover" } : undefined;
  const selected = outputs.find(output => output.audioUrl === selection) ?? latest ?? fallback;
  const videoUrl = selected?.videoUrl;
  const source = videoUrl ?? selected?.audioUrl;
  const previousLatest = useRef(latest?.audioUrl ?? job.videoUrl);
  const previouslyActive = useRef(active);
  const scroll = () => {
    region.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    region.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const newest = latest?.audioUrl ?? job.videoUrl;
    if (newest !== previousLatest.current) {
      previousLatest.current = newest; setSelection("");
      if (visible && !active) scroll();
    }
  }, [latest?.audioUrl, job.videoUrl, visible, active]);
  useEffect(() => { setReady(false); setError(""); }, [source, active, retry]);
  useEffect(() => {
    if (active && !previouslyActive.current && visible) scroll();
    previouslyActive.current = active;
  }, [active, visible]);
  useEffect(() => { if (!visible || active) media.current?.pause(); }, [visible, active]);
  useEffect(() => {
    if (!visible || !playRequest || !source || active) return;
    scroll();
    // Browsers may require another click after an asynchronous media load.
    void media.current?.play().catch(() => {});
    setPlayRequest(0);
  }, [playRequest, source, active, visible]);
  if (!active && !source) return null;
  return <section ref={region} tabIndex={-1} className="premiere phase-card" aria-label="Lesson player" aria-busy={active}>
    <div className="player-heading"><div><span className="eyebrow">YOUR LESSON PLAYER</span><h2>{active ? audioOnly ? "Recording your voiceover…" : "Your video is on its way…" : videoUrl ? "Your video is ready. Press play." : "Your voiceover is ready."}</h2></div>{!active && videoUrl && <span className="small-sticker">VIDEO READY</span>}</div>
    {active ? <div className="player-loading" role="status"><LoaderCircle size={36} className="spin"/><strong>{job.status === "rendering" ? "Rendering the final MP4…" : "Preparing narration…"}</strong><p>{audioOnly ? "Your voiceover will appear here when it is finished." : "Your video will appear right here when both narration and rendering are finished."}</p><p className="input-note">You can work on another lesson. This one stays in My lessons.</p></div> : <>
      {videoUrl && job.status !== "complete" && <p className="input-note">Previously saved video. Changes to this lesson appear after you create a new MP4.</p>}
      <div className={videoUrl ? "video-wrap" : "audio-wrap"}>
        {!ready && !error && <p className="media-loading" role="status"><LoaderCircle size={18} className="spin"/>Loading {videoUrl ? "video" : "voiceover"}…</p>}
        {videoUrl ? <video ref={element => { media.current = element; }} key={`${source}-${retry}`} src={source} controls playsInline preload="auto" aria-label={job.result?.title ?? "Lesson video"} onCanPlay={() => setReady(true)} onError={() => setError("The video could not load. Try again or download the saved MP4.")}/> : <audio ref={element => { media.current = element; }} key={`${source}-${retry}`} src={source} controls preload="auto" aria-label="Saved voiceover" onCanPlay={() => setReady(true)} onError={() => setError("The voiceover could not load. Try again or download the saved audio.")}/>}
      </div>
      {error && <div role="alert" className="error-box">{error}<button className="text-link" onClick={() => setRetry(value => value + 1)}>Reload player</button></div>}
      <div className="result-actions">{videoUrl && <a className="ink-button primary" href={videoUrl} download="entertainify.mp4"><Download size={17}/>Download MP4</a>}{selected?.audioUrl && <a className="text-link" href={selected.audioUrl} download="narration.mp3">Download voiceover</a>}{videoUrl && <a className="text-link" href={selected?.timelineUrl ?? videoUrl.replace(/video\.mp4$/, "timeline.json")} download="timeline.json">Cut timings</a>}</div>
    </>}
    {outputs.length > 0 && <details className="saved-versions"><summary>Saved versions ({outputs.length})</summary><div className="saved-outputs">{[...outputs].reverse().map(output => <div key={output.audioUrl}><span>{new Date(output.createdAt).toLocaleString()} · {output.videoUrl ? "Video" : "Audio"} · {output.label}</span><button className="text-link" disabled={active} onClick={() => { setSelection(output.audioUrl); setPlayRequest(value => value + 1); }}><Play size={14}/>{output.videoUrl ? "Watch" : "Listen"}</button><a href={output.videoUrl ?? output.audioUrl} download={output.videoUrl ? "video.mp4" : "narration.mp3"}>Download {output.videoUrl ? "MP4" : "MP3"}</a></div>)}</div></details>}
  </section>;
}
