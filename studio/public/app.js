const $=id=>document.getElementById(id);
const samples=[
 'Minimalist stick-figure doodle on a white background, thick black lines and one purple accent. A tired college student opens an absurdly large textbook. Simple flat composition, no text.',
 'Minimalist stick-figure doodle on a white background, thick black lines and one purple accent. A tiny cell operates like a busy office, with a stick-figure manager holding a clipboard. No text.',
 'Minimalist stick-figure doodle on a white background, thick black lines and one purple accent. A friendly bean-shaped mitochondrion wearing a hard hat runs a little power station. No text.',
 'Minimalist stick-figure doodle on a white background, thick black lines and one purple accent. A stick figure hands a sugar cube to a tiny cellular power station. No text.',
 'Minimalist stick-figure doodle on a white background, thick black lines and one purple accent. The same tired college student celebrates a small lightbulb turning on above their head. No text.'
];
let selected=sessionStorage.getItem('batch')??'',current=null,state=null,fingerprint='',requesting=false;
let playerFrames=[],frame=0,timer=null;
function notify(message,success=false){$('notice').textContent=message;$('notice').className=`notice${success?' success':''}`;$('notice').hidden=false;}
async function api(url,data){const response=await fetch(url,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error??'Request failed');return result;}
function prompts(){const text=$('prompts').value.trim();if(!text)return[];if(text.startsWith('[')){const parsed=JSON.parse(text);if(!Array.isArray(parsed)||parsed.some(p=>typeof p!=='string'))throw new Error('JSON must be an array of prompt strings');return parsed.map(p=>p.trim()).filter(Boolean);}return text.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);}
function updateCost(){const count=Number($('count').value);$('estimate').textContent=`≈ ${(count*.002).toFixed(3)} Pollen`;$('generate').innerHTML=`Generate ${count} image${count===1?'':'s'} <span>↗</span>`;try{$('promptCount').textContent=`${prompts().length} prompts`;}catch{$('promptCount').textContent='Check JSON format';}}
$('prompts').value=samples.join('\n\n');updateCost();
$('prompts').addEventListener('input',updateCost);$('count').addEventListener('change',updateCost);
$('example').onclick=()=>{$('prompts').value=samples.join('\n\n');updateCost();};
$('importFile').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;const data=JSON.parse(await file.text());if(!Array.isArray(data)||data.some(p=>typeof p!=='string'||!p.trim()))throw new Error('Import a JSON array of nonempty prompt strings');$('prompts').value=JSON.stringify(data,null,2);updateCost();notify(`Imported ${data.length} prompts.`,true);}catch(error){notify(error.message);}event.target.value='';};
$('saveKey').onclick=async()=>{try{await api('/api/key',{key:$('apiKey').value});$('apiKey').value='';$('connection').open=false;notify('Key loaded for this server session. Generation happens only when you click Generate.',true);await refresh();}catch(error){notify(error.message);}};
$('generate').onclick=async()=>{if(requesting)return;try{const list=prompts(),count=Number($('count').value);if(list.length<count)throw new Error(`Add at least ${count} prompts, separated by blank lines.`);requesting=true;$('generate').disabled=true;const result=await api('/api/batches',{title:$('batchTitle').value.trim()||`${count}-image test`,prompts:list.slice(0,count)});selected=result.id;sessionStorage.setItem('batch',selected);fingerprint='';$('notice').hidden=true;await refresh();}catch(error){notify(error.message);}finally{requesting=false;if(state)$('generate').disabled=Boolean(state.active);}};
$('batches').onchange=()=>{selected=$('batches').value;sessionStorage.setItem('batch',selected);fingerprint='';refresh().catch(error=>notify(error.message));};
$('refresh').onclick=()=>refresh().catch(error=>notify(error.message));
$('resume').onclick=async()=>{try{await api(`/api/batches/${selected}/resume`,{});fingerprint='';await refresh();}catch(error){notify(error.message);}};
$('stop').onclick=async()=>{try{await api(`/api/batches/${state.active.id}/stop`,{});await refresh();}catch(error){notify(error.message);}};
function node(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
async function move(index,delta){try{const ids=current.scenes.map(s=>s.id);[ids[index],ids[index+delta]]=[ids[index+delta],ids[index]];await api(`/api/batches/${selected}/order`,{ids});fingerprint='';await refresh();}catch(error){notify(error.message);}}
function renderGallery(){
 const gallery=$('gallery');gallery.replaceChildren();
 current.scenes.forEach((scene,index)=>{
  const card=node('article','scene'),visual=node('div','scene-image');
  if(scene.imageUrl){const image=node('img');image.src=scene.imageUrl;image.alt=scene.prompt;image.loading='lazy';visual.append(image);}else visual.append(node('span','placeholder',scene.status==='running'?'Drawing your scene…':scene.status==='failed'?'This scene needs another try.':'Waiting for its turn.'));
  visual.append(node('span','scene-number',String(index+1).padStart(2,'0')));
  const content=node('div','scene-content');content.append(node('p','',scene.prompt));
  const bottom=node('div','scene-bottom'),controls=node('div','order-controls');
  bottom.append(node('span',`scene-status${scene.status==='failed'?' error':''}`,scene.cached?'Saved · reused':scene.status));
  for(const [delta,label]of[[-1,'←'],[1,'→']]){const b=node('button','',label);b.disabled=index+delta<0||index+delta>=current.scenes.length;b.setAttribute('aria-label',`Move scene ${index+1} ${delta<0?'earlier':'later'}`);b.onclick=()=>move(index,delta);controls.append(b);}
  bottom.append(controls);content.append(bottom);if(scene.error)content.append(node('div','scene-error',scene.error));card.append(visual,content);gallery.append(card);
 });
 if(current.error)gallery.append(node('p','scene-error',current.error));
}
async function refresh(){
 state=await api('/api/state');$('keyStatus').textContent=state.keyConfigured?'Key loaded · session ready':'Connect Pollinations';$('keyDot').className=`dot${state.keyConfigured?' connected':''}`;
 if(!state.keyConfigured)$('connection').open=true;
 $('generate').disabled=Boolean(state.active)||requesting;
 const selector=$('batches'),old=selector.value;selector.replaceChildren();
 if(!state.batches.length){const option=node('option','','No saved sequences yet');option.value='';selector.append(option);return;}
 if(!state.batches.some(b=>b.id===selected))selected=state.batches[0].id;
 state.batches.forEach(batch=>{const option=node('option','',`${batch.title} · ${batch.count} frame${batch.count===1?'':'s'}`);option.value=batch.id;selector.append(option);});selector.value=selected;
 current=await api(`/api/batches/${selected}`);
 const next=JSON.stringify(current);if(next!==fingerprint){renderGallery();fingerprint=next;}
 const done=current.scenes.filter(s=>s.status==='completed').length;
 $('batchBadge').textContent=`${done} / ${current.scenes.length} SAVED`;
 $('progressWrap').hidden=!state.active||state.active.id!==selected;
 $('progressText').textContent=state.active?.progress??'';$('progress').max=current.scenes.length;$('progress').value=done;
 $('resume').hidden=current.status==='completed'||Boolean(state.active);
 $('preview').disabled=done===0;
 $('export').classList.remove('disabled');$('export').setAttribute('aria-disabled','false');$('export').href=`/api/batches/${selected}/export`;
}
function showFrame(){const scene=playerFrames[frame];$('playerImage').src=scene.imageUrl;$('playerImage').alt=scene.prompt;$('frameLabel').textContent=`${frame+1} / ${playerFrames.length}`;}
$('preview').onclick=()=>{playerFrames=current.scenes.filter(s=>s.status==='completed');if(!playerFrames.length)return;frame=0;$('playerTitle').textContent=current.title;showFrame();$('player').showModal();clearInterval(timer);timer=setInterval(()=>{frame=(frame+1)%playerFrames.length;showFrame();},3000);};
$('closePlayer').onclick=()=>$('player').close();$('player').addEventListener('close',()=>clearInterval(timer));
$('previousFrame').onclick=()=>{frame=(frame-1+playerFrames.length)%playerFrames.length;showFrame();};$('nextFrame').onclick=()=>{frame=(frame+1)%playerFrames.length;showFrame();};
let refreshing=false;async function poll(){if(refreshing)return;refreshing=true;try{await refresh();}catch(error){notify(`Cannot reach the local server: ${error.message}`);}finally{refreshing=false;}}
await poll();setInterval(poll,1200);
