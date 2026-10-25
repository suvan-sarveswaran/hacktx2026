import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Check, Download, LoaderCircle, Sparkles, Square } from "lucide-react";
import type { LessonJob, ProductionSettings, StageRequest } from "../../src/web-contract";
import { ART_STYLES, DEFAULT_SETTINGS, IMAGE_MODELS } from "../../src/production-settings";
import { imageTimeShare, VISUAL_PLAN_VERSION } from "../../src/visual-plan";
import { api } from "./api";

import { isProducing } from "./lesson-workspace";
import { LessonPlayer } from "./LessonPlayer";
import { ComicReader } from "./ComicReader";

export function ApiKeyField({ provider, value, onChange }: { provider: string; value: string; onChange: (value: string) => void }) {
  const [error, setError] = useState("");
  const id = useId();
  return <div className="key-field"><label htmlFor={id}>{provider} API key</label><input id={id} type="password" autoComplete="off" spellCheck={false} maxLength={500} value={value} onChange={e => onChange(e.target.value)} placeholder="Paste your key to unlock this step"/>
    <label className="key-file">or load a key from a .txt file<input type="file" accept=".txt,text/plain" onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
      try { if (file.size > 1000) throw new Error("Choose a text file containing only your API key."); const key = (await file.text()).trim(); if (!key || key.length > 500 || /[\r\n]/.test(key)) throw new Error("The file must contain a single API key."); onChange(key); setError(""); }
      catch (error) { setError(error instanceof Error ? error.message : "Could not read that key file."); }
    }}/></label><small>Used only for this step. Never saved with your lesson or in browser storage.</small>{error && <p role="alert">{error}</p>}</div>;
}

