import { independentSceneBrief } from './scene-briefs.mjs';
// A deliberately local planning pass: no provider SDK, fetch, or paid calls.
const FILLER = new Set(('imagine keeps keep own while hope hoped hoping prove proves showed show shows followed follow follows ' +
  'all back far liked like combine combines display displays quirk ignored ignore ignores actually somehow ' +
  'need needs want wants seem seems get gets give gives take takes use uses help helps thing things ' +
  'idea ideas reason reasons way ways difference differences importance possibility possibilities knowledge meaning purpose aspect aspects information something anything everything nothing time minute minutes percent').split(' '));
const MODIFIERS = new Set('gigantic tiny huge massive small large strong cold hot positive radioactive nuclear spinning routine rushed catastrophic different similar important possible necessary main overall'.split(' '));
const VISUAL_ATTRIBUTES = new Set('gigantic tiny huge massive small large strong cold hot positive radioactive nuclear spinning rushed'.split(' '));
const CONNECTORS = new Set('a an the and or but if then so to of for from in on at by with as is are was were be been being it its they their this that these those you your we our he she his her not'.split(' '));
const SHOTS = ['Close-up with one clear focal subject', 'Side-view explanatory diagram', 'Medium shot showing the action', 'Cutaway view showing the relevant parts'];
const normal = text => text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu,' ').trim().replace(/\s+/gu,' ');

export function sentenceContexts(script) {
  const segmenter=new Intl.Segmenter('en',{granularity:'sentence'});
  return Array.from(segmenter.segment(script),s=>({start:s.index,end:s.index+s.segment.length,text:s.segment.trim()}));
}

function contextFor(lesson,chunk,sentences) {
  const at=Math.max(0,sentences.findIndex(s=>chunk.startOffset<s.end && chunk.endOffset>s.start));
  const sentence=sentences[at];
  // Clip around the focal beat, rather than silently losing the end of a long sentence.
  const relative=Math.max(0,chunk.startOffset-(sentence?.start??0));
  const windowStart=Math.max(0,relative-300);
  return {sentence:sentence?.text.slice(windowStart,windowStart+900)??chunk.text,
    previousSentence:sentences[at-1]?.text.slice(-400)??'',
    shot:SHOTS[chunk.index%SHOTS.length],generatedBy:'local-storyboard-v3'};
}

function depictedSubject(lesson,chunk) {
  const focus=chunk.visualFocus?.trim()||chunk.text;
  if(!VISUAL_ATTRIBUTES.has(normal(focus)))return focus;
  const sentence=sentenceContexts(lesson.script).find(s=>chunk.startOffset<s.end&&chunk.endOffset>s.start);
  for(const direction of [1,-1])for(let distance=1;distance<=3;distance++){
    const n=lesson.chunks[chunk.index+direction*distance];
    if(!n||!sentence||n.startOffset>=sentence.end||n.endOffset<=sentence.start)break;
    const subject=focalPhrase(n),normalized=normal(subject);
    if(MODIFIERS.has(normalized))continue;
    if(normalized&&!fillerScore({...n,visualFocus:subject}))return `${focus} ${subject}`;
    break;
  }
  return focus;
}

export function contextualImagePrompt(lesson,chunk,context) {
  const c=context??contextFor(lesson,chunk,sentenceContexts(lesson.script));
  const focus=chunk.visualFocus?.trim()||chunk.text;
  const subject=depictedSubject(lesson,chunk);
  const brief=independentSceneBrief(subject,c.sentence,chunk.index);
  return `${brief.description}\nFOCAL SUBJECT: ${subject}. Spoken emphasis: ${focus}.\n${brief.composition}\n`+
    'Create one independent educational image. Share only the art direction: palette, medium, linework and lighting. '+
    'Use a composition and subject appropriate to this beat, with no recurring setting, character identity or background required. '+
    'Prioritize the focal object over any broader lesson theme. Do not draw captions, subtitles, labels or field names.';
}

export function fillerScore(chunk) {
  const focus=normal(chunk.visualFocus||chunk.text);
  if(FILLER.has(focus))return 100;
  if(MODIFIERS.has(focus))return 60;
  if(/^(?:\d+|six|forty[\s-]?five|tens|thousands|seconds)$/u.test(focus))return 80;
  return 0;
}

