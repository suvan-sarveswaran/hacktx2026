const $=id=>document.getElementById(id);
const styles={
 doodle:'Minimalist hand-drawn stick-figure doodles on a warm white background. Thick clean black lines, one purple accent color, simple flat composition, consistent character proportions. No text, labels, watermarks, borders, or photorealism.',
 vector:'Flat editorial vector-style illustrations. Warm cream background, deep navy outlines, muted teal and coral accents, simple geometric shapes, consistent rounded characters, minimal shading and uncluttered composition. No text or watermarks.',
 pencil:'Colored-pencil storybook illustrations on warm ivory paper. Soft hand-drawn outlines, restrained lavender and forest-green palette, gentle pencil shading, simple consistent characters and generous empty space. No text or watermarks.',
 cinematic:'Cinematic painted illustrations with warm amber key light and cool blue shadows. Consistent semi-realistic character design, restrained color palette, clear focal subject, simple background, widescreen composition. No text or watermarks.',
};
let project=null,projectState=null,videoState=null,selectedJob='',working=false,dirty=false,lastFrames='',lastInventory='',polling=false;
let jsonDirty=false,editorProjectId=null;
const sourceNames=JSON.parse(sessionStorage.getItem('lessonSourceNames')??'{}');
let selectedProject=sessionStorage.getItem('lessonProject')??'';
$('artStyle').value=styles.doodle;
function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function notify(message,success=false){$('notice').textContent=message;$('notice').className=`notice${success?' success':''}`;$('notice').hidden=false;}
async function api(url,data){const response=await fetch(url,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error??'Request failed');return result;}
function markDirty(){dirty=true;$('styleStatus').textContent='UNSAVED CHANGES';}
function statistics(){
 const frames=project?.frames??[],done=frames.filter(f=>f.status==='completed').length,missing=frames.length-done;
 $('imageCount').textContent=project?`${done} / ${frames.length} SAVED`:'READY WHEN YOU ARE';
 const few=Math.min(Number($('fewCount').value)||5,missing);
 $('imageEstimate').textContent=project?(dirty?'Apply your image settings or prompt edits to refresh the missing-image count and cost estimate.':`Schnell estimate: 1 ≈ 0.002 Pollen · next ${few} ≈ ${(few*.002).toFixed(3)} · all ${missing} missing ≈ ${(missing*.002).toFixed(3)}. Matching cached images cost no new generation.`):'Load a lesson to see image costs.';
 $('mappingSummary').textContent=project?`${done} ready images · ${missing} missing · ${project.lesson.chunks.filter(c=>c.renderHint==='text').length} text chunks. Images stay attached to their chunk indexes.`:'No lesson loaded.';
 for(const id of ['generateOne','generateFew','generateAll'])$(id).disabled=!project||working||jsonDirty||Boolean(projectState?.activeImages)||(missing===0&&!dirty);
 $('saveStyle').disabled=!project||working||Boolean(projectState?.activeImages);
 $('generateAll').textContent=dirty?'Save + generate all':project?`Generate all ${missing} missing`:'Generate all missing';
 const n=project?.lesson.script.length;
 $('voiceEstimate').textContent=n?$('model').value==='eleven_flash_v2_5'?`≈ ${Math.ceil(n*.5)}–${n} credits`:`≈ ${n} credits`:'Load a lesson first';
 const blockers=[];
 if(!project)blockers.push('Load a lesson JSON first.');
 if(working)blockers.push('Wait for the current request to finish.');
 if(videoState?.active)blockers.push('An audio/video job is running. Wait for it to finish or stop it.');
 if(projectState?.activeImages)blockers.push('Images are still generating. Wait for completion or stop the batch.');
 if(jsonDirty)blockers.push('Validate and apply your JSON draft, or discard it first.');
 if(dirty)blockers.push('Apply your image settings and prompt edits first.');
 if(project&&missing>0&&!$('fallback').checked)blockers.push(`${missing} image${missing===1?' is':'s are'} missing. Generate the missing images, or enable text cards for a partial test video.`);
 if(!videoState?.keyConfigured)blockers.push('Connect your ElevenLabs API key.');
 const reason=blockers.join(' ');
 $('render').disabled=Boolean(reason);$('render').title=reason||'Create MP4 using this lesson and its images';
 $('renderGate').tabIndex=reason?0:-1;$('renderTooltip').textContent=reason;$('renderTooltip').hidden=!reason;
 $('renderReason').textContent=reason;$('renderReason').hidden=!reason;
 $('audioOnly').disabled=!project||working||jsonDirty||Boolean(videoState?.active)||!videoState?.keyConfigured;
 $('buildStoryboard').disabled=!project||working||Boolean(projectState?.activeImages);
 $('applyJson').disabled=!project||working||Boolean(projectState?.activeImages);
 $('resetJson').disabled=!project||working;
 $('imageProgressWrap').hidden=!projectState?.activeImages;
 if(projectState?.activeImages){$('imageProgress').textContent=projectState.activeImages.progress;$('imageProgressBar').max=frames.length||1;$('imageProgressBar').value=done;}
}
function setProject(value,{resetStyle=false}={}){
 project=value;selectedProject=value.id;sessionStorage.setItem('lessonProject',value.id);
 if(resetStyle||!dirty){$('artStyle').value=value.style;$('imageAspect').value=value.imageAspect??'square';const preset=Object.keys(styles).find(k=>styles[k]===value.style);$('stylePreset').value=preset??'custom';dirty=false;}
 $('styleStatus').textContent=dirty?'UNSAVED CHANGES':'STYLE SAVED';
 $('lessonInfo').replaceChildren(el('strong',value.title),el('span',`${value.lesson.script.length} characters · ${value.lesson.chunks.length} chunks · ${value.frames.length} image prompts. Progress saves automatically.`));
 $('lessonFileStatus').textContent=`JSON saved locally: studio/${value.lessonFile}`;
 $('exportLesson').href=`/api/projects/${value.id}/export`;$('exportLesson').classList.remove('disabled');$('exportLesson').setAttribute('aria-disabled','false');
 $('sourceStatus').textContent=sourceNames[value.id]?`Loaded: ${sourceNames[value.id]}`:`Saved lesson loaded: ${value.title}`;
 if(editorProjectId!==value.id){editorProjectId=value.id;jsonDirty=false;}
 if(!jsonDirty)$('jsonEditor').value=JSON.stringify(value.lesson,null,2);
 const signature=JSON.stringify(value.frames);if(signature!==lastFrames||resetStyle){lastFrames=signature;renderCards();}statistics();
}
async function saveSettings(){if(!project)throw new Error('Load a lesson first.');if(jsonDirty)throw new Error('Validate and apply the JSON draft, or discard it first.');if(!dirty)return;
 const saved=await api(`/api/projects/${project.id}/settings`,{style:$('artStyle').value,imageAspect:$('imageAspect').value,lesson:project.lesson});dirty=false;setProject(saved,{resetStyle:true});}
