import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { validateLesson, characterTimings, createTimeline, synthesizeNarration, renderVideo, runFfmpeg, wavDuration } from './video.mjs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createTextCard, resolveTextTheme, textLayout } from './text-cards.mjs';

function lessonOf(parts) {
  const script=parts.join(' ');let offset=0;
  return {title:'Offline renderer test',script,chunks:parts.map((text,index)=>{const startOffset=offset;offset+=text.length+1;return {index,text,startOffset,endOffset:startOffset+text.length,renderHint:index===1?'text':'image'};})};
}
function alignmentOf(script,step=.1) {return {characters:Array.from(script),character_start_times_seconds:Array.from(script,(_,i)=>i*step),character_end_times_seconds:Array.from(script,(_,i)=>(i+1)*step)};}
function wav(seconds=2) {
  const bytes=Buffer.alloc(44+48000*2*seconds);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(96000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);return bytes;
}
test('the provided 76-chunk example retains exact original offsets',async()=>{
 const lesson=validateLesson(JSON.parse(await readFile(new URL('./archive/public/example-lesson.json',import.meta.url),'utf8')));
 assert.equal(lesson.chunks.length,76);assert.equal(lesson.script.length,969);
 assert.throws(()=>validateLesson({...lesson,script:' '+lesson.script}),/offsets/);
});
test('UTF-16, whitespace normalization, repeated words and mismatches',()=>{
 const script='🧠 Go.\nGo.';const raw=alignmentOf('🧠 Go. Go.');const map=characterTimings(script,raw);
 assert.equal(map.get(3).start,.2);assert.ok(map.get(7).start>map.get(3).start);
 assert.throws(()=>characterTimings('Wrong',raw),/differs/);
 assert.throws(()=>characterTimings('123',alignmentOf('one two three')),/differs/);
});
test('chunk starts drive absolute frame boundaries, focus optional, missing images explicit',()=>{
 const lesson=lessonOf(['A red object.','Text.','Blue.']);const alignment=alignmentOf(lesson.script,.05);
 const timeline=createTimeline(lesson,alignment,2,{mapping:{0:'red.png',2:'blue.png'},fps:30});
 assert.equal(timeline.scenes[1].startFrame,Math.round(lesson.chunks[1].startOffset*.05*30));
 assert.equal(timeline.scenes.reduce((sum,s)=>sum+s.endFrame-s.startFrame,0),60);
 assert.throws(()=>createTimeline(lesson,alignment,2),/no mapped image/);
 lesson.chunks[0].visualFocus='red';const focus=createTimeline(lesson,alignment,2,{mapping:{0:'red.png',2:'blue.png'},cutMode:'focus'});
 assert.equal(focus.scenes[0].chunkIndex,null);assert.equal(focus.scenes[1].alignedStart,.1);
});

test('display captions do not change spoken words or aligned cut times',()=>{
 const lesson=lessonOf(['A leaf absorbs energy.','Energy changes form.']);
 lesson.chunks[1].displayText='Never created';
 const timeline=createTimeline(lesson,alignmentOf(lesson.script,.05),3,{mapping:{0:'leaf.png'}});
 assert.equal(timeline.scenes[1].text,'Energy changes form.');
 assert.equal(timeline.scenes[1].displayText,'Never created');
 assert.equal(timeline.scenes[1].sourceOffset,lesson.chunks[1].startOffset);
});

test('final cuts require images for more than half the actual frames, including pauses and trailing audio',()=>{
 const lesson=lessonOf(['Red.','Text.','Blue.']),alignment=alignmentOf(lesson.script,.1);
 const options={mapping:{0:'red.png',2:'blue.png'},requireImageMajority:true};
 assert.equal(createTimeline(lesson,alignment,2,options).imageTimeShare,.7);
 // Two of three scenes are images, but the long middle card consumes most frames.
 const slowText={...alignment,character_start_times_seconds:alignment.character_start_times_seconds.map(t=>t>=1.1?t+2:t),character_end_times_seconds:alignment.character_end_times_seconds.map(t=>t>=1.1?t+2:t)};
 assert.throws(()=>createTimeline(lesson,slowText,4,options),/half the video or less/);
 const equal=lessonOf(['Red.','Text.']);
 assert.throws(()=>createTimeline(equal,alignmentOf(equal.script,.1),1,{...options,mapping:{0:'red.png'}}),/half the video or less/);
 assert.throws(()=>createTimeline(equal,alignmentOf(equal.script,.1),10,{...options,mapping:{0:'red.png'}}),/half the video or less/);
 assert.doesNotThrow(()=>createTimeline(equal,alignmentOf(equal.script,.1),10,{fallbackText:true}));
});

