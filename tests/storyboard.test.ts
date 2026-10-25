import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryboard } from '#storyboard';
import { chunkScript } from '../src/chunker.js';

test('local storyboard keeps exact narration and offsets, adds sentence context and spends no quota',t=>{
  const fetchMock=t.mock.method(globalThis,'fetch',async()=>{throw new Error('No network permitted');});
  const script='Imagine a gigantic kettle of soup. A pump moves cold water through it. The turbine spins beside a generator. Then the rods move down.';
  const original={title:'A firework disaster',script,chunks:chunkScript(script),metadata:{model:'unchanged'}};
  const planned=buildStoryboard(original);
  assert.equal(planned.script,script);assert.equal(planned.chunks.length,original.chunks.length);
  for(const c of planned.chunks){assert.equal(script.slice(c.startOffset,c.endOffset),c.text);assert.equal(c.startOffset,original.chunks[c.index]!.startOffset);}
  assert.equal(planned.metadata.model,'unchanged');assert.equal(fetchMock.mock.callCount(),0);
  const images=planned.chunks.filter(c=>c.renderHint==='image');assert.ok(images.length>0);
  assert.ok(images.every(c=>c.imagePrompt?.includes('FOCAL SUBJECT:')));
  assert.ok(images.every(c=>!c.imagePrompt?.includes('A firework disaster')));
  const pump=images.find(c=>c.visualFocus?.includes('pump'))!;
  assert.ok(pump.imagePrompt?.includes('impeller'));
  assert.ok(!pump.imagePrompt?.includes('kettle of soup.'));
  assert.ok(!pump.imagePrompt?.includes('Scene to depict:'));
  assert.deepEqual(buildStoryboard(planned),planned);
});

test('all weak beats become text without a percentage limit; custom prompts remain images',()=>{
  const words=['Imagine','gigantic','keeps','own','while','all','pump','steam','reactor','water'];
  const script=words.join(' ');let offset=0;
  const chunks=words.map((text,index)=>{const startOffset=offset;offset+=text.length+1;return {index,text,startOffset,endOffset:startOffset+text.length,renderHint:'image' as const,visualFocus:text};});
  const planned=buildStoryboard({script,chunks});assert.equal(planned.chunks.filter(c=>c.renderHint==='text').length,6);
  assert.ok(planned.chunks.slice(6).every(c=>c.renderHint==='image'));
  const custom={...chunks[0]!,imagePrompt:'An authored literal imagination machine.'};
  const kept=buildStoryboard({script,chunks:[custom,...chunks.slice(1)]});assert.equal(kept.chunks[0]!.imagePrompt,custom.imagePrompt);assert.equal(kept.chunks[0]!.renderHint,'image');
  assert.equal(planned.metadata.storyboard.textRatio,.6);
  assert.equal('maxTextRatio' in planned.metadata.storyboard,false);
});


test('context keeps meaningful thermal and technical attributes visual without protecting vague modifiers',()=>{
 const script='The water is cold. An ion has positive charge. The difference is gigantic. This is important.';
 const chunks=chunkScript(script).map(c=>({...c,renderHint:'image' as const}));
 const planned=buildStoryboard({script,chunks});
 for(const word of ['cold','positive']){
  const chunk=planned.chunks.find(c=>c.text.toLowerCase().includes(word))!;assert.equal(chunk.renderHint,'image',word);assert.ok(chunk.imagePrompt?.includes(word));
 }
 for(const word of ['gigantic','important'])assert.equal(planned.chunks.find(c=>c.text.toLowerCase().includes(word))!.renderHint,'text',word);
});

test('rebuilding an older automatic storyboard reconsiders capped images and context-poor text cards',()=>{
 const script='Imagine. Water is cold.';const chunks=chunkScript(script).map(c=>({...c,
  ...(c.text.includes('Imagine')?{renderHint:'image' as const,imagePrompt:'An older automatic imagine scene.',sceneContext:{generatedBy:'local-storyboard-v1'}}:{}),
  ...(c.text.includes('cold')?{renderHint:'text' as const,visualFocus:null,renderReason:'Local storyboard: connector, isolated modifier or quantity reads more clearly as a text card.'}:{})}));
 const planned=buildStoryboard({script,chunks});
 assert.equal(planned.chunks[0]!.renderHint,'text');assert.equal(planned.chunks[0]!.imagePrompt,undefined);
 assert.equal(planned.chunks.find(c=>c.text.includes('cold'))!.renderHint,'image');assert.deepEqual(buildStoryboard(planned),planned);
});


test('atoms, coolant, pumping and reactor beats get distinct literal subjects without inherited narrative settings',()=>{
 const script='Radioactive atoms release heat in a nuclear power plant. In an RBMK reactor, coolant is pumped by electric motors.';
 const planned=buildStoryboard({title:'A fiery power station',script,chunks:chunkScript(script)});
 const find=(pattern:RegExp)=>planned.chunks.find(c=>c.renderHint==='image'&&pattern.test(c.visualFocus??''))!.imagePrompt!;
 const atom=find(/atoms?/i),coolant=find(/^coolant$/i),pump=find(/^pumped$/i),reactor=find(/RBMK/i);
 assert.match(atom,/nucleus/);assert.doesNotMatch(atom,/reactor|power plant|station/i);
 assert.match(coolant,/liquid/);assert.doesNotMatch(coolant,/reactor|power plant|station|diesel/i);
 assert.match(pump,/impeller/);assert.doesNotMatch(pump,/power plant|station|radioactive/i);
 assert.match(reactor,/cutaway/);assert.equal(new Set([atom,coolant,pump,reactor]).size,4);
 assert.ok(planned.chunks.filter(c=>c.renderHint==='image').every(c=>!c.imagePrompt?.includes(script)));
});

test('word-sense context disambiguates a cell without copying the surrounding story into the prompt',()=>{
 const script='A cell in a prison contains a bunk.';const planned=buildStoryboard({script,chunks:chunkScript(script)});
 const prompt=planned.chunks.find(c=>c.visualFocus==='cell')!.imagePrompt!;assert.match(prompt,/prison cell/);assert.doesNotMatch(prompt,/biological|nucleus|Scene to depict/);
});
