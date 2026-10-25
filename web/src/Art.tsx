import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import { RotateCcw } from "lucide-react";

export function Phone({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 170 200" fill="none" aria-hidden="true"><g transform="rotate(9 85 100)"><rect x="41" y="12" width="96" height="176" rx="17" fill="#302743"/><rect x="34" y="8" width="96" height="176" rx="17" fill="#fffaf0" stroke="#302743" strokeWidth="4"/><rect x="43" y="26" width="78" height="137" rx="6" fill="#c8d8ee" stroke="#302743" strokeWidth="2"/><path d="m72 46 25 16-25 16Z" fill="#ef9c82" stroke="#302743" strokeWidth="3" strokeLinejoin="round"/><path d="M56 90h51M62 98h39" stroke="#302743" strokeWidth="3" strokeLinecap="round"/><path d="M43 110h78v47a6 6 0 0 1-6 6H49a6 6 0 0 1-6-6Z" fill="#d0dfb9"/><path d="m70 113-16 50m40-50 16 50m-28-50v50" stroke="#8c9c76" strokeWidth="3"/><circle cx="82" cy="139" r="8" fill="#f5dfa3" stroke="#302743" strokeWidth="2"/><path d="M70 18h24M77 173h10" stroke="#302743" strokeWidth="3" strokeLinecap="round"/></g><path d="m16 41 5 11 12 2-11 5-2 12-5-11-12-2 11-5Z" fill="#ef9c82" stroke="#302743" strokeWidth="2"/></svg>;
}

export function Spark({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="M40 3 47 29 73 18 56 39 77 51 50 51 48 77 35 55 13 72 24 46 2 37 30 31Z" fill="currentColor" stroke="#28271f" strokeWidth="2.5" strokeLinejoin="round" /></svg>;
}

export function Book({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 230 190" fill="none" aria-hidden="true">
    <g stroke="#28271f" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m27 51 75-12 19 15 75-15 10 99-80 19-22-11-71 5Z" fill="#f8efdc" />
      <path d="m23 42 78-13 21 16 70-14 8 98-73 16-22-14-74 10Z" fill="#6999d0" />
      <path d="m101 29 4 102 22 14-5-100Z" fill="#8cb0db" />
      <path d="m41 60 43-7m-42 17 31-6m66-3 37-8m-36 18 26-6" stroke="#f9f0da" />
      <path d="m52 90 4 8m27-13 4 8m-28 15q18 14 27-6" />
      <path d="m56 148-10 23-16-2m130-25 17 14 16-4" />
      <path d="M24 89 8 81 3 65m194 13 20-13 4-13" />
      <path d="m145 21 2-14m16 15 10-10M15 25l-9-8" />
    </g><path d="m195 150 4 9 10 1-8 7 2 10-9-5-9 5 2-11-7-7 11-1Z" fill="#f7cd43" stroke="#28271f" strokeWidth="2" />
  </svg>;
}

export function Pencil({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 240 190" fill="none" aria-hidden="true"><g stroke="#28271f" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
    <g transform="rotate(30 124 90)"><path d="M103 32h35v102l-18 31-17-31Z" fill="#f8d34f" /><path d="M103 32V19q17-12 35 0v13Z" fill="#f291ac"/><path d="M103 32h35v12h-35Z" fill="#f8efdc" /><path d="M103 134h35l-18 31Z" fill="#f5dfbd"/><path d="m113 153 7 12 8-12" fill="#28271f"/><path d="M114 47v62m13-62v62"/><path d="m113 75 1 4m13-4 1 4m-14 12q6 6 13-1" /></g>
    <path d="M61 159q-27-21-31-7t21 10q48 0 86 7t71-11" strokeDasharray="4 6" /><path d="m69 48-12-6m15-10-4-12m108 63 14-7m-15 23 18 2" />
    </g><path d="m204 28 3 12 13 3-13 4-3 12-4-12-12-4 12-3Z" fill="#fc8c70" stroke="#28271f" strokeWidth="2" /></svg>;
}

export function Brain({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 180 180" fill="none" aria-hidden="true"><g stroke="#28271f" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M53 109q-26-5-19-31-12-23 10-34 3-29 28-24 19-18 34-3 27-8 34 18 24 7 17 32 18 21-4 37-1 27-29 25-18 17-36 3-26 9-35-23Z" fill="#ee9ab3" />
    <path d="M91 24q-9 21 6 32-10 14-3 31-9 13-3 35M51 44q18-9 20 12M42 76q18-9 27 7m-11 24q10 0 15-10m41-64q-14 12-2 23m23-4q-15 0-14 18m17 16q-10-9-22 2m1 23q10-9 4-17" />
    <path d="m69 137-6 23-16 3m67-25 7 24 18 2M34 90 13 98 8 83m147 1 18 4 3-15"/>
    <path d="M65 67h17v16H62V67h3m36 0h20v16h-20Zm-19 4h19" fill="#f8efdc" /><path d="M72 73v3m38-3v3m-30 22q10 9 19-1" />
    </g></svg>;
}

const ghost = ["0001111000","0012222100","0122222210","0121212210","0121212210","0122222210","0123332210","0122222210","0121221210","0101001010"];
const cat = ["001100011000","001210012100","001222222100","011212212110","122222222221","122233332221","122222222221","011111111110","001100011000"];
const star = ["00000100000","00001210000","00001210000","01112221110","01222222210","00122222100","00012221000","00122222100","01221012210","01110001110"];
export function Pixel({ kind = "cat", className = "" }: { kind?: "cat" | "ghost" | "star"; className?: string }) {
  const pixels = kind === "ghost" ? ghost : kind === "star" ? star : cat;
  const colors = ["transparent", "#28271f", kind === "ghost" ? "#faf2da" : kind === "star" ? "#f8d64a" : "#bdabe4", "#ef86aa"];
  return <svg className={className} viewBox={`0 0 ${pixels[0].length} ${pixels.length}`} shapeRendering="crispEdges" aria-hidden="true">{pixels.flatMap((row, y) => [...row].map((pixel, x) => pixel !== "0" && <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={colors[Number(pixel)]} />))}</svg>;
}

/** Decorative flights use only CSS transforms and never intercept clicks or scrolling. */
export function SpriteFlights({ paused }: { paused: boolean }) {
  return <div className={`sprite-sky${paused ? " sprite-sky-paused" : ""}`} aria-hidden="true">
    <div className="flying-sprite sprite-cat"><div className="sprite-body"><span className="sprite-trail"/><Pixel/><span className="sprite-glint">✦</span></div></div>
    <div className="flying-sprite sprite-ghost"><div className="sprite-body"><span className="sprite-trail"/><Pixel kind="ghost"/></div></div>
    <div className="flying-sprite sprite-star"><div className="sprite-body"><Pixel kind="star"/></div></div>
    <div className="flying-sprite sprite-cat sprite-cat-little"><div className="sprite-body"><span className="sprite-trail"/><Pixel/></div></div>
    <div className="flying-sprite sprite-star sprite-star-little"><div className="sprite-body"><Pixel kind="star"/></div></div>
  </div>;
}

export function DoodlePad() {
  const ref = useRef<SVGSVGElement>(null);
  const [paths, setPaths] = useState<{ d: string; color: string }[]>([]);
  const [color, setColor] = useState("#34312b");
  const drawing = useRef(false);
  function point(event: PointerEvent<SVGSVGElement>) {
    const box = ref.current!.getBoundingClientRect();
    return `${((event.clientX - box.left) / box.width * 300).toFixed(1)},${((event.clientY - box.top) / box.height * 125).toFixed(1)}`;
  }
  return <div className="doodle-widget">
    <div className="flex items-center justify-between gap-2"><span className="eyebrow">MARGIN DOODLES</span><button type="button" className="icon-button" aria-label="Clear doodles" onClick={() => setPaths([])}><RotateCcw size={14}/></button></div>
    <svg ref={ref} role="img" aria-label="Draw here with your mouse or finger" viewBox="0 0 300 125" className="drawing-pad" onPointerDown={(e) => { if (e.button !== 0) return; drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); const p = point(e); setPaths((v) => [...v.slice(-149), { d: `M${p} L${p}`, color }]); }} onPointerMove={(e) => { if (!drawing.current) return; const p = point(e); setPaths((v) => v.map((path, i) => i === v.length - 1 ? { ...path, d: `${path.d} L${p}` } : path)); }} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }}>
      {paths.length === 0 && <g stroke="#9a8d83" strokeWidth="2" fill="none" strokeLinecap="round"><path d="M111 42q-16-30-34-5-9 21 34 44 42-25 31-45-15-21-31 6Z"/><path d="m185 28 5 15 17 1-13 10 4 17-14-10-14 9 5-16-12-11 17-1Z"/></g>}
      {paths.map((path, i) => <path key={i} d={path.d} stroke={path.color} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
    </svg>
    <div className="flex items-center justify-between"><span className="handwriting">your brain needs recess, too.</span><div className="flex gap-1.5">{["#34312b", "#df6257", "#4c7cbe", "#6b8957"].map((c) => <button key={c} type="button" aria-label={`Draw in ${c === "#34312b" ? "black" : c === "#df6257" ? "red" : c === "#4c7cbe" ? "blue" : "green"}`} aria-pressed={color === c} className={`color-dot ${color === c ? "selected" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />)}</div></div>
  </div>;
}
