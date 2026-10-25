import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApp } from './server.mjs';
import { generateImages } from './images.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`;}
async function json(base,endpoint,data,origin=base){const res=await fetch(base+endpoint,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(data)});return {status:res.status,body:await res.json()};}
async function done(base,id){for(let i=0;i<200;i++){const {body}=await json(base,`/api/batches/${id}`);if(body.status!=='running')return body;await sleep(15);}throw new Error('Timed out');}
test('local app: no auto generation; one then five; cache; sequence; export; persistence; origin checks',async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'entertainify-studio-'));
 let requests=0;
 const provider=http.createServer((req,res)=>{requests++;assert.equal(req.headers.authorization,'Bearer sk_mock_secret');res.writeHead(200,{'Content-Type':'image/png'});res.end(png);});
 const upstream=await listen(provider);
 const generator=(prompts,options)=>generateImages(prompts,{...options,baseUrl:upstream,minIntervalMs:1,retryBaseMs:1});
 let app=await createApp({dataDir,generator,initialKey:''});let base=await listen(app.server);
 t.after(async()=>{await app.close();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));await rm(dataDir,{recursive:true,force:true});});
 assert.equal((await fetch(base)).status,200);assert.equal((await fetch(base+'/app.js')).status,200);
 assert.equal((await json(base,'/api/state')).body.keyConfigured,false);assert.equal(requests,0);
 assert.equal((await json(base,'/api/key',{key:'sk_mock_secret'},'https://example.com')).status,403);
 assert.equal((await json(base,'/api/batches',{prompts:['first']})).status,400);
 assert.equal((await json(base,'/api/key',{key:'sk_mock_secret'})).status,200);
 const one=await json(base,'/api/batches',{title:'One image',prompts:['first']});assert.equal(one.status,202);
 const first=await done(base,one.body.id);assert.equal(first.status,'completed');assert.equal(requests,1);
 assert.equal((await fetch(base+first.scenes[0].imageUrl)).headers.get('content-type'),'image/png');
 const five=await json(base,'/api/batches',{title:'Five images',prompts:['first','second','third','fourth','fifth']});
 const batch=await done(base,five.body.id);assert.equal(batch.scenes.length,5);assert.ok(batch.scenes.every(s=>s.status==='completed'));assert.equal(requests,5);assert.equal(batch.scenes[0].cached,1);
 const ids=batch.scenes.map(s=>s.id).reverse();assert.equal((await json(base,`/api/batches/${batch.id}/order`,{ids})).status,200);
 const exported=(await json(base,`/api/batches/${batch.id}/export`)).body;
 assert.equal(exported.ready,true);assert.deepEqual(exported.scenes.map(s=>s.sceneId),ids);assert.equal(exported.scenes[0].prompt,'fifth');assert.equal(exported.scenes[0].index,0);
 assert.equal((await json(base,`/api/batches/${batch.id}/order`,{ids:[ids[0]]})).status,400);
 assert.ok(!JSON.stringify(await json(base,'/api/state')).includes('sk_mock_secret'));
 await app.close();app=await createApp({dataDir,generator,initialKey:''});base=await listen(app.server);
 assert.equal((await json(base,'/api/state')).body.batches.length,2);assert.equal((await json(base,'/api/state')).body.keyConfigured,false);
 const saved=(await json(base,`/api/batches/${batch.id}`)).body;assert.deepEqual(saved.scenes.map(s=>s.id),ids);assert.equal((await fetch(base+saved.scenes[0].imageUrl)).status,200);
});
test('stop and resume an async batch without resubmitting the image job',async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'entertainify-resume-'));let submits=0,finish=false;
 const provider=http.createServer((req,res)=>{if(req.url.startsWith('/image/')){submits++;res.writeHead(202,{'Retry-After':'0'});res.end(JSON.stringify({id:'job1'}));}else if(req.url.endsWith('/result')){res.writeHead(200,{'Content-Type':'image/png'});res.end(png);}else res.end(JSON.stringify({status:finish?'succeeded':'pending'}));});
 const upstream=await listen(provider);const app=await createApp({dataDir,initialKey:'sk_mock_secret',generator:(prompts,options)=>generateImages(prompts,{...options,baseUrl:upstream,minIntervalMs:1,pollMs:5})});const base=await listen(app.server);
 t.after(async()=>{await app.close();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));await rm(dataDir,{recursive:true,force:true});});
 const started=await json(base,'/api/batches',{prompts:['async']});
 for(let i=0;i<100&&submits===0;i++)await sleep(10);await sleep(50);
 await json(base,`/api/batches/${started.body.id}/stop`,{});const stopped=await done(base,started.body.id);assert.equal(stopped.status,'interrupted');
 finish=true;await json(base,`/api/batches/${started.body.id}/resume`,{});assert.equal((await done(base,started.body.id)).status,'completed');assert.equal(submits,1);
});
test('voice/video HTTP flow validates before spending, renders, streams byte ranges and exports timing',async t=>{
 const dataDir=await mkdtemp(path.join(tmpdir(),'entertainify-video-api-'));let voiceCalls=0;
 const script='Hello world.';
 const lesson={title:'HTTP video test',script,chunks:[{index:0,text:script,startOffset:0,endOffset:script.length,renderHint:'image'}]};
 const app=await createApp({dataDir,initialKey:'',voiceGenerator:async()=>{
  voiceCalls++;const wav=Buffer.alloc(44+96000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(96000,40);
  const audioPath=path.join(dataDir,'mock.wav');await writeFile(audioPath,wav);
  return {audioPath,cached:false,alignment:{characters:Array.from(script),character_start_times_seconds:Array.from(script,(_,i)=>i*.05),character_end_times_seconds:Array.from(script,(_,i)=>(i+1)*.05)}};
 }});const base=await listen(app.server);t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
 assert.equal((await fetch(base+'/video')).status,200);
 await json(base,'/api/video/key',{key:'test_voice_key'});
 const payload={lesson,voiceId:'testvoice',model:'eleven_flash_v2_5',format:'landscape',mapping:{},fallbackText:false};
 assert.equal((await json(base,'/api/video/jobs',payload)).status,400);assert.equal(voiceCalls,0);
 const started=await json(base,'/api/video/jobs',{...payload,fallbackText:true});assert.equal(started.status,202);
 let job;for(let i=0;i<300;i++){job=(await json(base,`/api/video/jobs/${started.body.id}`)).body;if(job.status!=='running')break;await sleep(20);}
 assert.equal(job.status,'completed',job.error);assert.equal(voiceCalls,1);
 const partial=await fetch(base+job.videoUrl,{headers:{Range:'bytes=0-31'}});assert.equal(partial.status,206);assert.equal((await partial.arrayBuffer()).byteLength,32);
 const timeline=(await json(base,job.timelineUrl)).body;assert.equal(timeline.scenes[0].startFrame,0);assert.equal(timeline.fps,30);
 const download=await fetch(base+job.videoUrl+'?download=1');assert.match(download.headers.get('content-disposition'),/attachment/);await download.arrayBuffer();
});