async function loadLesson(lesson,sourceName){const loaded=await api('/api/projects',{lesson,style:$('artStyle').value,imageAspect:$('imageAspect').value});if(sourceName){sourceNames[loaded.id]=sourceName;sessionStorage.setItem('lessonSourceNames',JSON.stringify(sourceNames));}jsonDirty=false;setProject(loaded,{resetStyle:true});await refresh();notify('Lesson saved. Generate 1 image to test the look, then generate a few or all remaining images.',true);}
$('chooseLessonFile').onclick=()=>{$('lessonFile').value='';$('lessonFile').click();};
$('lessonFile').onchange=async event=>{try{const file=event.target.files[0];if(file)await loadLesson(JSON.parse((await file.text()).replace(/^\uFEFF/,'')),file.name);}catch(error){notify(error.message);}};
$('example').onclick=async()=>{try{await loadLesson(await api('/example-lesson.json'),'example-lesson.json');}catch(error){notify(error.message);}};
$('buildStoryboard').onclick=async()=>{try{working=true;statistics();const lesson=jsonDirty?JSON.parse($('jsonEditor').value):project.lesson;const result=await api(`/api/projects/${project.id}/storyboard`,{lesson});$('jsonEditor').value=JSON.stringify(result.lesson,null,2);jsonDirty=true;$('jsonPanel').open=true;$('jsonEditorStatus').textContent=`Storyboard draft: ${result.summary.imageChunks} image scenes, ${result.summary.textChunks} text cards. Review, then Validate + apply JSON. No API calls were made.`;notify('Independent-scene storyboard draft ready. Old automatic prompts are upgraded; custom prompts stay intact. No images are generated until you choose Generate.',true);}catch(error){notify(error.message);}finally{working=false;statistics();}};
$('jsonEditor').oninput=()=>{jsonDirty=true;$('jsonEditorStatus').textContent='Unsaved JSON draft. Validate + apply before generating.';$('jsonEditorStatus').className='fine-print';statistics();};
$('resetJson').onclick=()=>{if(!project)return;jsonDirty=false;$('jsonEditor').value=JSON.stringify(project.lesson,null,2);$('jsonEditorStatus').textContent='Draft discarded. Showing the current lesson.';$('jsonEditorStatus').className='fine-print';statistics();};
$('applyJson').onclick=async()=>{try{const parsed=JSON.parse($('jsonEditor').value);working=true;statistics();const saved=await api(`/api/projects/${project.id}/settings`,{lesson:parsed,style:$('artStyle').value,imageAspect:$('imageAspect').value});jsonDirty=false;dirty=false;setProject(saved,{resetStyle:true});$('jsonEditorStatus').textContent='JSON validated and saved. Metadata is preserved; changed image requirements select new image versions.';$('jsonEditorStatus').className='fine-print';notify('Lesson JSON saved. No images or narration were generated.',true);}catch(error){$('jsonEditorStatus').textContent=`JSON was not applied: ${error.message}`;$('jsonEditorStatus').className='scene-error';}finally{working=false;statistics();}};
$('projects').onchange=async()=>{try{if($('projects').value)setProject(await api(`/api/projects/${$('projects').value}`),{resetStyle:true});await refresh();}catch(error){notify(error.message);}};
$('imageAspect').onchange=()=>{markDirty();statistics();};
$('artStyle').oninput=()=>{markDirty();$('stylePreset').value='custom';statistics();};
$('stylePreset').onchange=()=>{const value=styles[$('stylePreset').value];if(value){$('artStyle').value=value;markDirty();statistics();}};
$('saveStyle').onclick=async()=>{try{await saveSettings();notify('Image settings and prompt edits saved. Matching versions are reused; changed prompts or dimensions need new images.',true);}catch(error){notify(error.message);}};
$('fewCount').oninput=statistics;$('fallback').onchange=statistics;$('model').onchange=statistics;
$('connectImages').onclick=async()=>{try{await api('/api/key',{key:$('imageKey').value});$('imageKey').value='';notify('Pollinations key connected. No images generated yet.',true);await refresh();}catch(error){notify(error.message);}};
$('connectVoice').onclick=async()=>{try{await api('/api/video/key',{key:$('voiceKey').value});$('voiceKey').value='';notify('ElevenLabs key connected. No narration generated yet.',true);await refresh();}catch(error){notify(error.message);}};
$('loadVoices').onclick=async()=>{try{const result=await api('/api/video/voices');if(!result.voices.length)throw new Error('No available voices returned');const select=$('voices');select.replaceChildren();result.voices.forEach(v=>{const option=el('option',`${v.name} · ${v.category??'voice'}`);option.value=v.voiceId;select.append(option);});select.hidden=false;const match=result.voices.find(v=>v.voiceId===$('voiceId').value);if(match)select.value=match.voiceId;else $('voiceId').value=select.value;}catch(error){notify(error.message);}};
$('voices').onchange=()=>$('voiceId').value=$('voices').value;
async function generateImages(mode,indices){if(working)return;try{working=true;statistics();await saveSettings();const payload={mode,count:Number($('fewCount').value)};if(indices)payload.indices=indices;const result=await api(`/api/projects/${project.id}/images`,payload);if(result.project)setProject(result.project);notify(result.alreadyComplete?'All matching images are already saved.':`Generating ${result.count} images. They will attach to the correct chunks automatically.`,true);await refresh();}catch(error){notify(error.message);}finally{working=false;statistics();}}
$('generateOne').onclick=()=>generateImages('one');$('generateFew').onclick=()=>generateImages('few');$('generateAll').onclick=()=>generateImages('all');
$('stopImages').onclick=async()=>{try{await api(`/api/batches/${projectState.activeImages.id}/stop`,{});await refresh();}catch(error){notify(error.message);}};
function renderCards(){const gallery=$('mappingTable');gallery.replaceChildren();if(!project)return;gallery.dataset.aspect=project.imageAspect??'square';
 const byIndex=new Map(project.frames.map(f=>[f.chunkIndex,f]));
 for(const chunk of project.lesson.chunks){
  const frame=byIndex.get(chunk.index),card=el('article',undefined,`lesson-frame${frame?'':' text-frame'}`);
  const visual=el('div',undefined,'lesson-visual');
  if(frame?.imageUrl){const image=el('img');image.src=frame.imageUrl;image.alt=chunk.visualFocus??chunk.text;image.loading='lazy';visual.append(image);}
  else visual.append(el('span',chunk.renderHint==='skip'?'Hold previous visual':frame?frame.status==='running'?'Generating…':chunk.visualFocus??chunk.text:chunk.text,'frame-placeholder'));
  visual.append(el('span',String(chunk.index).padStart(2,'0'),'scene-number'));card.append(visual);
  const content=el('div',undefined,'lesson-frame-content');content.append(el('p',chunk.text,'chunk-narration'));
  const status=el('div',undefined,'frame-status');status.append(el('span',frame?frame.status==='completed'?frame.cached?'Saved · reused':'Image ready':frame.status:chunk.renderHint==='skip'?'No image needed':'Text card · no Pollen'));
  if(frame&&frame.status!=='completed'){const button=el('button','Generate this','text-button');button.disabled=Boolean(projectState?.activeImages);button.onclick=()=>generateImages('one',[chunk.index]);status.append(button);}content.append(status);
  if(frame){const detail=el('details');detail.append(el('summary','Edit image prompt'));const prompt=el('textarea');prompt.value=frame.basePrompt;prompt.rows=3;prompt.maxLength=3000;prompt.setAttribute('aria-label',`Image prompt for chunk ${chunk.index}`);prompt.disabled=Boolean(projectState?.activeImages);prompt.oninput=()=>{project.lesson.chunks[chunk.index].imagePrompt=prompt.value;project.lesson.chunks[chunk.index].sceneContext={...project.lesson.chunks[chunk.index].sceneContext,generatedBy:'custom-prompt-edit'};markDirty();statistics();};detail.append(prompt);detail.append(el('p','Your art direction is added to this prompt automatically.','fine-print'));content.append(detail);const sent=el('details');sent.append(el('summary','View complete generation prompt'));const full=el('textarea');full.readOnly=true;full.rows=8;full.value=frame.prompt;full.setAttribute('aria-label',`Complete generation prompt for chunk ${chunk.index}`);sent.append(full);sent.append(el('p','Saved prompt including chunk requirements and art direction. Apply edits to update this preview.','fine-print'));content.append(sent);if(frame.error)content.append(el('p',frame.error,'scene-error'));}
  card.append(content);gallery.append(card);
 }
}
$('mapImages').onclick=async()=>{try{await saveSettings();const batch=videoState.batches.find(b=>b.id===$('imageBatch').value);if(!batch)throw new Error('Choose a saved sequence');const mapping={};batch.scenes.forEach((s,i)=>{if(project.frames[i])mapping[project.frames[i].chunkIndex]=s.id;});setProject(await api(`/api/projects/${project.id}/map`,{mapping}));notify('Existing images attached to this lesson. Check that they match the narration and selected style.',true);}catch(error){notify(error.message);}};
async function makeOutput(audioOnly){if(working)return;try{working=true;statistics();await saveSettings();const result=await api('/api/video/jobs',{projectId:project.id,audioOnly,fallbackText:$('fallback').checked,voiceId:$('voiceId').value.trim(),model:$('model').value,format:$('format').value});selectedJob=result.id;$('notice').hidden=true;await refresh();}catch(error){notify(error.message);}finally{working=false;statistics();}}
$('audioOnly').onclick=()=>makeOutput(true);$('render').onclick=()=>makeOutput(false);
$('jobs').onchange=()=>{selectedJob=$('jobs').value;showJob();};
$('stop').onclick=async()=>{try{await api(`/api/video/jobs/${selectedJob}/stop`,{});await refresh();}catch(error){notify(error.message);}};
$('retry').onclick=async()=>{try{await api(`/api/video/jobs/${selectedJob}/retry`,{});await refresh();}catch(error){notify(error.message);}};
$('refresh').onclick=()=>refresh().catch(error=>notify(error.message));
function showJob(){const job=videoState?.jobs.find(j=>j.id===selectedJob);if(!job){$('jobStatus').textContent='No audio or videos created for this lesson yet.';for(const id of ['audio','video','downloadAudio','download','timeline','stop','retry'])$(id).hidden=true;return;}
 $('jobStatus').textContent=`${job.status.toUpperCase()} · ${job.progress??''}${job.cached?'\nSaved narration reused.':''}${job.error?'\n'+job.error:''}`;$('jobStatus').className=`job-status${job.error?' error':''}`;
 $('stop').hidden=videoState.active!==job.id;$('retry').hidden=!['failed','interrupted'].includes(job.status)||Boolean(videoState.active);
 for(const [id,url]of[['audio',job.audioUrl],['video',job.videoUrl]]){$(id).hidden=!url;if(url&&$(id).getAttribute('src')!==url)$(id).src=url;}
 for(const [id,url]of[['downloadAudio',job.audioUrl?job.audioUrl+'?download=1':null],['download',job.videoUrl?job.videoUrl+'?download=1':null],['timeline',job.timelineUrl]]){$(id).hidden=!url;if(url)$(id).href=url;}
}
async function refresh(){
 [projectState,videoState]=await Promise.all([api('/api/projects'),api('/api/video/state')]);
 $('imageKeyStatus').textContent=projectState.imageKeyConfigured?'KEY LOADED':'KEY NEEDED';$('voiceStatus').textContent=videoState.keyConfigured?'KEY LOADED':'KEY NEEDED';
 const selector=$('projects');selector.replaceChildren();if(!projectState.projects.length)selector.append(el('option','No saved lessons yet'));for(const p of projectState.projects){const option=el('option',p.title);option.value=p.id;selector.append(option);}
 if(!project&&projectState.projects.length){const id=projectState.projects.some(p=>p.id===selectedProject)?selectedProject:projectState.projects[0].id;setProject(await api(`/api/projects/${id}`),{resetStyle:true});}
 else if(project){const latest=await api(`/api/projects/${project.id}`);if(dirty)setProject({...latest,lesson:project.lesson,style:project.style});else setProject(latest);}
 selector.value=project?.id??'';
 const assets=JSON.stringify(videoState.batches);if(assets!==lastInventory){lastInventory=assets;const previous=$('imageBatch').value;$('imageBatch').replaceChildren();for(const b of videoState.batches){const option=el('option',`${b.title} · ${b.scenes.length} images`);option.value=b.id;$('imageBatch').append(option);}if(videoState.batches.some(b=>b.id===previous))$('imageBatch').value=previous;}
 const jobs=videoState.jobs.filter(j=>!project||j.projectId===project.id);const outputs=$('jobs');outputs.replaceChildren();if(!jobs.length)outputs.append(el('option','No outputs yet'));for(const job of jobs){const option=el('option',`${job.title} · ${job.status}`);option.value=job.id;outputs.append(option);}if(!jobs.some(j=>j.id===selectedJob))selectedJob=jobs[0]?.id??'';outputs.value=selectedJob;showJob();statistics();
}
async function poll(){if(polling||working)return;polling=true;try{await refresh();}catch(error){notify(error.message);}finally{polling=false;}}
await poll();setInterval(poll,1500);
