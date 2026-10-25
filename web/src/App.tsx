import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowDownLeft, ArrowRight, ArrowUpRight, ChevronLeft, Film, FolderOpen, Pause, Play, Sparkles, Upload, Volume2, VolumeX, X } from "lucide-react";
import type { LessonJob, LessonRequest, ServerHealth } from "../../src/web-contract";
import { api, ApiError } from "./api";
import { Book, Brain, DoodlePad, Pencil, Pixel, Spark, SpriteFlights } from "./Art";
import { Mystery, Studio } from "./Studio";

type Panel = "upload" | "scratch" | "mystery" | "library";
type RecentLesson = Pick<LessonJob, "id" | "createdAt" | "demo"> & { title: string; status: string };
const panelColors = { upload: "#c8d8ee", scratch: "#d0dfb9", mystery: "#302743", library: "#f3c9ce" };
const facts = [
  ["Your brain is not a USB drive.", "Understanding beats downloading. Make the idea make sense."],
  ["Mitochondria need a union.", "All that energy production. Not a single vacation day."],
  ["Confused? Good starting point.", "Every “aha!” begins with a small “huh?”"],
  ["A textbook walks into a bar…", "Nobody notices. We’re working on its delivery."],
];
const finished = (job: LessonJob) => ["complete", "script-ready", "failed"].includes(job.status);

function readRecent(): RecentLesson[] {
  try { const data: unknown = JSON.parse(localStorage.getItem("entertainify-recent") ?? "[]"); return Array.isArray(data) ? data.filter((x) => x && typeof x.id === "string" && typeof x.title === "string" && typeof x.createdAt === "string").slice(0, 8) : []; } catch { return []; }
}