export function Production({ job, visible, onUpdate, onReset, connectionError, onRetryConnection }: { job: LessonJob; visible: boolean; onUpdate: (job: LessonJob) => void; onReset: () => void; connectionError: string; onRetryConnection: () => void }) {
  const comic = job.workflow === "comic", short = job.workflow === "short";
  const fixedFormat = comic || short || job.workflow === "youtube";
  const storageKey = `entertainify-editor-${job.id}`;
  const base = JSON.stringify([job.settings, job.scenePrompts, job.result?.chunks]);
  const [draft] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null"); return saved?.base === base ? saved : null; } catch { return null; }
  });
  const [settings, setSettings] = useState<ProductionSettings>({ ...DEFAULT_SETTINGS, ...job.settings, ...draft?.settings });
  const [preset, setPreset] = useState(() => Object.entries(ART_STYLES).find(([, style]) => style === (draft?.settings?.style ?? job.settings?.style))?.[0] ?? "custom");
  const [imageKey, setImageKey] = useState("");
  const [voiceKey, setVoiceKey] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [few, setFew] = useState<number>(draft?.few ?? 5);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([]);
  const [prompts, setPrompts] = useState<Record<string, string>>(draft?.prompts ?? {});
  const [details, setDetails] = useState<"script" | "source" | "scenes">(draft?.details ?? "script");
  const [startingMedia, setStartingMedia] = useState<"audio" | "video" | null>(null);
  const pendingRef = useRef(false);
  const planPanel = useRef<HTMLDetailsElement>(null);
  const previousBase = useRef(base);
  useEffect(() => {
    if (previousBase.current === base) return;
    previousBase.current = base;
    setSettings({ ...DEFAULT_SETTINGS, ...job.settings }); setPrompts({});
    setPreset(Object.entries(ART_STYLES).find(([, style]) => style === job.settings?.style)?.[0] ?? "custom");
  }, [base, job.settings]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ base, settings, prompts, few, details })); } catch { /* Optional local draft; applied settings stay on the server. */ }
  }, [storageKey, base, settings, prompts, few, details]);
  const running = isProducing(job), locked = running || pending;
  const result = job.result;
  const imageCount = result?.chunks.filter(c => c.renderHint === "image").length ?? 0;
  const textCount = result?.chunks.filter(c => c.renderHint === "text").length ?? 0;
  const imageShare = imageTimeShare(result?.chunks ?? []);
  const needsMoreImages = imageShare <= 0.5;
  const oldPlan = (result?.visualPlanning?.version ?? 0) < VISUAL_PLAN_VERSION;
  const ready = job.frames?.filter(f => f.imageUrl).length ?? 0;
  const dirty = JSON.stringify(settings) !== JSON.stringify(job.settings) || Object.keys(prompts).length > 0;
  const imageDirty = settings.style !== job.settings?.style || settings.imageModel !== job.settings?.imageModel || settings.imageAspect !== job.settings?.imageAspect || Object.keys(prompts).length > 0;
  const missing = imageDirty ? imageCount : imageCount - ready;
  const credits = result?.script.length ?? 0;
  const step = !result ? 0 : job.status === "complete" ? 3 : comic ? ready === imageCount ? 2 : 1 : needsMoreImages && !settings.fallbackText ? 1 : ["voice", "rendering", "images-ready", "audio-ready"].includes(job.status) ? 2 : 1;
  const change = <K extends keyof ProductionSettings>(key: K, value: ProductionSettings[K]) => setSettings(previous => ({ ...previous, [key]: value }));
  async function action(stage: string, extras: StageRequest = {}) {
    if (pendingRef.current) return;
    pendingRef.current = true; setPending(true); setError("");
    if (stage === "video") setStartingMedia(extras.audioOnly ? "audio" : "video");
    try {
      const next = await api.stage(job.id, stage, { ...(stage === "stop" ? {} : { settings, prompts }), ...extras });
      onUpdate(next); setSettings(next.settings ?? settings); setPrompts({});
      if (stage === "images") setImageKey("");
      if (stage === "video") setVoiceKey("");
      if (stage === "script" || stage === "plan") setGroqKey("");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not start this step."); }
    finally { pendingRef.current = false; setPending(false); setStartingMedia(null); }
  }
  return <>
    <div className="result-heading"><span className="eyebrow">{comic ? "THE LITTLE COMIC FACTORY" : short ? "THE SHORT-FORM STUDIO" : "THE YOUTUBE STUDIO"}</span><h1>{job.status === "complete" ? <>That’s a wrap.<br/><span>{comic ? "Turn the page." : "Press play."}</span></> : <>One story.<br/><span>Three little steps.</span></>}</h1><p>{comic ? "Story. Illustrations. A page worth keeping." : "Script. Pictures. Voice. Your next lesson has a premiere."}</p><button className="ink-button" onClick={onReset}>Make another lesson <Sparkles size={16}/></button></div>
    <ol className="phase-strip" aria-label="Production stages">{(comic ? ["Plan the story", "Draw the panels", "Assemble the page", "Read the comic"] : ["Write the story", "Draw the scenes", "Voice + final cut", "Press play"]).map((label, index) => <li key={label} className={index === step ? "current" : index < step ? "done" : ""} aria-current={index === step ? "step" : undefined}><span>{index < step ? <Check size={16}/> : String(index + 1).padStart(2, "0")}</span>{label}</li>)}</ol>
    <div className="production-status" aria-live="polite"><div className="flex justify-between gap-4"><strong>{job.message}</strong>{running && <LoaderCircle size={20} className="spin"/>}</div><div className="progress-track" role="progressbar" aria-label="Video production" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${job.progress}%` }}/></div><p className="input-note">{running ? "You can close this panel; generation continues while the server stays open." : "Saved locally · return to this project from My lessons anytime."}</p>{running && job.status !== "writing" && <button className="text-link" disabled={pending} onClick={() => void action("stop")}><Square size={13}/>Stop after saving progress</button>}</div>
    {(error || connectionError || job.error) && <div className="error-box" role="alert">{error || connectionError || job.error}<button className="text-link" onClick={() => { setError(""); onRetryConnection(); }}>Refresh saved progress</button></div>}
    {!result && job.status === "failed" && <section className="phase-card"><h2>Let’s try the story again.</h2><ApiKeyField provider="Groq" value={groqKey} onChange={setGroqKey}/><button className="ink-button primary" disabled={locked || !groqKey.trim()} onClick={() => void action("script", { apiKey: groqKey })}>Retry script <ArrowRight size={18}/></button></section>}
    {result && <>
      <div className="result-title-row"><h2>{result.title}</h2><span className="small-sticker">SAVED FOR LATER, TOO</span></div>
      <div className="result-stats"><span><strong>{result.metadata.wordCount}</strong> words</span><span><strong>{imageCount}</strong> illustrations</span>{comic ? <span>One illustrated page · captions included</span> : <><span><strong>{textCount}</strong> text cards</span><span><strong>~{Math.round(imageShare * 100)}%</strong> image time</span><span><strong>~{result.metadata.estimatedDurationSeconds < 60 ? Math.round(result.metadata.estimatedDurationSeconds) : Math.round(result.metadata.estimatedDurationSeconds / 60 * 10) / 10}</strong> {result.metadata.estimatedDurationSeconds < 60 ? "sec" : "min"}</span></>}</div>
      {comic ? <ComicReader job={job}/> : <LessonPlayer job={job} visible={visible} starting={startingMedia}/>}
      {!comic && <details ref={planPanel} className="phase-card visual-plan" open={needsMoreImages || oldPlan || result.visualPlanning?.mode !== "groq" || job.failedStage === "plan" || job.status === "planning"}>
        <summary>{imageCount === 0 ? "Plan illustrations for this lesson" : needsMoreImages ? "Add more illustrations to this lesson" : "Your visual plan · images with a purpose"}</summary>
        <p>Illustrations lead the story: we aim for 80–90% image time. Text appears only when an idea has no useful visual representation. Cuts stay snappy at roughly 6–12 spoken words, timed to the voiceover.</p>
        <p className="input-note">{needsMoreImages ? "This plan needs more illustrations. Add your Groq key and replan visuals; images must cover more than half the final video. Your exact narration and previous videos stay saved." : oldPlan ? "This lesson uses an older visual plan. Replan with Groq to use the new preference for illustrations; the narration stays unchanged." : "Review the Scene plan below before generating pictures. Image time is estimated from narration length and checked against actual speech timing when rendering."}</p>
        <fieldset disabled={locked}><ApiKeyField provider="Groq" value={groqKey} onChange={setGroqKey}/><button className="ink-button" disabled={!groqKey.trim()} onClick={() => void action("plan", { apiKey: groqKey })}>{job.failedStage === "plan" ? "Continue visual plan" : "Replan visuals"}<Sparkles size={16}/></button></fieldset>
        <p className="input-note">Writing + visuals start in one Groq request. If too much becomes text, the plan gets revised in small batches with waits for the free tier. Completed batches are saved for retries. Replanning replaces scene mappings; saved voiceovers can be reused.</p>
      </details>}
      <div className="phase-layout">
        <section className="phase-card image-phase"><div className="phase-title"><span className="phase-number">02</span><div><span className="eyebrow">A LOOK OF ITS OWN</span><h2>Draw the scenes.</h2></div><span className="count-pill">{ready} / {imageCount}</span></div>
          <fieldset disabled={locked}><label htmlFor={`${job.id}-art-preset`}>Starting style</label><select id={`${job.id}-art-preset`} value={preset} onChange={e => { setPreset(e.target.value); if (e.target.value !== "custom") change("style", ART_STYLES[e.target.value as keyof typeof ART_STYLES]); }}><option value="doodle">Minimalist doodles</option><option value="vector">Flat editorial illustration</option><option value="pencil">Colored-pencil storybook</option><option value="cinematic">Cinematic illustration</option><option value="custom">Custom art direction</option></select>
          {fixedFormat ? <p className="format-badge">{comic ? "Comic panels · landscape illustrations" : short ? settings.brainrot ? "9:16 short · lesson above, gameplay below" : "9:16 short · full-screen visuals" : "YouTube · 16:9 · 1280 × 720"}</p> : <>          <label htmlFor={`${job.id}-image-aspect`}>Image aspect ratio</label><select id={`${job.id}-image-aspect`} value={settings.imageAspect} onChange={e => { change("imageAspect", e.target.value as ProductionSettings["imageAspect"]); change("videoAspect", e.target.value as ProductionSettings["videoAspect"]); }}><option value="landscape">Landscape · 16:9 · 1280 × 720</option><option value="square">Square · 1:1 · 1024 × 1024</option><option value="portrait">Portrait · 9:16 · 720 × 1280</option></select>
</>}
          <label htmlFor={`${job.id}-image-model`}>Image model</label><select id={`${job.id}-image-model`} value={settings.imageModel} onChange={e => change("imageModel", e.target.value)}>{Object.entries(IMAGE_MODELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><p className="input-note">Try one image before a full batch. Alternatives use different amounts of Pollen; your Pollinations balance and model access apply. Each scene gets its own stable seed.</p>
          <label htmlFor={`${job.id}-art-direction`}>Art direction for every frame</label><textarea id={`${job.id}-art-direction`} rows={4} maxLength={1000} value={settings.style} onChange={e => { change("style", e.target.value); setPreset("custom"); }}/><p className="input-note">Shared palette and drawing style; specific objects and actions for each narration beat. People appear only when their actions matter to the scene.</p>
          <button className="ink-button" disabled={!dirty} onClick={() => void action("settings")}>Apply settings + prompt edits</button><p className="input-note">New settings select a separate saved image version. Returning to previous settings reuses matching frames.</p>
          {imageCount === 0 ? <div className="stage-estimate" role="status"><strong>No illustrations are planned yet.</strong><span>This lesson has {textCount} text cards. Image generation needs scene prompts first; pasting a Pollinations key cannot add them.</span><button className="ink-button" onClick={() => { if (planPanel.current) { planPanel.current.open = true; planPanel.current.scrollIntoView({ behavior: "smooth", block: "start" }); planPanel.current.querySelector<HTMLInputElement>("input[type=password]")?.focus({ preventScroll: true }); } }}>Plan illustrations with Groq <ArrowRight size={16}/></button></div> : <>
          <ApiKeyField provider="Pollinations" value={imageKey} onChange={setImageKey}/>
          <div className="stage-estimate"><strong>{imageDirty ? "Apply settings to check matching saved images." : `${ready} ready · ${missing} missing · ${textCount} text cards`}</strong><span>{imageCount} image requests for a fresh set. Text cards use no image credits. Provider billing applies; cached images are reused.</span></div>
          <div className="batch-actions"><button className="ink-button" disabled={!imageKey.trim() || missing === 0} onClick={() => void action("images", { apiKey: imageKey, count: 1 })}>Generate 1</button><input type="number" min={1} max={1000} aria-label="Number of images to generate" value={few} onChange={e => setFew(Number(e.target.value))}/><button className="ink-button" disabled={!imageKey.trim() || missing === 0 || !Number.isInteger(few) || few < 1 || few > 1000} onClick={() => void action("images", { apiKey: imageKey, count: few })}>Generate a few</button><button className="ink-button primary" disabled={!imageKey.trim() || missing === 0} onClick={() => void action("images", { apiKey: imageKey })}>Generate all missing <Sparkles size={16}/></button></div>
          <p className="input-note" role="status">{locked ? "Wait for the current operation to finish, or stop it above." : missing === 0 ? "All planned images are saved. Continue to the final step." : !imageKey.trim() ? "Add your Pollinations key to generate the planned illustrations." : `Ready to generate ${missing} missing illustration${missing === 1 ? "" : "s"}.`}</p>
          </>}
          </fieldset>
        </section>
        {comic ? <section className="phase-card"><div className="phase-title"><span className="phase-number">03</span><div><span className="eyebrow">INK MEETS PAPER</span><h2>Make it a comic.</h2></div></div><p>Review every illustration and its caption below. Edit a scene idea and regenerate that panel if its meaning is unclear.</p><p>We add crisp captions, numbered frames, and roomy gutters locally. No image-generated lettering or voice credits.</p><div className="stage-estimate"><strong>{ready} of {imageCount} panels illustrated</strong><span>{dirty ? "Apply your edits and finish any missing illustrations." : "Read left to right, then down. Every frame has a matching caption."}</span></div><button className="ink-button primary" disabled={locked || dirty || missing > 0 || imageCount === 0} onClick={() => void action("comic")}>Assemble comic page <ArrowRight size={17}/></button><p className="input-note">Full-resolution PNG, a zoomable page, and a panel-by-panel reader. Previous editions stay saved.</p></section> : <>
        <section className="phase-card voice-phase"><div className="phase-title"><span className="phase-number">03</span><div><span className="eyebrow">GIVE THE STORY A VOICE</span><h2>The final cut.</h2></div></div>
          <fieldset disabled={locked}><ApiKeyField provider="ElevenLabs" value={voiceKey} onChange={setVoiceKey}/><div className="flex justify-between gap-3"><label htmlFor={`${job.id}-voice-id`}>Voice ID</label><button className="text-link" disabled={!voiceKey.trim()} onClick={async () => { setPending(true); setError(""); try { setVoices((await api.voices(voiceKey)).voices); } catch (e) { setError(e instanceof Error ? e.message : "Could not load voices."); } finally { setPending(false); } }}>Load available voices</button></div><input id={`${job.id}-voice-id`} value={settings.voiceId} onChange={e => change("voiceId", e.target.value)}/>{voices.length > 0 && <select aria-label="Available voices" value={settings.voiceId} onChange={e => change("voiceId", e.target.value)}><option value={settings.voiceId}>Current: {settings.voiceId}</option>{voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</select>}
          <label htmlFor={`${job.id}-voice-model`}>Narration model</label><select id={`${job.id}-voice-model`} value={settings.model} onChange={e => change("model", e.target.value as ProductionSettings["model"])}><option value="eleven_flash_v2_5">Flash v2.5 · lower cost</option><option value="eleven_multilingual_v2">Multilingual v2 · long-form narration</option></select>
          {!fixedFormat && <>          <label htmlFor={`${job.id}-video-format`}>Video format</label><select id={`${job.id}-video-format`} value={settings.videoAspect} onChange={e => change("videoAspect", e.target.value as ProductionSettings["videoAspect"])}><option value="landscape">YouTube · 1280 × 720</option><option value="portrait">Reel · 720 × 1280</option><option value="square">Square · 1024 × 1024</option></select>
</>}
          {short && <div className="gameplay-option"><label className="script-checkbox"><input type="checkbox" checked={settings.brainrot} onChange={e => { change("brainrot", e.target.checked); change("imageAspect", e.target.checked ? "square" : "portrait"); }}/><span>Add a brainrot clip<small>Lesson + captions above. Silent gameplay below.</small></span></label>{settings.brainrot && <><p className="input-note">{job.gameplayClip ? "Your uploaded gameplay will loop below the lesson." : "The animated runner placeholder is included. Add Subway Surfers footage to replace it."}</p>{job.gameplayClip && <video className="gameplay-preview" controls muted preload="metadata" src={`/api/lessons/${job.id}/assets/${job.gameplayClip}`}/>}<label className="key-file">{job.gameplayClip ? "Replace gameplay clip" : "Upload Subway Surfers gameplay"}<input type="file" accept=".mp4,video/mp4" onChange={async e => {
            const file = e.target.files?.[0]; e.target.value = ""; if (!file || pendingRef.current) return;
            if (file.size > 100 * 1024 * 1024) { setError("Choose an MP4 under 100 MB."); return; }
            pendingRef.current = true; setPending(true); setError("");
            try { onUpdate(await api.uploadGameplay(job.id, file)); } catch (error) { setError(error instanceof Error ? error.message : "Could not upload the clip."); }
            finally { pendingRef.current = false; setPending(false); }
          }}/></label><p className="input-note">MP4 · up to 100 MB · clip audio is muted. The clip is cropped to fill the bottom half and looped to match your narration.</p></>}</div>}
          <label htmlFor={`${job.id}-text-card-style`}>Text-card style</label><select id={`${job.id}-text-card-style`} value={settings.textStyle} onChange={e => change("textStyle", e.target.value as ProductionSettings["textStyle"])}><option value="auto">Match the art direction</option><option value="doodle">Doodle · playful handwriting + purple</option><option value="vector">Editorial · bold type + coral</option><option value="pencil">Storybook · paper + soft pencil</option><option value="cinematic">Cinematic · dark blue + amber</option></select><p className="input-note">Large, centered text with a matching palette. For custom art direction, choose the closest text style. Cards are rendered locally and use no image credits.</p>
          <div className="stage-estimate"><strong>{credits.toLocaleString()} characters to narrate</strong><span>Estimated voice credits: {settings.model === "eleven_flash_v2_5" ? `~${Math.ceil(credits / 2).toLocaleString()}–${credits.toLocaleString()}` : `~${credits.toLocaleString()}`} (depends on plan). Matching saved narration is reused. MP4 assembly is local.</span></div>
          <label className="script-checkbox"><input type="checkbox" checked={settings.fallbackText} onChange={e => change("fallbackText", e.target.checked)}/><span>Test preview: allow text fallback and skip the image-time minimum</span></label>
          <div className="batch-actions"><button className="ink-button" disabled={!voiceKey.trim() || imageDirty} onClick={() => void action("video", { apiKey: voiceKey, audioOnly: true })}>Generate audio only</button><button className="ink-button primary" disabled={!voiceKey.trim() || imageDirty || ((missing > 0 || needsMoreImages) && !settings.fallbackText)} onClick={() => void action("video", { apiKey: voiceKey })}>{settings.fallbackText ? "Create test preview" : job.failedStage === "video" ? "Retry · reuse saved voice" : "Create MP4"}<ArrowRight size={17}/></button></div>
          <p className="input-note" role="status">{imageDirty ? "Apply image settings and prompt edits first." : needsMoreImages && !settings.fallbackText ? "Replan visuals with Groq first: images must cover more than half the final video." : missing > 0 && !settings.fallbackText ? `Generate ${missing} missing images to unlock MP4, or enable text fallback for a test preview.` : !voiceKey.trim() ? "Add your ElevenLabs key to continue." : settings.fallbackText ? "Test preview selected. Text cards may cover most of this cut." : "Ready for the final cut. Cuts follow actual speech timestamps at 30 fps."}</p>
          </fieldset>
        </section></>}
      </div>
      {(job.frames?.length ?? 0) > 0 && <details className="phase-card" open={comic || job.status === "images"}><summary>Scene gallery + prompt editor · {ready} / {imageCount} ready</summary><div className="frame-gallery">{job.frames?.map(frame => <article className="frame-card" key={frame.chunkIndex}>{frame.imageUrl ? <img src={frame.imageUrl} alt={result.chunks[frame.chunkIndex]?.text} loading="lazy" style={{ aspectRatio: settings.imageAspect === "portrait" ? "9 / 16" : settings.imageAspect === "square" ? "1" : "16 / 9" }}/> : <div className="frame-pending"><span>{String(frame.chunkIndex + 1).padStart(2, "0")}</span><small>Waiting for its close-up</small></div>}<p><strong>{frame.chunkIndex + 1}.</strong> {result.chunks[frame.chunkIndex]?.text}</p><details><summary>View full prompt</summary><p className="prompt-text">{frame.prompt}</p></details><label>Custom scene idea<textarea disabled={locked} rows={2} maxLength={1500} value={prompts[String(frame.chunkIndex)] ?? job.scenePrompts?.[String(frame.chunkIndex)] ?? ""} placeholder="Override this scene’s subject/action; shared style stays applied" onChange={e => setPrompts(p => ({ ...p, [frame.chunkIndex]: e.target.value }))}/></label></article>)}</div></details>}
      <section className="script-panel saved-text"><div role="tablist" aria-label="Saved lesson text">{(["script", "source", "scenes"] as const).map(tab => <button key={tab} role="tab" id={`${job.id}-saved-${tab}`} aria-selected={details === tab} aria-controls={`${job.id}-saved-details`} onClick={() => setDetails(tab)}>{tab === "source" ? "Source text" : tab === "script" ? comic ? "Comic captions" : "Narration script" : "Scene plan"}</button>)}</div><div id={`${job.id}-saved-details`} role="tabpanel" aria-labelledby={`${job.id}-saved-${details}`} className="script-scroll">{details === "source" ? <p>{job.sourceText}</p> : details === "script" ? <p>{result.script}</p> : result.chunks.map(chunk => <div className="scene-row" key={chunk.index}><span className="scene-number">{chunk.index + 1}</span><div><p>{chunk.text}</p><small>{chunk.renderHint === "image" ? `Illustration · ${chunk.imagePrompt ?? chunk.visualFocus}` : `Text card · “${chunk.displayText ?? chunk.text}”`}</small>{!comic && <small>~{chunk.estimatedDurationSeconds.toFixed(1)}s · cuts follow the voiceover</small>}</div></div>)}</div></section>
      <div className="result-actions"><a className="ink-button" href={`/api/lessons/${job.id}/source`}><Download size={16}/>Source text</a><a className="ink-button" href={`/api/lessons/${job.id}/script`}><Download size={16}/>Script text</a><a className="ink-button" href={`/api/lessons/${job.id}/export`}><Download size={16}/>Lesson + images JSON</a><button className="text-link" onClick={onReset}>Make another <Sparkles size={16}/></button></div>
    </>}
    {!result && !running && <button className="ink-button" onClick={onReset}>Start a new lesson</button>}
  </>;
}
