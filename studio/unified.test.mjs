import { buildStoryboard } from './storyboard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from './server.mjs';
import { generateImages } from './images.mjs';
import { synthesizeNarration } from './video.mjs';
import { normalizeProjectLesson, styledImagePrompt } from './lesson-images.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
function fixtureLesson(){const parts=['Leaf.','First,','Light.','Water.','Next,','Air.','Sugar.'];let offset=0;return {title:'Test biology',script:parts.join(' '),chunks:parts.map((text,index)=>{const startOffset=offset;offset+=text.length+1;return {index,text,startOffset,endOffset:startOffset+text.length,renderHint:[1,4].includes(index)?'text':'image',visualFocus:text.replace(/[.,]/g,''),...(index===0?{image_prompt:'A little leaf holding a spoon.'}:{})};})};}
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`;}
async function json(base,url,data){const response=await fetch(base+url,data===undefined?{}:{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:response.status,body:await response.json()};}
async function until(read,check){for(let i=0;i<300;i++){const value=await read();if(check(value))return value;await delay(15);}throw new Error('Test timed out');}
test('prompt aliases preserve upstream prompts; fallback uses focus, context and shared style',()=>{
 const lesson=normalizeProjectLesson(fixtureLesson());assert.equal(lesson.chunks[0].imagePrompt,'A little leaf holding a spoon.');
 assert.match(styledImagePrompt(lesson,lesson.chunks[0],'Purple pencil'),/spoon.*\n\nART DIRECTION/s);
 const fallback=styledImagePrompt(lesson,lesson.chunks[2],'Purple pencil');assert.match(fallback,/Light/);assert.match(fallback,/First,/);assert.match(fallback,/Purple pencil/);
 assert.throws(()=>normalizeProjectLesson({...fixtureLesson(),script:'mismatch'}),/offsets/);
});
test('custom lesson and chunk metadata survive normalization and are included with explicit prompts',()=>{
 const input=fixtureLesson();input.visualRequirements={palette:['purple','cream'],character:'same leaf with round glasses'};
 input.metadata={generationMs:999,visualRules:{camera:'front view'}};
 Object.assign(input.chunks[0],{renderReason:'Show the leaf as a tiny kitchen',requirements:{mustInclude:['spoon','green apron'],mustAvoid:['photorealism']},layout:'subject centered, empty space on right',sceneContext:{mustInclude:'blue wrench'}});
 const lesson=normalizeProjectLesson(input);assert.deepEqual(lesson.visualRequirements,input.visualRequirements);assert.deepEqual(lesson.chunks[0].requirements,input.chunks[0].requirements);
 assert.equal(lesson.chunks[0].renderReason,input.chunks[0].renderReason);
 const prompt=styledImagePrompt(lesson,lesson.chunks[0],'Purple pencil');
 for(const required of ['tiny kitchen','green apron','photorealism','empty space on right','round glasses','front view','spoon','blue wrench'])assert.ok(prompt.includes(required),required);
 assert.ok(!prompt.includes('generationMs'));
 lesson.chunks[0].requirements={veryLong:'x'.repeat(5000)};
 assert.throws(()=>styledImagePrompt(lesson,lesson.chunks[0],'Purple pencil'),/never silently truncated/);
});
test('one JSON → one/few/all styled images → cached audio → MP4; persistent chunk mapping and style versions',async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'entertainify-unified-'));let imageCalls=0,voiceCalls=0,renderCalls=0;const prompts=[];
 const provider=http.createServer((req,res)=>{imageCalls++;const url=new URL(req.url,'http://localhost');prompts.push(decodeURIComponent(url.pathname.slice('/image/'.length)));res.writeHead(200,{'Content-Type':'image/png'});res.end(png);});
 const upstream=await listen(provider);
 const voiceFetch=async(url,options)=>{voiceCalls++;const script=JSON.parse(options.body).text;return Response.json({audio_base64:Buffer.from('mock mp3').toString('base64'),alignment:{characters:Array.from(script),character_start_times_seconds:Array.from(script,(_,i)=>i*.01),character_end_times_seconds:Array.from(script,(_,i)=>(i+1)*.01)}});};
 const options={dataDir,initialKey:'sk_mock_secret',generator:(prompts,options)=>generateImages(prompts,{...options,baseUrl:upstream,minIntervalMs:1,retryBaseMs:1}),
  voiceGenerator:(script,options)=>synthesizeNarration(script,{...options,fetchImpl:voiceFetch}),videoRenderer:async options=>{renderCalls++;assert.deepEqual(Object.keys(options.mapping).map(Number),[0,2,3,5,6]);assert.equal(options.lesson.script,fixtureLesson().script);await mkdir(options.outputDir,{recursive:true});await writeFile(path.join(options.outputDir,'video.mp4'),png);await writeFile(path.join(options.outputDir,'timeline.json'),'{}');}};
 let app=await createApp(options),base=await listen(app.server);
 t.after(async()=>{await app.close();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));await rm(dataDir,{recursive:true,force:true});});
 assert.match(await (await fetch(base)).text(),/Generate your lesson images/);
 const created=await json(base,'/api/projects',{lesson:fixtureLesson(),style:'Purple pencil'});assert.equal(created.status,201);const id=created.body.id;
 assert.equal(created.body.frames.length,5);assert.equal(imageCalls,0);
 const lessonSnapshot=path.join(dataDir,'lessons',`${id}.json`);
 const savedUpload=JSON.parse(await readFile(lessonSnapshot,'utf8'));assert.equal(savedUpload.script,fixtureLesson().script);assert.equal(savedUpload.artStyle,'Purple pencil');assert.equal(created.body.lessonFile,`data/lessons/${id}.json`);
 const get=async()=>(await json(base,`/api/projects/${id}`)).body;
 async function generate(payload){const result=await json(base,`/api/projects/${id}/images`,payload);assert.equal(result.status,202);await until(async()=>(await json(base,`/api/batches/${result.body.batchId}`)).body,b=>b.status!=='running');return result.body;}
 assert.equal((await generate({mode:'one'})).count,1);let project=await get();assert.deepEqual(project.frames.filter(f=>f.status==='completed').map(f=>f.chunkIndex),[0]);
 assert.equal((await generate({mode:'few',count:2})).count,2);project=await get();assert.deepEqual(project.frames.filter(f=>f.status==='completed').map(f=>f.chunkIndex),[0,2,3]);
 assert.equal((await generate({mode:'all'})).count,2);project=await get();assert.equal(Object.keys(project.mapping).length,5);assert.equal(imageCalls,5);assert.ok(prompts.every(p=>p.includes('Purple pencil')));
 const originalIds={...project.mapping};assert.equal((await json(base,`/api/projects/${id}/images`,{mode:'all'})).body.alreadyComplete,true);assert.equal(imageCalls,5);
 await json(base,`/api/projects/${id}/settings`,{style:'Blue watercolor'});assert.equal(Object.keys((await get()).mapping).length,0);
 await json(base,'/api/video/key',{key:'test_voice_key'});
 const output={projectId:id,voiceId:'testvoice',model:'eleven_flash_v2_5',format:'landscape'};
 assert.equal((await json(base,'/api/video/jobs',output)).status,400);assert.equal(voiceCalls,0);
 await json(base,`/api/projects/${id}/settings`,{style:'Purple pencil'});project=await get();assert.deepEqual(project.mapping,originalIds);assert.equal(imageCalls,5);
 const audio=await json(base,'/api/video/jobs',{...output,audioOnly:true});assert.equal(audio.status,202);
 const audioJob=await until(async()=>(await json(base,`/api/video/jobs/${audio.body.id}`)).body,j=>j.status!=='running');assert.equal(audioJob.status,'audio-ready');assert.equal(voiceCalls,1);assert.equal(renderCalls,0);
 assert.equal((await fetch(base+audioJob.audioUrl)).headers.get('content-type'),'audio/mpeg');
 const video=await json(base,'/api/video/jobs',output);assert.equal(video.status,202);
 const videoJob=await until(async()=>(await json(base,`/api/video/jobs/${video.body.id}`)).body,j=>j.status!=='running');assert.equal(videoJob.status,'completed');assert.equal(voiceCalls,1);assert.equal(renderCalls,1);assert.equal(videoJob.cached,1);
 const exported=(await json(base,`/api/projects/${id}/export`)).body;assert.equal(exported.artStyle,'Purple pencil');assert.equal(exported.images.length,5);assert.equal(exported.chunks[0].imagePrompt,'A little leaf holding a spoon.');
 const edited=structuredClone(project.lesson);edited.visualRequirements={palette:'purple'};edited.chunks[0].requirements={mustInclude:'striped apron'};
 const update=await json(base,`/api/projects/${id}/settings`,{lesson:edited});assert.equal(update.status,200);assert.deepEqual(update.body.lesson.chunks[0].requirements,{mustInclude:'striped apron'});assert.ok(update.body.frames[0].prompt.includes('striped apron'));
 const savedEdit=JSON.parse(await readFile(lessonSnapshot,'utf8'));assert.deepEqual(savedEdit.chunks[0].requirements,{mustInclude:'striped apron'});assert.deepEqual(savedEdit.visualRequirements,{palette:'purple'});
 const invalid=structuredClone(edited);invalid.chunks[0].startOffset=999;
 assert.equal((await json(base,`/api/projects/${id}/settings`,{lesson:invalid})).status,400);assert.deepEqual((await get()).lesson.chunks[0].requirements,{mustInclude:'striped apron'});assert.deepEqual(JSON.parse(await readFile(lessonSnapshot,'utf8')),savedEdit);
 await json(base,`/api/projects/${id}/settings`,{lesson:project.lesson});
 await app.close();app=await createApp(options);base=await listen(app.server);assert.deepEqual((await get()).mapping,originalIds);assert.equal((await json(base,'/api/projects')).body.projects.length,1);
 const reopened=await json(base,'/api/projects',{lesson:fixtureLesson()});assert.equal(reopened.body.id,id);assert.equal(imageCalls,5);
});


test('image ratios reach the provider, select separate versions, survive restart and restore square images',async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'entertainify-ratios-')),dimensions=[];
 const provider=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');dimensions.push([u.searchParams.get('width'),u.searchParams.get('height')]);res.writeHead(200,{'Content-Type':'image/png'});res.end(png);});
 const upstream=await listen(provider);
 const options={dataDir,initialKey:'sk_mock_secret',generator:(prompts,options)=>generateImages(prompts,{...options,baseUrl:upstream,minIntervalMs:1})};
 let app=await createApp(options),base=await listen(app.server);
 t.after(async()=>{await app.close();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));await rm(dataDir,{recursive:true,force:true});});
 const created=await json(base,'/api/projects',{lesson:fixtureLesson()});const id=created.body.id;
 const get=async()=>(await json(base,`/api/projects/${id}`)).body;
 async function one(){const r=await json(base,`/api/projects/${id}/images`,{mode:'one'});assert.equal(r.status,202);await until(async()=>(await json(base,`/api/batches/${r.body.batchId}`)).body,b=>b.status!=='running');return get();}
 const square=await one();assert.equal(square.imageAspect,'square');assert.deepEqual(dimensions,[['1024','1024']]);
 const landscape=await json(base,`/api/projects/${id}/settings`,{imageAspect:'landscape'});assert.equal(landscape.status,200);assert.equal(landscape.body.width,1280);assert.equal(landscape.body.height,720);assert.equal(landscape.body.frames[0].status,'missing');assert.equal(landscape.body.frames[0].prompt,square.frames[0].prompt);
 const wide=await one();assert.deepEqual(dimensions,[['1024','1024'],['1280','720']]);assert.notEqual(wide.frames[0].sceneId,square.frames[0].sceneId);
 assert.equal((await json(base,`/api/projects/${id}/settings`,{imageAspect:'invalid'})).status,400);assert.equal((await get()).imageAspect,'landscape');
 assert.equal((await json(base,`/api/projects/${id}/export`)).body.imageAspect,'landscape');
 await app.close();app=await createApp(options);base=await listen(app.server);assert.equal((await get()).imageAspect,'landscape');assert.equal((await get()).frames[0].sceneId,wide.frames[0].sceneId);
 await json(base,`/api/projects/${id}/settings`,{imageAspect:'square'});assert.equal((await get()).frames[0].sceneId,square.frames[0].sceneId);assert.equal(dimensions.length,2);
});


test('storyboard preview is free and nonmutating; applying saves planned prompts and metadata in both stores',async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'entertainify-storyboard-'));let calls=0;
 const app=await createApp({dataDir,generator:async()=>{calls++;throw new Error('Unexpected image call');},voiceGenerator:async()=>{calls++;throw new Error('Unexpected voice call');}}),base=await listen(app.server);
 t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
 const created=(await json(base,'/api/projects',{lesson:fixtureLesson()})).body,id=created.id;
 const snapshot=path.join(dataDir,'lessons',`${id}.json`),before=await readFile(snapshot,'utf8');
 const preview=await json(base,`/api/projects/${id}/storyboard`,{lesson:created.lesson});assert.equal(preview.status,200);assert.equal(preview.body.summary.apiCalls,0);assert.equal(calls,0);
 assert.equal(preview.body.lesson.script,created.lesson.script);assert.equal(preview.body.lesson.chunks[0].imagePrompt,created.lesson.chunks[0].imagePrompt);
 assert.ok(preview.body.lesson.chunks[2].imagePrompt.includes('FOCAL SUBJECT:'));
 assert.equal(await readFile(snapshot,'utf8'),before);assert.deepEqual((await json(base,`/api/projects/${id}`)).body.lesson,created.lesson);
 const applied=await json(base,`/api/projects/${id}/settings`,{lesson:preview.body.lesson});assert.equal(applied.status,200);
 assert.deepEqual(JSON.parse(await readFile(snapshot,'utf8')).chunks,applied.body.lesson.chunks);assert.equal(calls,0);
});


test('new storyboards use distinct reproducible prompt seeds, deduplicate, and resume with the same seed policy',async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'entertainify-seeds-')),seeds=[],modes=[];
 const provider=http.createServer((req,res)=>{seeds.push(new URL(req.url,'http://localhost').searchParams.get('seed'));res.writeHead(200,{'Content-Type':'image/png'});res.end(png);});
 const upstream=await listen(provider);
 const options={dataDir,initialKey:'sk_mock_secret',generator:(prompts,options)=>{modes.push(options.seedMode);return generateImages(prompts,{...options,baseUrl:upstream,minIntervalMs:1});}};
 let app=await createApp(options),base=await listen(app.server);
 t.after(async()=>{await app.close();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));await rm(dataDir,{recursive:true,force:true});});
 const lesson=buildStoryboard(normalizeProjectLesson(fixtureLesson()));
 const created=(await json(base,'/api/projects',{lesson})).body;
 const batch=(await json(base,`/api/projects/${created.id}/images`,{mode:'few',count:2})).body;
 await until(async()=>(await json(base,`/api/batches/${batch.batchId}`)).body,b=>b.status!=='running');
 assert.equal(seeds.length,2);assert.notEqual(seeds[0],seeds[1]);assert.deepEqual(modes,['prompt']);
 const frames=(await json(base,`/api/projects/${created.id}`)).body.frames;
 const repeated=await generateImages([frames[0].prompt,frames[0].prompt,frames[1].prompt],{apiKey:'sk_mock_secret',model:'black-forest-labs/flux.1-schnell',baseUrl:upstream,outDir:path.join(dataDir,'images'),seedMode:'prompt',minIntervalMs:1});
 assert.equal(repeated.succeeded,3);assert.ok(repeated.scenes.every(s=>s.cached));assert.equal(seeds.length,2);
 await app.close();app=await createApp(options);base=await listen(app.server);
 assert.equal((await json(base,`/api/batches/${batch.batchId}/resume`,{})).status,202);
 await until(async()=>(await json(base,`/api/batches/${batch.batchId}`)).body,b=>b.status!=='running');
 assert.deepEqual(modes,['prompt','prompt']);assert.equal(seeds.length,2);
});
