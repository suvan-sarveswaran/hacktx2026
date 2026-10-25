import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowDownLeft, ArrowRight, ArrowUpRight, ChevronLeft, Film, FolderOpen, Pause, Play, Sparkles, Volume2, VolumeX, X } from "lucide-react";
import type { LessonSummary, LessonFormat } from "../../src/web-contract";
import { api } from "./api";
import { Book, Brain, DoodlePad, Pencil, Pixel, Spark, SpriteFlights } from "./Art";
import { Studio } from "./Studio";
import { LessonWorkspace, isProducing, statusLabel } from "./lesson-workspace";

type Panel = LessonFormat | "library";
const panelColors = { youtube: "#c8d8ee", short: "#d0dfb9", comic: "#f5dfa3", library: "#f3c9ce" };
const formatName = (kind?: string) => kind === "comic" ? "Comic Book" : kind === "short" ? "Short-form" : "YouTube Video";
const facts = [
  ["Your brain is not a USB drive.", "Understanding beats downloading. Make the idea make sense."],
  ["Mitochondria need a union.", "All that energy production. Not a single vacation day."],
  ["Confused? Good starting point.", "Every “aha!” begins with a small “huh?”"],
  ["A textbook walks into a bar…", "Nobody notices. We’re working on its delivery."],
];
export default function App() {
  const [active, setActive] = useState<Panel | null>(null);
  const [workspace] = useState(() => {
    let storage: Storage | undefined;
    try { storage = localStorage; } catch { /* Storage is optional. */ }
    return new LessonWorkspace(api, storage);
  });
  const state = useSyncExternalStore(workspace.subscribe, workspace.snapshot);
  const recent = state.recent;
  const [sound, setSound] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [fact, setFact] = useState(0);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const reduceMotion = useReducedMotion();
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const noMotion = quiet || Boolean(reduceMotion);

  useEffect(() => {
    void workspace.refreshLibrary(); void workspace.poll();
    const poll = setInterval(() => void workspace.poll(), 1800);
    const library = setInterval(() => void workspace.refreshLibrary(), 5000);
    return () => { clearInterval(poll); clearInterval(library); };
  }, [workspace]);

  const close = useCallback(() => setActive(null), []);
  useEffect(() => { dialog.current?.scrollTo({ top: 0 }); }, [active, state.selected.youtube, state.selected.short, state.selected.comic]);
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
    if (panel === "library") void workspace.refreshLibrary();
    setActive(panel); chirp();
  }

  function restore(lesson: LessonSummary) {
    const kind: LessonFormat = lesson.workflow === "comic" || lesson.workflow === "short" ? lesson.workflow : "youtube";
    workspace.select(kind, lesson.id);
    open(kind);
    void workspace.refresh(lesson.id);
  }
  function newLesson(kind: LessonFormat) { workspace.select(kind, null); open(kind); }

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
          <div className="hero-copy"><span className="eyebrow"><span className="tiny-star">✳</span> BORING LESSONS, MEET YOUR PLOT TWIST.</span><h1>Your textbook.<br/>But <span className="fun-word">actually fun.<svg viewBox="0 0 420 18" preserveAspectRatio="none" aria-hidden="true"><path d="M3 9Q100 0 207 9T417 6M11 16Q240 7 399 14"/></svg></span></h1><p>Turn your notes into little stories, big “aha!” moments,<br className="desktop-break"/> and a lesson you’ll actually want to finish.</p><div className="hero-bottom"><span className="handwriting">less snooze. more aha.</span><ArrowDownLeft className="hero-arrow" size={34}/><span className="hero-annotation">PICK YOUR<br/>ADVENTURE BELOW</span></div></div>
          <div className="hero-character"><div className="speech-bubble">wait…<br/>I get it now.</div><Brain/><Spark className="hero-spark"/><div className="ground-shadow"/></div>
          <span className="hero-corner">EST. RIGHT NOW ↗</span>
        </section>

        {(["youtube", "short", "comic"] as const).map((kind, index) => <motion.button key={kind} layoutId={`panel-${kind}`} className={`comic-panel action-panel format-panel ${kind === "youtube" ? "upload-panel" : kind === "short" ? "scratch-panel" : "comic-book-panel"}`} initial={false} animate={{ rotate: index === 1 ? 1.35 : -1.4 }} onClick={(e) => open(kind, e.currentTarget)} whileHover={noMotion ? {} : { y: -5, rotate: index === 1 ? 2 : -2.1 }} whileTap={{ scale: .985 }} aria-label={`Create ${formatName(kind)}`}><div className="panel-kicker"><span className="issue-number">0{index + 1}</span><span className="eyebrow">{kind === "youtube" ? "THE BIG PICTURE" : kind === "short" ? "SMALL SCREEN. BIG AHA." : "ONE IDEA. EVERY FRAME."}</span><span className="mini-star">✳</span></div><div className="action-main"><div><h2>{kind === "youtube" ? <>YouTube<br/>Video</> : kind === "short" ? <>Short-form</> : <>Comic<br/>Book</>}</h2><p>{kind === "youtube" ? <>Notes or a question.<br/>A story worth watching.</> : kind === "short" ? <>A little lesson on the go.<br/>Extra brainrot? Your call.</> : <>Turn the page.<br/>See the idea click.</>}</p></div>{kind === "comic" ? <Pencil className="action-art"/> : <Book className="action-art"/>}</div><div className="panel-bottom"><span className="panel-link">{kind === "comic" ? <Sparkles size={16}/> : <Film size={16}/>}CREATE {kind === "comic" ? "A COMIC" : "A VIDEO"}</span><span className="round-arrow"><ArrowUpRight size={20}/></span></div><span className="panel-footnote">PDF / TXT / MD / YOUR OWN PROMPT</span></motion.button>)}

        <section id="how-it-works" className="comic-panel how-panel"><div className="how-title"><span className="eyebrow">A VERY COMPLICATED PROCESS</span><span className="handwriting">(just kidding)</span></div><div className="how-steps"><div><span className="step-icon step-paper"><FileDoodle/></span><strong>Feed the brain</strong><p>Notes, a script,<br/>or a “what if?”</p></div><span className="step-arrow">⤳</span><div><span className="step-icon"><Spark className="w-12 text-[#ef9c82]"/></span><strong>Add a little weird</strong><p>AI turns the lesson<br/>into a story.</p></div><span className="step-arrow">⤳</span><div><span className="step-icon step-play"><Play size={23} fill="currentColor"/></span><strong>Get the “aha!”</strong><p>A lesson that<br/>actually sticks.</p></div></div></section>

        <section className="comic-panel doodle-panel"><DoodlePad/></section>

        <button className="comic-panel brain-panel" onClick={() => { setFact((f) => (f + 1) % facts.length); chirp(); }} onPointerMove={tilt} aria-label="Get another thought from the brain department"><span className="eyebrow">A NOTE FROM YOUR BRAIN</span><div className="thought-row"><span className="smiley">☺</span><motion.h3 key={fact} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{facts[fact][0]}</motion.h3></div><p>{facts[fact][1]}</p><span className="brain-next">ANOTHER LITTLE THOUGHT <ArrowRight size={14}/></span></button>
      </main>
      <div className="below-comic"><div className="handwriting">Made for the “wait, explain that again” people.</div><div className="floating-cat"><div className="rainbow-trail"/><Pixel/><span className="pixel-spark">✦</span></div><span className="eyebrow">STAY CURIOUS. STAY A LITTLE WEIRD.</span></div>
      <footer className="site-footer"><span>© ENTERTAINIFY <span className="footer-spark">✳</span> MADE WITH CAFFEINE & CURIOSITY</span><div><span className="footer-status"><span className="live-dot"/>{recent.some(isProducing) ? <button onClick={() => open("library")}>YOUR LESSONS ARE COOKING ↗</button> : "A HACKATHON EXPERIMENT"}</span><button className="motion-toggle" aria-pressed={quiet} onClick={() => setQuiet((q) => !q)}>{noMotion ? <Play size={11}/> : <Pause size={11}/>} {quiet ? "MORE WIGGLE" : "LESS WIGGLE"}</button></div></footer>
    </div>

    <AnimatePresence>
      {active && <motion.div className="panel-flood" key="flood" style={{ background: panelColors[active] }} initial={{ clipPath: `circle(0% at ${origin.x}% ${origin.y}%)` }} animate={{ clipPath: `circle(150% at ${origin.x}% ${origin.y}%)` }} exit={{ opacity: 0 }} transition={{ duration: noMotion ? 0 : .7, ease: [.22, 1, .36, 1] }} />}
      <motion.div hidden={!active} ref={dialog} key="workspace" role="dialog" aria-modal="true" aria-label={active === "library" ? "My lessons" : formatName(active ?? "youtube")} className="studio-overlay" style={{ "--studio-color": panelColors[active ?? "youtube"] } as CSSProperties} transition={{ type: "spring", stiffness: 140, damping: 23 }}>
        <div className="studio-topbar"><button ref={closeRef} className="back-button" onClick={close}><ChevronLeft size={17}/>Back to the comic</button><span className="studio-wordmark rainbow-wordmark">entertainify.</span><button className="close-button" onClick={close} aria-label="Close panel"><X size={19}/><span>ESC</span></button></div>
        <motion.div initial={{ opacity: 0, y: noMotion ? 0 : 25 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: noMotion ? 0 : .22, duration: .35 }}>
          {(["youtube", "short", "comic"] as const).map(kind => {
            const id = state.selected[kind];
            return <div key={kind} hidden={active !== kind}><Studio kind={kind} visible={active === kind} restoring={Boolean(id)} job={id ? state.jobs[id] ?? null : null} busy={state.busy[kind] || Boolean(id && !state.jobs[id] && !state.jobErrors[id])} error={id ? state.jobErrors[id] ?? "" : state.errors[kind]} onGenerate={request => workspace.create(kind, request)} onReset={() => newLesson(kind)} onRetryConnection={() => { if (id) void workspace.refresh(id); }} onUpdate={workspace.update}/></div>;
          })}

          {active === "library" && <div className="studio-content"><div className="studio-heading"><div><span className="eyebrow">YOUR LITTLE COLLECTION OF AHA’S</span><h1>The good<br/><span>stuff stays here.</span></h1><p>Your videos, comics, source text, and scripts, saved on this computer. Pick up right where you left off.</p><div className="result-actions">{(["youtube", "short", "comic"] as const).map(kind => <button key={kind} className="ink-button" onClick={() => newLesson(kind)}>{formatName(kind)}</button>)}</div></div><Book className="studio-art"/></div>{state.libraryError && <div className="error-box" role="alert">{state.libraryError}<button className="text-link" onClick={() => void workspace.refreshLibrary()}>Try again</button></div>}{state.libraryLoading ? <p role="status">Loading your saved lessons…</p> : recent.length ? <div className="lesson-library">{recent.map((lesson) => <button key={lesson.id} onClick={() => restore(lesson)} className="saved-lesson"><span className="saved-icon"><Film size={25}/></span><span><strong>{lesson.title}</strong><small>{formatName(lesson.workflow)} · {statusLabel(lesson.status, lesson.workflow)} · {new Date(lesson.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></span><ArrowUpRight size={20}/></button>)}<p className="input-note mt-4">Projects survive browser and server restarts. Download the video, source, or script from any lesson.</p></div> : <div className="empty-library"><Pixel/><h2>A blank page. So much potential.</h2><p>Your first “aha!” is one good question away.</p><button className="ink-button primary" onClick={() => open("youtube")}>Make your first lesson <ArrowRight size={18}/></button></div>}</div>}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  </div></MotionConfig>;
}

function FileDoodle() { return <svg width="43" height="48" viewBox="0 0 43 48" fill="none" aria-hidden="true"><path d="M7 3h23l8 9v31H7Z" fill="#c3d4ea" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/><path d="M29 3v11h9M14 23h16m-16 6h16m-16 6h10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>; }