export default function App() {
  const [active, setActive] = useState<Panel | null>(null);
  const [job, setJob] = useState<LessonJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [health, setHealth] = useState<ServerHealth | null>(null);
  const [recent, setRecent] = useState<RecentLesson[]>(readRecent);
  const [sound, setSound] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [fact, setFact] = useState(0);
  const [pollVersion, setPollVersion] = useState(0);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const reduceMotion = useReducedMotion();
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const requestPending = useRef(false);
  const noMotion = quiet || Boolean(reduceMotion);

  useEffect(() => { api.health().then(setHealth).catch(() => setHealth(null)); }, []);
  useEffect(() => {
    try {
      const id = sessionStorage.getItem("entertainify-current");
      if (id) api.lesson(id).then(setJob).catch(() => sessionStorage.removeItem("entertainify-current"));
    } catch { /* Browsers may disable storage. */ }
  }, []);

  useEffect(() => {
    if (!job || finished(job)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      try {
        const updated = await api.lesson(job!.id, controller.signal);
        if (controller.signal.aborted) return;
        setJob(updated); setError(""); failures = 0;
        if (!finished(updated)) timer = setTimeout(poll, 1800);
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && e.status === 404) {
          setError("");
          setJob((previous) => previous ? { ...previous, status: "failed", message: "This studio session has ended.", error: e.message } : previous);
          return;
        }
        failures++;
        setError(e instanceof Error ? e.message : "We lost touch with the studio. Trying again…");
        if (failures < 5) timer = setTimeout(poll, 3000 * failures);
      }
    }
    timer = setTimeout(poll, 1000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [job?.id, job?.status, pollVersion]);

  useEffect(() => {
    if (!job?.result) return;
    setRecent((previous) => {
      const entry: RecentLesson = { id: job.id, title: job.result!.title, createdAt: job.createdAt, demo: job.demo, status: job.status };
      const next = [entry, ...previous.filter((r) => r.id !== job.id)].slice(0, 8);
      try { localStorage.setItem("entertainify-recent", JSON.stringify(next)); } catch { /* Storage is optional. */ }
      return next;
    });
  }, [job?.id, job?.status, job?.result?.title]);

  const close = useCallback(() => setActive(null), []);
  useEffect(() => {
    if (!active) return;
    const previousFocus = openerRef.current;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
      if (event.key !== "Tab") return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ?? [])].filter((el) => el.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", keydown);
    return () => { cancelAnimationFrame(focusFrame); document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", keydown); previousFocus?.focus({ preventScroll: true }); };
  }, [active, close]);

  function chirp() {
    if (!sound) return;
    try {
      const context = audioRef.current ?? new AudioContext(); audioRef.current = context; void context.resume();
      const osc = context.createOscillator(), gain = context.createGain();
      osc.type = "sine"; osc.frequency.setValueAtTime(520, context.currentTime); osc.frequency.exponentialRampToValueAtTime(850, context.currentTime + .08);
      gain.gain.setValueAtTime(.035, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .13);
      osc.connect(gain); gain.connect(context.destination); osc.start(); osc.stop(context.currentTime + .14);
    } catch { /* Sound is just a little extra. */ }
  }

  function open(panel: Panel, element?: HTMLElement) {
    if (!active) openerRef.current = element ?? document.activeElement as HTMLElement | null;
    if (element) { const box = element.getBoundingClientRect(); setOrigin({ x: (box.x + box.width / 2) / window.innerWidth * 100, y: (box.y + box.height / 2) / window.innerHeight * 100 }); }
    setActive(panel); chirp();
  }

  async function generate(request?: LessonRequest) {
    if (requestPending.current || (job && !finished(job))) return;
    requestPending.current = true;
    setBusy(true); setError(""); setJob(null);
    try {
      const next = request ? await api.create(request) : await api.demo();
      setJob(next);
      try { sessionStorage.setItem("entertainify-current", next.id); } catch { /* Optional persistence. */ }
    } catch (e) { setError(e instanceof Error ? e.message : "The studio couldn't start. Please try again."); }
    finally { setBusy(false); requestPending.current = false; }
  }

  function tryDemo(element?: HTMLElement) {
    open("upload", element);
    if (!job || finished(job)) void generate();
  }
  function reset() { setJob(null); setError(""); try { sessionStorage.removeItem("entertainify-current"); } catch { /* Optional persistence. */ } }
  async function restore(id: string) {
    if (requestPending.current) return;
    if (job && !finished(job) && job.id !== id) { open("upload"); return; }
    setBusy(true); setError(""); setJob(null); open("upload");
    try { const saved = await api.lesson(id); setJob(saved); try { sessionStorage.setItem("entertainify-current", id); } catch { /* Optional persistence. */ } }
    catch (e) { setError(e instanceof Error ? e.message : "This lesson is no longer available."); }
    finally { setBusy(false); }
  }

  function tilt(event: PointerEvent<HTMLElement>) {
    if (noMotion || event.pointerType !== "mouse") return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--mx", `${(event.clientX - rect.left - rect.width / 2) / 22}px`);
    event.currentTarget.style.setProperty("--my", `${(event.clientY - rect.top - rect.height / 2) / 22}px`);
  }

  return <MotionConfig reducedMotion={noMotion ? "always" : "user"}><div className={`app ${noMotion ? "quiet" : ""}`}>
    <div className="paper-grain" aria-hidden="true"/>
    <SpriteFlights paused={noMotion || active !== null}/>
    <div inert={active !== null} className="page-shell">
      <header className="site-header"><a href="#" className="brand" aria-label="Entertainify home"><span className="brand-icon">e<span>✦</span></span><span className="rainbow-wordmark">entertainify.</span></a><div className="edition"><span className="live-dot"/> A LITTLE KNOWLEDGE. A LOT OF PERSONALITY.</div><nav aria-label="Main navigation"><a className="nav-link" href="#how-it-works">How it works <ArrowDown size={13}/></a><button className="nav-link" onClick={(e) => open("library", e.currentTarget)}><FolderOpen size={15}/>My lessons{recent.length > 0 && <span className="count-pill">{recent.length}</span>}</button><button className="icon-button sound-toggle" aria-label={sound ? "Turn sound off" : "Turn sound on"} aria-pressed={sound} onClick={() => setSound((s) => !s)}>{sound ? <Volume2 size={17}/> : <VolumeX size={17}/>}</button></nav></header>
      <div className="issue-line"><span>THE ANTI-BORING LEARNING CLUB</span><span>VOL. 001 <span className="issue-star">✳</span> HACKATHON EDITION</span><span>GOOD FOR YOUR BRAIN, PROBABLY.</span></div>

      <main className="comic-grid">
        <section className="comic-panel hero-panel" onPointerMove={tilt} onPointerLeave={(e) => { e.currentTarget.style.setProperty("--mx", "0px"); e.currentTarget.style.setProperty("--my", "0px"); }}>
          <div className="hero-copy"><span className="eyebrow"><span className="tiny-star">✳</span> BORING LESSONS, MEET YOUR PLOT TWIST.</span><h1>Your textbook.<br/>But <span className="fun-word">actually fun.<svg viewBox="0 0 420 18" preserveAspectRatio="none" aria-hidden="true"><path d="M3 9Q100 0 207 9T417 6M11 16Q240 7 399 14"/></svg></span></h1><p>Turn your notes into little stories, big “aha!” moments,<br className="desktop-break"/> and videos you’ll actually want to watch.</p><div className="hero-bottom"><span className="handwriting">less snooze. more aha.</span><ArrowDownLeft className="hero-arrow" size={34}/><span className="hero-annotation">PICK YOUR<br/>ADVENTURE BELOW</span></div></div>
          <div className="hero-character"><div className="speech-bubble">wait…<br/>I get it now.</div><Brain/><Spark className="hero-spark"/><div className="ground-shadow"/></div>
          <span className="hero-corner">EST. RIGHT NOW ↗</span>
        </section>

        <button className="comic-panel demo-panel" onClick={(e) => tryDemo(e.currentTarget)} aria-label="Explore a sample lesson"><span className="eyebrow">SEE WHAT WE MEAN</span><div className="tv-illustration"><div className="tv-antenna"/><div className="tv-body"><div className="tv-screen"><span className="tv-caption">THE CELL’S<br/>TINY POWER<br/><span>DEPARTMENT.</span></span><Brain className="tv-brain"/><span className="tv-play"><Play size={16} fill="currentColor"/></span></div><div className="tv-buttons"><i/><i/><span>|||</span></div><div className="tv-feet"/></div><span className="handwriting tv-note">science, with a side of silly.</span></div><div className="panel-bottom"><span>TRY A SAMPLE LESSON</span><span className="round-arrow"><ArrowUpRight size={19}/></span></div></button>

        <motion.button layoutId="panel-upload" className="comic-panel action-panel upload-panel" initial={false} animate={{ rotate: -1.4 }} onClick={(e) => open("upload", e.currentTarget)} whileHover={noMotion ? {} : { y: -5, rotate: -2.1 }} whileTap={{ scale: .985 }} aria-label="Upload text"><div className="panel-kicker"><span className="issue-number">01</span><span className="eyebrow">START WITH WHAT YOU HAVE</span><span className="mini-star">✳</span></div><div className="action-main"><div><h2>Text in.<br/>Fun out.</h2><p>Your lecture notes deserve<br/>a better second act.</p></div><Book className="action-art"/></div><div className="panel-bottom"><span className="panel-link"><Upload size={16}/>UPLOAD TEXT</span><span className="round-arrow"><ArrowUpRight size={20}/></span></div><span className="panel-footnote">.TXT / .MD / GOOD OLD COPY + PASTE</span></motion.button>

        <motion.button layoutId="panel-scratch" className="comic-panel action-panel scratch-panel" initial={false} animate={{ rotate: 1.35 }} onClick={(e) => open("scratch", e.currentTarget)} whileHover={noMotion ? {} : { y: -5, rotate: 2 }} whileTap={{ scale: .985 }} aria-label="Create from scratch"><div className="panel-kicker"><span className="issue-number">02</span><span className="eyebrow">START WITH A LITTLE CURIOSITY</span><span className="mini-star">✧</span></div><div className="action-main"><div><h2>Got a weird<br/>little question?</h2><p>Pick a topic. Any topic.<br/>Let’s make it click.</p></div><Pencil className="action-art"/></div><div className="panel-bottom"><span className="panel-link"><Sparkles size={16}/>FROM SCRATCH</span><span className="round-arrow"><ArrowUpRight size={20}/></span></div><span className="panel-footnote">“EXPLAIN MITOCHONDRIA LIKE I’M 12.”</span></motion.button>

        <motion.button layoutId="panel-mystery" className="comic-panel mystery-panel" initial={false} animate={{ rotate: 2 }} onClick={(e) => open("mystery", e.currentTarget)} whileHover={noMotion ? {} : { y: -5, rotate: 2.7 }} aria-label="Open the coming soon mystery"><div className="panel-kicker"><span className="issue-number">03</span><span>✦</span></div><span className="mystery-spark one">✧</span><Pixel kind="ghost" className="panel-ghost"/><span className="mystery-spark two">✧</span><h2>???</h2><p>Good things<br/>are brewing.</p><div className="mystery-tag">COMING SOON</div><span className="mystery-bottom">DON’T BE A STRANGER <ArrowUpRight size={15}/></span></motion.button>

        <section id="how-it-works" className="comic-panel how-panel"><div className="how-title"><span className="eyebrow">A VERY COMPLICATED PROCESS</span><span className="handwriting">(just kidding)</span></div><div className="how-steps"><div><span className="step-icon step-paper"><FileDoodle/></span><strong>Feed the brain</strong><p>Notes, a script,<br/>or a “what if?”</p></div><span className="step-arrow">⤳</span><div><span className="step-icon"><Spark className="w-12 text-[#ef9c82]"/></span><strong>Add a little weird</strong><p>AI turns the lesson<br/>into a story.</p></div><span className="step-arrow">⤳</span><div><span className="step-icon step-play"><Play size={23} fill="currentColor"/></span><strong>Get the “aha!”</strong><p>A lesson that<br/>actually sticks.</p></div></div></section>

        <section className="comic-panel doodle-panel"><DoodlePad/></section>

        <button className="comic-panel brain-panel" onClick={() => { setFact((f) => (f + 1) % facts.length); chirp(); }} onPointerMove={tilt} aria-label="Get another thought from the brain department"><span className="eyebrow">A NOTE FROM YOUR BRAIN</span><div className="thought-row"><span className="smiley">☺</span><motion.h3 key={fact} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{facts[fact][0]}</motion.h3></div><p>{facts[fact][1]}</p><span className="brain-next">ANOTHER LITTLE THOUGHT <ArrowRight size={14}/></span></button>
      </main>
      <div className="below-comic"><div className="handwriting">Made for the “wait, explain that again” people.</div><div className="floating-cat"><div className="rainbow-trail"/><Pixel/><span className="pixel-spark">✦</span></div><span className="eyebrow">STAY CURIOUS. STAY A LITTLE WEIRD.</span></div>
      <footer className="site-footer"><span>© ENTERTAINIFY <span className="footer-spark">✳</span> MADE WITH CAFFEINE & CURIOSITY</span><div><span className="footer-status"><span className="live-dot"/>{job && !finished(job) ? <button onClick={() => open("upload")}>YOUR LESSON IS COOKING ↗</button> : "A HACKATHON EXPERIMENT"}</span><button className="motion-toggle" aria-pressed={quiet} onClick={() => setQuiet((q) => !q)}>{noMotion ? <Play size={11}/> : <Pause size={11}/>} {quiet ? "MORE WIGGLE" : "LESS WIGGLE"}</button></div></footer>
    </div>

    <AnimatePresence>
      {active && <motion.div className="panel-flood" key="flood" style={{ background: panelColors[active] }} initial={{ clipPath: `circle(0% at ${origin.x}% ${origin.y}%)` }} animate={{ clipPath: `circle(150% at ${origin.x}% ${origin.y}%)` }} exit={{ opacity: 0 }} transition={{ duration: noMotion ? 0 : .7, ease: [.22, 1, .36, 1] }} />}
      {active && <motion.div ref={dialog} layoutId={`panel-${active}`} key={active} role="dialog" aria-modal="true" aria-label={active === "upload" ? "Upload a lesson" : active === "scratch" ? "Create a lesson from scratch" : active === "library" ? "My lessons" : "The mystery room"} className={`studio-overlay ${active === "mystery" ? "dark-studio" : ""}`} style={{ "--studio-color": panelColors[active] } as CSSProperties} transition={{ type: "spring", stiffness: 140, damping: 23 }}>
        <div className="studio-topbar"><button ref={closeRef} className="back-button" onClick={close}><ChevronLeft size={17}/>Back to the comic</button><span className="studio-wordmark rainbow-wordmark">entertainify.</span><button className="close-button" onClick={close} aria-label="Close panel"><X size={19}/><span>ESC</span></button></div>
        <motion.div initial={{ opacity: 0, y: noMotion ? 0 : 25 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: noMotion ? 0 : .22, duration: .35 }}>
          {(active === "upload" || active === "scratch") && <Studio key={active} kind={active} job={job} busy={busy} error={error} health={health} onGenerate={(request) => void generate(request)} onDemo={() => void generate()} onReset={reset} onRetryConnection={() => setPollVersion((v) => v + 1)}/>}
          {active === "mystery" && <Mystery/>}
          {active === "library" && <div className="studio-content"><div className="studio-heading"><div><span className="eyebrow">YOUR LITTLE COLLECTION OF AHA’S</span><h1>The good<br/><span>stuff stays here.</span></h1><p>Recent lessons from this browser. Download the JSON to keep a copy.</p></div><Book className="studio-art"/></div>{recent.length ? <div className="lesson-library">{recent.map((lesson) => <button key={lesson.id} onClick={() => void restore(lesson.id)} className="saved-lesson"><span className="saved-icon"><Film size={25}/></span><span><strong>{lesson.title}</strong><small>{lesson.demo ? "Sample storyboard" : lesson.status === "complete" ? "Video ready" : "Script & scene plan"} · {new Date(lesson.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></span><ArrowUpRight size={20}/></button>)}<p className="input-note mt-4">Lessons are held in this server’s memory for up to an hour and may expire sooner when the studio is busy or restarted. This list stores titles, not your source text.</p></div> : <div className="empty-library"><Pixel/><h2>A blank page. So much potential.</h2><p>Your first “aha!” is one good question away.</p><button className="ink-button primary" onClick={() => open("scratch")}>Make your first lesson <ArrowRight size={18}/></button></div>}</div>}
        </motion.div>
      </motion.div>}
    </AnimatePresence>
  </div></MotionConfig>;
}

function FileDoodle() { return <svg width="43" height="48" viewBox="0 0 43 48" fill="none" aria-hidden="true"><path d="M7 3h23l8 9v31H7Z" fill="#c3d4ea" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/><path d="M29 3v11h9M14 23h16m-16 6h16m-16 6h10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>; }