function isAutomatic(chunk) {
  if(chunk.sceneContext?.generatedBy&&!/^local-storyboard-v[123]$/u.test(chunk.sceneContext.generatedBy))return false;
  return /^local-storyboard-v[123]$/u.test(chunk.sceneContext?.generatedBy??'') ||
    chunk.renderReason?.startsWith('Local storyboard:');
}

function focalPhrase(chunk) {
  if(typeof chunk.sceneContext?.originalFocus==='string')return chunk.sceneContext.originalFocus;
  if(chunk.visualFocus?.trim())return chunk.visualFocus.trim();
  // Earlier automatic text cards cleared visualFocus; recover it from the exact beat.
  const words=normal(chunk.text).split(' ').filter(w=>w&&!CONNECTORS.has(w));
  const specific=words.filter(w=>!FILLER.has(w));
  return (specific.length?specific:words).join(' ');
}

function textDecision(lesson,chunk,sentences) {
  const focus=focalPhrase(chunk),normalized=normal(focus);
  if(!normalized)return {text:true,focus,reason:'Connecting words without an independent visual subject.'};
  const score=fillerScore({...chunk,visualFocus:focus});
  if(!score)return {text:false,focus};
  if(VISUAL_ATTRIBUTES.has(normalized)) {
    // Keep a meaningful attribute with a nearby concrete subject in the same sentence:
    // "cold | water", "tiny | green | leaf", "water is | hot", "positive | charge".
    const sentence=sentences.find(s=>chunk.startOffset<s.end&&chunk.endOffset>s.start);
    for(const direction of [1,-1]) {
      for(let distance=1;distance<=3;distance++) {
        const neighbor=lesson.chunks[chunk.index+direction*distance];
        if(!neighbor||!sentence||neighbor.startOffset>=sentence.end||neighbor.endOffset<=sentence.start)break;
        const neighborFocus=normal(focalPhrase(neighbor));
        if(MODIFIERS.has(neighborFocus))continue;
        if(neighborFocus&&!fillerScore({...neighbor,visualFocus:neighborFocus}))return {text:false,focus};
        break;
      }
    }
  }
  return {text:true,focus,reason:score===80?'An isolated quantity is clearer as typography.':
    'A connector, vague action or unsupported modifier adds no independent visual subject.'};
}

export function buildStoryboard(lesson) {
  if(!lesson || typeof lesson.script!=='string' || !Array.isArray(lesson.chunks))throw new Error('A script and ordered chunks are required for a storyboard.');
  const sentences=sentenceContexts(lesson.script);
  const chunks=lesson.chunks.map(c=>{
    const automatic=isAutomatic(c),hasPrompt=c.imagePrompt||c.image_prompt||c.prompt;
    if(c.renderHint==='skip'||(!automatic&&(c.renderHint==='text'||hasPrompt)))return {...c};
    const decision=textDecision(lesson,c,sentences);
    if(decision.text) {
      const clean={...c};delete clean.imagePrompt;
      return {...clean,renderHint:'text',visualFocus:null,
        sceneContext:{...contextFor(lesson,c,sentences),originalFocus:decision.focus},
        renderReason:`Local storyboard: ${decision.reason}`};
    }
    // Reusing an unchanged automatic image prompt preserves its image-cache version.
    if(c.renderHint==='image'&&hasPrompt&&c.sceneContext?.generatedBy==='local-storyboard-v3')return {...c};
    const sceneContext=contextFor(lesson,c,sentences);
    const restored={...c,visualFocus:decision.focus||c.text};
    sceneContext.shot=independentSceneBrief(depictedSubject(lesson,restored),sceneContext.sentence,c.index).composition;
    return {...restored,renderHint:'image',imagePrompt:contextualImagePrompt(lesson,restored,sceneContext),sceneContext,
      renderReason:'Local storyboard: depict this focal subject independently; context only disambiguates its meaning.'};
  });
  const textChunks=chunks.filter(c=>c.renderHint==='text').length;
  return {...lesson,chunks,metadata:{...lesson.metadata,storyboard:{version:3,method:'local-subject-first',apiCalls:0,
    imageChunks:chunks.filter(c=>c.renderHint==='image').length,textChunks,
    textRatio:Number((textChunks/Math.max(1,chunks.length)).toFixed(4)),textSelection:'contextual-significance',scenePolicy:'independent-content-shared-style'}}};
}
