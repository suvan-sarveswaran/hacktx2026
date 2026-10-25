import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateImages } from './images.mjs';
import { validateLesson, synthesizeNarration, renderVideo } from './video.mjs';
import { normalizeProjectLesson, normalizeStyle, styledImagePrompt, baseImagePrompt, digest, DEFAULT_STYLE, imageDimensions, imageVersionKey } from './lesson-images.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = 'black-forest-labs/flux.1-schnell';
export async function createApp({ dataDir = path.join(here, 'data'), generator = generateImages, initialKey = process.env.POLLINATIONS_API_KEY ?? '', voiceGenerator = synthesizeNarration, videoRenderer = renderVideo } = {}) {
  await mkdir(dataDir, { recursive: true });
  const outputDir = path.join(dataDir, 'images');
  const db = new DatabaseSync(path.join(dataDir, 'studio.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY, title TEXT NOT NULL, created TEXT NOT NULL, status TEXT NOT NULL, error TEXT);
    CREATE TABLE IF NOT EXISTS scenes(id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, source_index INTEGER NOT NULL, position INTEGER NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL, file TEXT, error TEXT, cached INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS scene_batch ON scenes(batch_id,position);
    UPDATE batches SET status='interrupted', error='Server restarted. Resume this batch.' WHERE status='running';
    UPDATE scenes SET status='pending' WHERE status='running';
    CREATE TABLE IF NOT EXISTS video_jobs(id TEXT PRIMARY KEY, title TEXT NOT NULL, created TEXT NOT NULL, status TEXT NOT NULL, progress TEXT, error TEXT, settings TEXT NOT NULL, cached INTEGER DEFAULT 0);
    UPDATE video_jobs SET status='interrupted', progress='Server restarted. Retry to reuse saved narration.' WHERE status='running';
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, fingerprint TEXT UNIQUE NOT NULL, title TEXT NOT NULL, lesson TEXT NOT NULL, style TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS project_images(project_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, prompt_hash TEXT NOT NULL, scene_id TEXT NOT NULL, PRIMARY KEY(project_id,chunk_index,prompt_hash));
    CREATE TABLE IF NOT EXISTS project_image_settings(project_id TEXT PRIMARY KEY, aspect TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS batch_image_settings(batch_id TEXT PRIMARY KEY, width INTEGER NOT NULL, height INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS video_audio(job_id TEXT PRIMARY KEY, file TEXT NOT NULL);`);
  let key = initialKey.trim(), active = null, running = null;
  let voiceKey = process.env.ELEVENLABS_API_KEY?.trim() ?? '', activeVideo = null, videoRunning = null;
  const getVideo = id => {
    const row = db.prepare("SELECT id,title,created,status,progress,error,cached,json_extract(settings,'$.projectId') AS projectId FROM video_jobs WHERE id=?").get(id);
    const audio = row ? db.prepare('SELECT file FROM video_audio WHERE job_id=?').get(id) : null;
    return row ? {...row, audioUrl:audio?`/api/video/jobs/${id}/narration.mp3`:null, videoUrl:row.status==='completed'?`/api/video/jobs/${id}/video.mp4`:null,
      timelineUrl:row.status==='completed'?`/api/video/jobs/${id}/timeline.json`:null} : null;
  };
  function startVideo(id) {
    const settings = JSON.parse(db.prepare('SELECT settings FROM video_jobs WHERE id=?').get(id).settings);
    const controller = new AbortController(); activeVideo = {id,controller};
    db.prepare("UPDATE video_jobs SET status='running',progress='Generating narration with timestamps',error=NULL WHERE id=?").run(id);
    const currentVoiceKey = voiceKey;
    const onProgress = message => db.prepare('UPDATE video_jobs SET progress=? WHERE id=?').run(message,id);
    videoRunning = (async()=>{
      try {
        const voice=await voiceGenerator(settings.lesson.script,{apiKey:currentVoiceKey,voiceId:settings.voiceId,model:settings.model,
          cacheDir:path.join(dataDir,'voice-cache'),signal:controller.signal});
        db.prepare('UPDATE video_jobs SET cached=? WHERE id=?').run(voice.cached?1:0,id);
        db.prepare('INSERT OR REPLACE INTO video_audio(job_id,file) VALUES(?,?)').run(id,voice.audioPath);
        if(settings.audioOnly){db.prepare("UPDATE video_jobs SET status='audio-ready',progress='Narration ready. Create the MP4 next; the saved voice will be reused.' WHERE id=?").run(id);return;}
        await videoRenderer({...settings,alignment:voice.alignment,audioPath:voice.audioPath,
          outputDir:path.join(dataDir,'videos',id),signal:controller.signal,onProgress});
        db.prepare("UPDATE video_jobs SET status='completed',progress='MP4 ready' WHERE id=?").run(id);
      } catch(error) {db.prepare('UPDATE video_jobs SET status=?,error=?,progress=? WHERE id=?')
        .run(controller.signal.aborted?'interrupted':'failed',error.message,'Stopped. Saved narration can be reused on retry.',id);}
      finally {activeVideo=null;}
    })();
  }
  const getProject = id => {
    const row = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
    if (!row) return null;
    const lesson = JSON.parse(row.lesson);
    const dimensions=imageDimensions(db.prepare('SELECT aspect FROM project_image_settings WHERE project_id=?').get(id)?.aspect);
    const frames = lesson.chunks.filter(c=>c.renderHint==='image').map(c=>{
      const prompt=styledImagePrompt(lesson,c,row.style), promptHash=imageVersionKey(prompt,dimensions);
      const scene=db.prepare('SELECT s.* FROM project_images p JOIN scenes s ON s.id=p.scene_id WHERE p.project_id=? AND p.chunk_index=? AND p.prompt_hash=?').get(id,c.index,promptHash);
      return {chunkIndex:c.index,prompt,promptHash,basePrompt:baseImagePrompt(lesson,c),status:scene?.status??'missing',sceneId:scene?.id??null,
        batchId:scene?.batch_id??null,imageUrl:scene?.file?`/images/${path.basename(scene.file)}`:null,error:scene?.error??null,cached:Boolean(scene?.cached)};
    });
    return {id:row.id,title:row.title,style:row.style,...dimensions,lesson,frames,created:row.created,updated:row.updated,
      mapping:Object.fromEntries(frames.filter(f=>f.status==='completed').map(f=>[f.chunkIndex,f.sceneId]))};
  };
  const getBatch = id => {
    const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(id);
    if (!batch) return null;
    const scenes = db.prepare('SELECT * FROM scenes WHERE batch_id=? ORDER BY position').all(id).map(s => ({ ...s,
      imageUrl: s.file ? `/images/${path.basename(s.file)}` : null }));
    return { ...batch, scenes };
  };
  const updateScene = (id, index, event) => {
    if (event.type === 'started') db.prepare("UPDATE scenes SET status='running',error=NULL WHERE batch_id=? AND source_index=?").run(id, index);
    if (event.type === 'done') db.prepare("UPDATE scenes SET status='completed',file=?,cached=?,error=NULL WHERE batch_id=? AND source_index=?").run(event.file, event.cached ? 1 : 0, id, index);
    if (event.type === 'failed') db.prepare("UPDATE scenes SET status='failed',error=? WHERE batch_id=? AND source_index=?").run(event.error ?? 'Generation failed', id, index);
  };
  function startBatch(id) {
    const batch = getBatch(id);
    const ordered = [...batch.scenes].sort((a,b) => a.source_index-b.source_index);
    const controller = new AbortController();
    active = { id, controller, progress: 'Starting…' };
    db.prepare("UPDATE batches SET status='running',error=NULL WHERE id=?").run(id);
    const requestKey = key;
    running = (async () => {
      try {
        const result = await generator(ordered.map(s=>s.prompt), {
          apiKey: requestKey, model: MODEL, outDir: outputDir, concurrency: 2,
          ...(db.prepare('SELECT width,height FROM batch_image_settings WHERE batch_id=?').get(id)??{width:1024,height:1024}), minIntervalMs: 1100, signal: controller.signal,
          onProgress: event => {
            if (Number.isInteger(event.index)) updateScene(id, event.index, event);
            if (active) active.progress = event.type === 'retry' ? `Retrying after ${event.status}; waiting ${Math.ceil(event.waitMs/1000)}s` : `${event.type}${event.index === undefined ? '' : ` · image ${event.index+1}`}`;
          },
        });
        result.scenes.forEach((s,index)=>db.prepare('UPDATE scenes SET status=?,file=?,error=?,cached=? WHERE batch_id=? AND source_index=?')
          .run(s.status === 'done' ? 'completed' : s.status, s.file ?? null, s.error ?? null, s.cached ? 1 : 0, id, index));
        const complete = result.succeeded === ordered.length;
        db.prepare('UPDATE batches SET status=?,error=? WHERE id=?').run(complete ? 'completed' : result.stoppedReason ? 'interrupted' : 'partial', result.stoppedReason ?? null, id);
      } catch(error) {
        db.prepare("UPDATE batches SET status='partial',error=? WHERE id=?").run(error.message, id);
        db.prepare("UPDATE scenes SET status='pending' WHERE batch_id=? AND status='running'").run(id);
      } finally { active = null; }
    })();
  }
  function json(res, status, value) {
    res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
    res.end(JSON.stringify(value));
  }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('Use JSON request bodies'), {status:415});
    let text = '';
    for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text)>1024*1024) throw Object.assign(new Error('Request too large'),{status:413}); }
    try { return JSON.parse(text); } catch { throw Object.assign(new Error('Invalid JSON'),{status:400}); }
  }
  const server = http.createServer(async (req,res)=>{
    try {
      const host = req.headers.host ?? '';
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return json(res,403,{error:'Local access only'});
      const origin = `http://${host}`;
      if (req.method !== 'GET' && req.headers.origin !== origin) return json(res,403,{error:'Open the app locally to make changes'});
      const url = new URL(req.url,origin);
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      if(req.method==='GET'&&url.pathname==='/api/projects')return json(res,200,{
        projects:db.prepare('SELECT id,title,created,updated FROM projects ORDER BY updated DESC').all(),
        imageKeyConfigured:Boolean(key),voiceKeyConfigured:Boolean(voiceKey),
        activeImages:active?{id:active.id,progress:active.progress}:null,activeVideo:activeVideo?.id??null,
      });
      if(req.method==='POST'&&url.pathname==='/api/projects'){
        const input=await body(req);let lesson,style,dimensions;
        try{dimensions=imageDimensions(input.imageAspect??input.lesson?.imageAspect);lesson=normalizeProjectLesson(input.lesson);style=normalizeStyle(input.style??input.lesson?.artStyle??DEFAULT_STYLE);lesson.chunks.filter(c=>c.renderHint==='image').forEach(c=>styledImagePrompt(lesson,c,style));}
        catch(error){return json(res,400,{error:error.message});}
        const fingerprint=digest(JSON.stringify(lesson));
        const existing=db.prepare('SELECT id FROM projects WHERE fingerprint=?').get(fingerprint);
        if(existing)return json(res,200,getProject(existing.id));
        const id=randomUUID(),now=new Date().toISOString();
        db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)').run(id,fingerprint,lesson.title,JSON.stringify(lesson),style,now,now);
        db.prepare('INSERT INTO project_image_settings VALUES(?,?)').run(id,dimensions.imageAspect);
        return json(res,201,getProject(id));
      }
      const projectMatch=url.pathname.match(/^\/api\/projects\/([a-f0-9-]+)(?:\/(settings|images|map|export))?$/);
      if(projectMatch){
        const [,id,action]=projectMatch,project=getProject(id);
        if(!project)return json(res,404,{error:'Lesson not found'});
        if(req.method==='GET'&&!action)return json(res,200,project);
        if(req.method==='GET'&&action==='export'){
          res.setHeader('Content-Disposition',`attachment; filename="entertainify-lesson-${id}.json"`);
          return json(res,200,{...project.lesson,artStyle:project.style,imageAspect:project.imageAspect,images:project.frames.map(f=>({...f,imageUrl:f.imageUrl?origin+f.imageUrl:null}))});
        }
        if(req.method==='POST'&&action==='settings'){
          if(active)return json(res,409,{error:'Stop or finish the image batch before editing its style or prompts'});
          const input=await body(req);let lesson,style,dimensions;
          try{dimensions=imageDimensions(input.imageAspect??project.imageAspect);lesson=normalizeProjectLesson(input.lesson??project.lesson);style=normalizeStyle(input.style??project.style);lesson.chunks.filter(c=>c.renderHint==='image').forEach(c=>styledImagePrompt(lesson,c,style));}
          catch(error){return json(res,400,{error:error.message});}
          db.prepare('UPDATE projects SET title=?,lesson=?,style=?,updated=? WHERE id=?').run(lesson.title,JSON.stringify(lesson),style,new Date().toISOString(),id);
          db.prepare('INSERT OR REPLACE INTO project_image_settings VALUES(?,?)').run(id,dimensions.imageAspect);
          return json(res,200,getProject(id));
        }
        if(req.method==='POST'&&action==='map'){
          const input=await body(req),entries=Object.entries(input.mapping??{});
          for(const [index,sceneId]of entries){
            const frame=project.frames.find(f=>f.chunkIndex===Number(index));
            if(!frame||!db.prepare("SELECT id FROM scenes WHERE id=? AND status='completed'").get(sceneId))return json(res,400,{error:`Invalid image mapping for chunk ${index}`});
          }
          for(const [index,sceneId]of entries){const frame=project.frames.find(f=>f.chunkIndex===Number(index));db.prepare('INSERT OR REPLACE INTO project_images VALUES(?,?,?,?)').run(id,Number(index),frame.promptHash,sceneId);}
          return json(res,200,getProject(id));
        }
        if(req.method==='POST'&&action==='images'){
          if(active)return json(res,409,{error:'Wait for the current image batch or stop it first'});
          if(!key)return json(res,400,{error:'Connect your Pollinations key on this page first'});
          const input=await body(req),eligible=project.frames.filter(f=>f.status!=='completed');
          let chosen;
          if(input.indices!==undefined){
            if(!Array.isArray(input.indices)||!input.indices.length||new Set(input.indices).size!==input.indices.length||input.indices.some(i=>!Number.isInteger(i)||!project.frames.some(f=>f.chunkIndex===i)))return json(res,400,{error:'Choose valid unique image chunk indexes'});
            chosen=project.frames.filter(f=>input.indices.includes(f.chunkIndex));
          }else if(input.mode==='all')chosen=eligible;
          else{const count=input.mode==='one'?1:input.count??5;if(!Number.isInteger(count)||count<1||count>1000)return json(res,400,{error:'Choose 1–1,000 images'});chosen=eligible.slice(0,count);}
          if(!chosen.length)return json(res,200,{project,alreadyComplete:true});
          const batchId=randomUUID();db.exec('BEGIN');
          try{
            db.prepare('INSERT INTO batches VALUES(?,?,?,?,NULL)').run(batchId,`${project.title.slice(0,65)} · ${chosen.length} lesson images`,new Date().toISOString(),'pending');
            db.prepare('INSERT INTO batch_image_settings VALUES(?,?,?)').run(batchId,project.width,project.height);
            chosen.forEach((frame,index)=>{const sceneId=randomUUID();db.prepare('INSERT INTO scenes(id,batch_id,source_index,position,prompt,status) VALUES(?,?,?,?,?,?)').run(sceneId,batchId,index,index,frame.prompt,'pending');db.prepare('INSERT OR REPLACE INTO project_images VALUES(?,?,?,?)').run(id,frame.chunkIndex,frame.promptHash,sceneId);});
            db.exec('COMMIT');
          }catch(error){db.exec('ROLLBACK');throw error;}
          startBatch(batchId);return json(res,202,{batchId,count:chosen.length,estimatedPollen:chosen.length*.002,project:getProject(id)});
        }
      }
      if(req.method==='GET' && url.pathname==='/api/video/state') return json(res,200,{
        keyConfigured:Boolean(voiceKey),active:activeVideo?.id??null,
        jobs:db.prepare('SELECT id FROM video_jobs ORDER BY created DESC LIMIT 30').all().map(v=>getVideo(v.id)),
        batches:db.prepare('SELECT id,title FROM batches ORDER BY created DESC').all().map(b=>({...b,
          scenes:db.prepare("SELECT id,source_index,position,prompt,file FROM scenes WHERE batch_id=? AND status='completed' ORDER BY position").all(b.id)
            .map(s=>({...s,imageUrl:`/images/${path.basename(s.file)}`}))})),
      });
      if(req.method==='POST' && url.pathname==='/api/video/key') {
        const input=await body(req);
        if(typeof input.key!=='string'||!/^[\S]{10,}$/.test(input.key.trim())) return json(res,400,{error:'Enter your ElevenLabs API key'});
        voiceKey=input.key.trim();return json(res,200,{ok:true});
      }
      if(req.method==='GET' && url.pathname==='/api/video/voices') {
        if(!voiceKey)return json(res,400,{error:'Connect your ElevenLabs key first'});
        const response=await fetch('https://api.elevenlabs.io/v1/voices',{headers:{'xi-api-key':voiceKey},signal:AbortSignal.timeout(30000),redirect:'error'});
        if(!response.ok)return json(res,400,{error:`ElevenLabs voice list returned HTTP ${response.status}. Check key permissions and account access.`});
        const result=await response.json();return json(res,200,{voices:(result.voices??[]).map(v=>({voiceId:v.voice_id,name:v.name,category:v.category}))});
      }
      if(req.method==='POST' && url.pathname==='/api/video/jobs') {
        if(activeVideo)return json(res,409,{error:'A video is already rendering'});
        const input=await body(req);let lesson;
        const linkedProject=input.projectId?getProject(input.projectId):null;
        if(input.projectId&&!linkedProject)return json(res,404,{error:'Lesson not found'});
        try{lesson=validateLesson(linkedProject?.lesson??input.lesson);}catch(error){return json(res,400,{error:error.message});}
        if(input.scriptText!==undefined&&input.scriptText!==lesson.script)return json(res,400,{error:'The separate script file differs from lesson.script. Use the exact original script, including whitespace.'});
        if(!voiceKey)return json(res,400,{error:'Connect an ElevenLabs key first'});
        if(typeof input.voiceId!=='string'||!/^[a-zA-Z0-9_-]{5,100}$/.test(input.voiceId))return json(res,400,{error:'Choose a valid voice ID'});
        if(!['eleven_flash_v2_5','eleven_multilingual_v2'].includes(input.model))return json(res,400,{error:'Choose an available narration model'});
        const format={'landscape':[1280,720],'portrait':[720,1280],'square':[1024,1024]}[input.format??'landscape'];
        if(!format)return json(res,400,{error:'Invalid video format'});
        const mapping={};
        for(const c of lesson.chunks){
          const sceneId=(linkedProject?.mapping??input.mapping)?.[c.index];if(!sceneId)continue;
          const scene=db.prepare("SELECT file FROM scenes WHERE id=? AND status='completed'").get(sceneId);
          if(!scene?.file)return json(res,400,{error:`Chunk ${c.index}: mapped image is unavailable`});
          mapping[c.index]=path.join(outputDir,scene.file);
          try{await stat(mapping[c.index]);}catch{return json(res,400,{error:`Chunk ${c.index}: saved image file is missing`});}
        }
        const missing=lesson.chunks.filter(c=>c.renderHint==='image'&&!mapping[c.index]);
        if(missing.length&&!input.fallbackText&&!input.audioOnly)return json(res,400,{error:`${missing.length} image chunks are missing. Generate them first or explicitly enable text fallback.`});
        const id=randomUUID(),settings={lesson,mapping,fallbackText:Boolean(input.fallbackText),cutMode:'chunk',voiceId:input.voiceId,
          model:input.model,width:format[0],height:format[1],fps:30,audioOnly:Boolean(input.audioOnly),projectId:input.projectId??null};
        db.prepare('INSERT INTO video_jobs(id,title,created,status,settings) VALUES(?,?,?,?,?)').run(id,lesson.title,new Date().toISOString(),'pending',JSON.stringify(settings));
        startVideo(id);return json(res,202,{id});
      }
      const videoMatch=url.pathname.match(/^\/api\/video\/jobs\/([a-f0-9-]+)(?:\/(retry|stop|video\.mp4|timeline\.json|narration\.mp3))?$/);
      if(videoMatch){
        const [,id,action]=videoMatch,job=getVideo(id);if(!job)return json(res,404,{error:'Video job not found'});
        if(req.method==='GET'&&!action)return json(res,200,job);
        if(req.method==='POST'&&action==='retry'){await body(req);if(activeVideo)return json(res,409,{error:'A video is already rendering'});startVideo(id);return json(res,202,{ok:true});}
        if(req.method==='POST'&&action==='stop'){await body(req);if(activeVideo?.id===id)activeVideo.controller.abort();return json(res,200,{ok:true});}
        if(req.method==='GET'&&['video.mp4','timeline.json','narration.mp3'].includes(action)){
          const audio=action==='narration.mp3'?db.prepare('SELECT file FROM video_audio WHERE job_id=?').get(id):null;
          if(action==='narration.mp3'?!audio:job.status!=='completed')return json(res,409,{error:'Output not ready'});
          const file=audio?.file??path.join(dataDir,'videos',id,action);
          if(action==='timeline.json'){res.setHeader('Content-Disposition',`attachment; filename="timeline-${id}.json"`);return json(res,200,JSON.parse(await readFile(file,'utf8')));}
          const info=await stat(file),range=req.headers.range;
          const headers={'Content-Type':audio?'audio/mpeg':'video/mp4','Accept-Ranges':'bytes'};
          if(url.searchParams.has('download'))headers['Content-Disposition']=`attachment; filename="entertainify-${id}.${audio?'mp3':'mp4'}"`;
          if(range){const m=range.match(/^bytes=(\d+)-(\d*)$/);if(!m)return json(res,416,{error:'Unsupported range'});
            const start=Number(m[1]),end=m[2]?Math.min(Number(m[2]),info.size-1):info.size-1;
            if(start>end||start>=info.size)return json(res,416,{error:'Range outside file'});
            res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${info.size}`,'Content-Length':end-start+1});createReadStream(file,{start,end}).pipe(res);
          }else{res.writeHead(200,{...headers,'Content-Length':info.size});createReadStream(file).pipe(res);}return;
        }
      }
      if (req.method==='GET' && url.pathname==='/api/state') return json(res,200,{
        keyConfigured:Boolean(key), model:MODEL, estimatedPollenPerImage:0.002,
        active:active ? {id:active.id,progress:active.progress} : null,
        batches:db.prepare('SELECT b.*, (SELECT count(*) FROM scenes s WHERE s.batch_id=b.id) AS count FROM batches b ORDER BY created DESC').all(),
      });
      if(req.method==='POST' && url.pathname==='/api/key') {
        const input=await body(req);
        if(typeof input.key!=='string' || !/^sk_\S{8,}$/.test(input.key.trim())) return json(res,400,{error:'Enter a valid secret key beginning sk_'});
        key=input.key.trim(); return json(res,200,{ok:true});
      }
      if(req.method==='POST' && url.pathname==='/api/batches') {
        if(active) return json(res,409,{error:'Wait for the current batch or stop it first'});
        if(!key) return json(res,400,{error:'Connect your Pollinations key first'});
        const input=await body(req);
        if(!Array.isArray(input.prompts) || input.prompts.length<1 || input.prompts.length>200 || input.prompts.some(p=>typeof p!=='string'||!p.trim()||p.length>4000)) return json(res,400,{error:'Provide 1–200 nonempty prompts, each up to 4,000 characters'});
        const id=randomUUID();
        db.exec('BEGIN');
        try {
          db.prepare('INSERT INTO batches VALUES(?,?,?,?,NULL)').run(id,typeof input.title==='string' ? input.title.slice(0,100) : `${input.prompts.length}-image test`,new Date().toISOString(),'pending');
          input.prompts.forEach((prompt,index)=>db.prepare('INSERT INTO scenes(id,batch_id,source_index,position,prompt,status) VALUES(?,?,?,?,?,?)').run(randomUUID(),id,index,index,prompt.trim(),'pending'));
          db.exec('COMMIT');
        } catch(error) { db.exec('ROLLBACK'); throw error; }
        startBatch(id); return json(res,202,{id});
      }
      const match=url.pathname.match(/^\/api\/batches\/([a-f0-9-]+)(?:\/(resume|stop|order|export))?$/);
      if(match) {
        const [,id,action]=match, batch=getBatch(id);
        if(!batch) return json(res,404,{error:'Batch not found'});
        if(req.method==='GET' && !action) return json(res,200,batch);
        if(req.method==='GET' && action==='export') {
          res.setHeader('Content-Disposition',`attachment; filename="entertainify-${id}.json"`);
          return json(res,200,{version:1,batchId:id,model:MODEL,ready:batch.scenes.every(s=>s.status==='completed'),
            scenes:batch.scenes.map(s=>({sceneId:s.id,index:s.position,sourceIndex:s.source_index,prompt:s.prompt,status:s.status,
              imageUrl:s.imageUrl ? origin+s.imageUrl : null,localPath:s.file ? path.join(outputDir,s.file) : null}))});
        }
        if(req.method==='POST' && action==='resume') {
          await body(req);
          if(active) return json(res,409,{error:'Another batch is running'});
          if(!key) return json(res,400,{error:'Connect your key first'});
          startBatch(id); return json(res,202,{ok:true});
        }
        if(req.method==='POST' && action==='stop') {
          await body(req); if(active?.id===id) active.controller.abort(new Error('Stopped by user'));
          return json(res,200,{ok:true});
        }
        if(req.method==='POST' && action==='order') {
          const input=await body(req), ids=input.ids;
          if(!Array.isArray(ids)||ids.length!==batch.scenes.length||new Set(ids).size!==ids.length||ids.some(v=>!batch.scenes.some(s=>s.id===v))) return json(res,400,{error:'Order must include every scene exactly once'});
          db.exec('BEGIN');
          try { ids.forEach((sceneId,index)=>db.prepare('UPDATE scenes SET position=? WHERE id=? AND batch_id=?').run(index,sceneId,id)); db.exec('COMMIT'); }
          catch(error) {db.exec('ROLLBACK');throw error;}
          return json(res,200,{ok:true});
        }
      }
      if(req.method==='GET' && /^\/images\/[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(url.pathname)) {
        const file=path.basename(url.pathname), bytes=await readFile(path.join(outputDir,'assets',file));
        res.writeHead(200,{'Content-Type':{'png':'image/png','jpg':'image/jpeg','webp':'image/webp','gif':'image/gif'}[file.split('.').at(-1)],'Cache-Control':'public,max-age=31536000,immutable'});return res.end(bytes);
      }
      const assets={'/':['video.html','text/html; charset=utf-8'],'/images-only':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],
        '/video':['video.html','text/html; charset=utf-8'],'/video.js':['video.js','text/javascript; charset=utf-8'],'/video.css':['video.css','text/css; charset=utf-8'],
        '/example-lesson.json':['example-lesson.json','application/json; charset=utf-8']};
      if(req.method==='GET' && assets[url.pathname]) {
        const [file,type]=assets[url.pathname];res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'});return res.end(await readFile(path.join(here,'archive','public',file)));
      }
      json(res,404,{error:'Not found'});
    } catch(error) {json(res,error.status ?? (error.code==='ENOENT'?404:500),{error:error.code==='ENOENT'?'File not found':error.message});}
  });
  return {server, async close(){active?.controller.abort(new Error('Server stopping'));activeVideo?.controller.abort(); await Promise.allSettled([running,videoRunning]); await new Promise(resolve=>server.close(resolve));db.close();}};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=await createApp();
  const port=Number(process.env.PORT ?? 4317);
  app.server.listen(port,'127.0.0.1',()=>console.log(`Entertainify Studio: http://127.0.0.1:${port}`));
  app.server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  for(const event of ['SIGINT','SIGTERM']) process.once(event,()=>app.close().then(()=>process.exit()));
}