test('text cards match all art styles and fit landscape, portrait and square safe areas',async()=>{
 const hashes=new Set();
 for(const name of ['doodle','vector','pencil','cinematic']) {
  for(const [width,height] of [[1280,720],[720,1280],[1024,1024]]) {
   const theme=resolveTextTheme(name);assert.equal(theme.name,name);
   const ctx=createCanvas(width,height).getContext('2d');
   for(const text of ['Energy changes form','A much longer sentence still has to fit inside the safe margins.', 'Pneumonoultramicroscopicsilicovolcanoconiosis']) {
    const layout=textLayout(ctx,text,width,height,theme.font);
    assert.ok(layout.lines.every(line=>ctx.measureText(line).width<=width*.78));
    assert.ok(layout.lines.length*layout.lineHeight<=height*.67);
   }
   const bytes=createTextCard({text:'Energy changes form',width,height,textStyle:name});
   const decoded=await loadImage(bytes);assert.equal(decoded.width,width);assert.equal(decoded.height,height);
   hashes.add(bytes.toString('base64'));
  }
 }
 assert.equal(hashes.size,12);
 assert.equal(resolveTextTheme('cinematic','vector').name,'vector');
});
test('voice request uses the complete unchanged script; result cached without another charge',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'entertainify-voice-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0;
 const script='One. Two.';const mock=async(url,options)=>{calls++;assert.match(url,/with-timestamps\?output_format=mp3_44100_128/);assert.equal(JSON.parse(options.body).text,script);assert.equal(options.headers['xi-api-key'],'secret-for-test');return Response.json({audio_base64:Buffer.from('mock audio').toString('base64'),alignment:alignmentOf(script)});};
 const options={apiKey:'secret-for-test',voiceId:'testvoice',cacheDir:dir,fetchImpl:mock};
 assert.equal((await synthesizeNarration(script,options)).cached,false);
 assert.equal((await synthesizeNarration(script,{...options,apiKey:''})).cached,true);assert.equal(calls,1);
});
test('failed voice generation is not automatically retried',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'entertainify-voice-fail-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0;
 await assert.rejects(synthesizeNarration('Hello.',{apiKey:'test',voiceId:'testvoice',cacheDir:dir,fetchImpl:async()=>{calls++;return new Response('',{status:429});}}),/No automatic retry/);assert.equal(calls,1);
});
test('real FFmpeg MP4 has 60 frames with exact red → text → blue cut frames',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'entertainify-render-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const lesson=lessonOf(['Red.','Text.','Blue.']);const alignment=alignmentOf(lesson.script,.1);
 const audioPath=path.join(dir,'input.wav');await writeFile(audioPath,wav());assert.equal(wavDuration(wav()),2);
 for(const color of ['red','blue'])await runFfmpeg(['-f','lavfi','-i',`color=c=${color}:s=640x360:d=1`,'-frames:v','1',`${color}.png`],{cwd:dir});
 const rendered=await renderVideo({lesson,alignment,audioPath,mapping:{0:path.join(dir,'red.png'),2:path.join(dir,'blue.png')},width:640,height:360,outputDir:dir});
 assert.ok((await stat(rendered.file)).size>1000);
 await runFfmpeg(['-i','video.mp4','-map','0:v:0','-f','framemd5','frames.md5'],{cwd:dir});
 const rows=(await readFile(path.join(dir,'frames.md5'),'utf8')).split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>l.split(',').at(-1).trim());
 assert.equal(rows.length,60);const first=rendered.timeline.scenes[1].startFrame,second=rendered.timeline.scenes[2].startFrame;
 assert.equal(first,15);assert.equal(second,33);
 await runFfmpeg(['-i','video.mp4','-map','0:v:0','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','colors.rgb'],{cwd:dir});
 const colors=await readFile(path.join(dir,'colors.rgb'));
 // Classify decoded visuals, allowing normal lossy compression differences.
 for(let i=0;i<60;i++){
  const [r,g,b]=colors.subarray(i*3,i*3+3);
  if(i<first)assert.ok(r>180&&g<100&&b<100,`expected red at frame ${i}`);
  else if(i<second)assert.ok(r>180&&g>180&&b>180,`expected text card at frame ${i}`);
  else assert.ok(b>180&&r<100&&g<100,`expected blue at frame ${i}`);
 }
});
