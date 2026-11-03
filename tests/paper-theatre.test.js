import test from 'node:test';
import assert from 'node:assert/strict';
import {exampleProject,reviseAnswer} from '../web/domain.js';
import {mockEvent,mockVideo} from '../web/mock-ai.js';
import {projectInput} from '../web/ai-client.js';
import {saveEvent,confirmEvent,saveVideo,approveSceneIllustration} from '../web/event-model.js';
import {filmCards,recordingType,videoExportMarkup} from '../web/video-export.js';
import {listPaperSets,normalizePaperSet,normalizeFilmMode,suggestPaperSet,resolveSceneSet,paperFrameState,drawPaperFrame,filmSettings,saveFilmSettings,filmReadiness,buildVisualNote,shouldReduceMotion,motionTime} from '../web/paper-theatre.js';
function ready(){const p=exampleProject();saveEvent(p,mockEvent(projectInput(p)));confirmEvent(p,{title:p.event.title,summary:p.event.summary});const options={host:'thoughtful',setting:'garden',tone:'warm'};saveVideo(p,mockVideo({...projectInput(p),event:p.event,options}),options);return p;}
function fakeCtx(){const calls=[];const ctx={calls,fillStyle:'#000',font:'',shadowColor:'',shadowBlur:0};for(const m of ['save','restore','fillRect','beginPath','arc','fill','moveTo','lineTo','closePath','stroke','fillText','translate','rotate'])ctx[m]=(...a)=>calls.push([m,...a]);return ctx;}
test('paper theatre offers four distinct drawn sets with safe defaults',()=>{
 const sets=listPaperSets();assert.equal(sets.length,4);
 assert.deepEqual(sets.map(s=>s.id),['concert','station','workshop','hearth']);
 assert.equal(normalizePaperSet('concert'),'concert');assert.equal(normalizePaperSet('opera'),'hearth');assert.equal(normalizePaperSet(''),'hearth');
 assert.equal(normalizeFilmMode('images'),'images');assert.equal(normalizeFilmMode('paper'),'paper');assert.equal(normalizeFilmMode('x'),'paper');
});
test('set suggestion follows excerpt keywords and invents nothing',()=>{
 assert.equal(suggestPaperSet('we sang a song on stage'),'concert');
 assert.equal(suggestPaperSet('the train left the station'),'station');
 assert.equal(suggestPaperSet('hammer and tools in the workshop'),'workshop');
 assert.equal(suggestPaperSet('a quiet evening at home'),'hearth');
 const out=suggestPaperSet('Anna met Boris in 1984 at Victory Street');assert.equal(out,'hearth');
});
test('animation state moves over time, is deterministic, fresh, and bounded',()=>{
 const a=paperFrameState('concert',0),b=paperFrameState('concert',1);
 assert.notDeepEqual(a.crowd.map(c=>c.y),b.crowd.map(c=>c.y));
 assert.deepEqual(paperFrameState('station',2),paperFrameState('station',2));
 assert.notEqual(paperFrameState('station',0).trainX,paperFrameState('station',3).trainX);
 assert.notEqual(paperFrameState('workshop',0).gearA,paperFrameState('workshop',1).gearA);
 assert.notDeepEqual(paperFrameState('hearth',0).flames,paperFrameState('hearth',0.5).flames);
 a.crowd[0].y=-999;assert.notEqual(paperFrameState('concert',0).crowd[0].y,-999);
 assert.equal(paperFrameState('opera',1).set,'hearth');assert.equal(paperFrameState('hearth',-5).t,0);assert.equal(paperFrameState('hearth',NaN).t,0);
});
test('paper frames paint full scenery on a fake context, distinct per set',()=>{
 const seen={};
 for(const {id} of listPaperSets()){const ctx=fakeCtx();drawPaperFrame(ctx,1280,720,id,1.5,{caption:false});
  const rects=ctx.calls.filter(c=>c[0]==='fillRect');assert.ok(rects.length>3,`${id} draws scenery`);
  assert.ok(rects.some(c=>c[1]===0&&c[2]===0),`${id} fills the frame, not a text card`);
  seen[id]=JSON.stringify(ctx.calls);assert.ok(!ctx.calls.some(c=>c[0]==='drawImage'),'no image assets in paper sets');}
 assert.equal(new Set(Object.values(seen)).size,4);
 const ctx=fakeCtx();drawPaperFrame(ctx,0,-2,'hearth',0);assert.ok(ctx.calls.length>0);
});
test('film settings default to paper theatre and persist via onSave',()=>{
 const p=ready();let saved=0;const s0=filmSettings(p);
 assert.equal(s0.mode,'paper');assert.equal(s0.subtitles,true);assert.equal(s0.style,'');
 const s1=saveFilmSettings(p,{mode:'images'},()=>saved++);
 assert.equal(s1.mode,'images');assert.equal(saved,1);assert.equal(p.video.film.mode,'images');
 const s2=saveFilmSettings(p,{sceneSet:{index:0,value:'station'}},()=>{});
 assert.equal(s2.sceneSets[0],'station');
 assert.equal(resolveSceneSet(s2,0,p.video.scenes[0].narratorText),'station');
 assert.equal(resolveSceneSet(s2,1,p.video.scenes[1].narratorText),suggestPaperSet(p.video.scenes[1].narratorText));
 const s3=saveFilmSettings(p,{style:'ink',subtitles:false},()=>{});
 assert.equal(s3.style,'ink');assert.equal(s3.subtitles,false);
 assert.throws(()=>saveFilmSettings(p,{sceneSet:{index:99,value:'hearth'}}),/Unknown scene/);
 assert.ok(!p.video.scenes.some(s=>s.image),'settings never auto-generate images');
});
test('gating: stale and approval block both modes; images block only image mode',()=>{
 const p=ready(),n=p.video.scenes.length,all=new Array(n).fill(true);
 assert.deepEqual(filmReadiness({stale:false,approvals:all,mode:'paper',imagesReady:[],consent:true}),{ok:true});
 assert.match(filmReadiness({stale:false,approvals:all,mode:'images',imagesReady:[],consent:true}).reason,/image/);
 assert.match(filmReadiness({stale:true,approvals:all,mode:'paper',imagesReady:[],consent:true}).reason,/storyboard/);
 assert.match(filmReadiness({stale:false,approvals:all.map((_,i)=>i!==0),mode:'paper',imagesReady:[],consent:true}).reason,/Approve/);
 assert.match(filmReadiness({stale:false,approvals:all,mode:'paper',imagesReady:[],consent:false}).reason,/permission/);
 reviseAnswer(p,p.answers[0].id,'A corrected memory.');
 assert.throws(()=>filmCards(p,5),/current storyboard/);
});
test('style preset joins directions within cap; motion helpers respect reduced motion',()=>{
 assert.equal(buildVisualNote('',''),'' );assert.ok(buildVisualNote('red door','ink').includes('red door'));
 assert.ok(buildVisualNote('red door','ink').includes('ink'));assert.ok(!/picasso|vangogh|monet/i.test(buildVisualNote('x','storybook')));
 assert.equal(buildVisualNote('x'.repeat(2000),'paper-theatre').length,1000);
 assert.equal(shouldReduceMotion({matchMedia:()=>({matches:true})}),true);
 assert.equal(shouldReduceMotion({matchMedia:()=>({matches:false})}),false);
 assert.equal(motionTime(3.5,false),3.5);assert.equal(motionTime(3.5,true),0);
});
test('export markup wires the format selector, sets, style, and subtitles',()=>{
 const p=ready(),html=videoExportMarkup(p);
 assert.ok(html.includes('name="clip-mode"')&&html.includes('value="paper"')&&html.includes('value="images"'));
 assert.equal((html.match(/data-paper-set/g)||[]).length,p.video.scenes.length);
 assert.ok(html.includes('id="clip-style"')&&html.includes('id="clip-subtitles"'));
 assert.ok(html.includes('A stylised adaptation')&&!html.includes('Generated with Meta Muse Image and saved'));
});
test('existing export contracts still hold: mime preference and pacing',()=>{
 assert.equal(recordingType(()=>true),'video/mp4;codecs=avc1.42E01E,mp4a.40.2');
 assert.equal(recordingType(()=>false),null);
 const p=ready();p.video.scenes.forEach((_,i)=>approveSceneIllustration(p,i));
 const cards=filmCards(p,5);assert.ok(cards.length>0&&cards.every(c=>c.seconds>0));
});
