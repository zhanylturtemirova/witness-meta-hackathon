import test from 'node:test';
import assert from 'node:assert/strict';
import {exampleProject,addRecordingMeta} from '../web/domain.js';
import {mockEvent,mockVideo} from '../web/mock-ai.js';
import {projectInput} from '../web/ai-client.js';
import {saveEvent,confirmEvent,saveVideo,recordFilmExport,filmExportStale} from '../web/event-model.js';
import {filmNarrationCandidates,resolveFilmNarration,planNarration,videoExportMarkup} from '../web/video-export.js';
import {saveFilmSettings} from '../web/paper-theatre.js';
function ready(){const p=exampleProject();saveEvent(p,mockEvent(projectInput(p)));confirmEvent(p,{title:p.event.title,summary:p.event.summary});const options={host:'thoughtful',setting:'garden',tone:'warm'};saveVideo(p,mockVideo({...projectInput(p),event:p.event,options}),options);return p;}
function linkRecording(p,answerIndex,id,durationSec=9.6){
 const a=p.answers[answerIndex];
 return addRecordingMeta(p,{id,question:a.question,questionKey:a.questionKey,durationSec});
}
test('narration candidates match storyboard answers in scene order, each recording once',()=>{
 const p=ready();
 linkRecording(p,0,'r0');linkRecording(p,1,'r1');linkRecording(p,2,'r2');
 const scenes=p.video.scenes.map(s=>p.answers.findIndex(a=>a.id===s.sourceRefs[0].answerId));
 const seen=[],expected=[];
 for(const i of scenes)if(!seen.includes(i)){seen.push(i);expected.push('r'+i);}
 const got=filmNarrationCandidates(p);
 assert.deepEqual(got.map(c=>c.id),expected);
 assert.ok(got.length<scenes.length,'repeated answers do not repeat recordings');
 assert.deepEqual(got.map(c=>c.answerIndex),seen);
 assert.equal(got[0].durationSec,9.6);
});
test('recordings for answers outside the storyboard are never narration candidates',()=>{
 const p=ready();
 linkRecording(p,0,'r0');
 addRecordingMeta(p,{id:'rx',question:'A question never asked.',questionKey:'["no","such","question"]',durationSec:5});
 const third=p.video.scenes.some(s=>s.sourceRefs[0].answerId===p.answers[2].id)?null:'r2';
 if(third)linkRecording(p,2,'r2');
 const ids=filmNarrationCandidates(p).map(c=>c.id);
 assert.ok(ids.includes('r0'));
 assert.ok(!ids.includes('rx'));
 assert.equal(new Set(ids).size,ids.length);
 assert.deepEqual(filmNarrationCandidates(ready()).map(c=>c.id),[]);
});
test('narration defaults to story recordings, honours exclusions and explicit silence',()=>{
 const p=ready();
 assert.equal(resolveFilmNarration(p).mode,'silent');
 assert.deepEqual(resolveFilmNarration(p).included,[]);
 linkRecording(p,0,'r0');linkRecording(p,1,'r1');
 let r=resolveFilmNarration(p);
 assert.equal(r.mode,'recordings');
 assert.deepEqual(r.included,['r0','r1'].filter(id=>r.candidates.some(c=>c.id===id)));
 saveFilmSettings(p,{narrationExcluded:['r0']},()=>{});
 r=resolveFilmNarration(p);
 assert.deepEqual(r.included,r.candidates.map(c=>c.id).filter(id=>id!=='r0'));
 assert.ok(!r.included.includes('r0'));
 saveFilmSettings(p,{narrationExcluded:['r0','unknown-id']},()=>{});
 assert.deepEqual(resolveFilmNarration(p).included,resolveFilmNarration(p).candidates.map(c=>c.id).filter(id=>id!=='r0'));
 saveFilmSettings(p,{narrationMode:'silent'},()=>{});
 assert.equal(resolveFilmNarration(p).mode,'silent');
 assert.deepEqual(resolveFilmNarration(p).included,[]);
 saveFilmSettings(p,{narrationMode:'upload'},()=>{});
 assert.equal(resolveFilmNarration(p).mode,'upload');
 assert.throws(()=>saveFilmSettings(p,{narrationMode:'karaoke'},()=>{}),/narration/i);
});
test('narration plays each recording once in order with no looping or stretching',()=>{
 assert.deepEqual(planNarration([9.57,4]),{offsets:[0,9.57],total:13.57});
 assert.deepEqual(planNarration([]),{offsets:[],total:0});
 assert.throws(()=>planNarration([179,2]),/three minutes/);
 assert.throws(()=>planNarration([-1]),/duration/);
 assert.throws(()=>planNarration(['x']),/duration/);
});
test('film markup lists included recordings with listen players and a silent choice',()=>{
 const p=ready();
 linkRecording(p,0,'r0',9.6);
 const html=videoExportMarkup(p);
 assert.ok(html.includes('data-narr-include="r0" checked'),'linked recording included by default');
 assert.ok(html.includes('data-narr-listen="r0"'),'listen player per recording');
 assert.ok(html.includes('Answer 1'),'recording shows its source answer');
 assert.match(html,/name="clip-narr" value="recordings" checked/,'recordings selected by default');
 assert.ok(html.includes('value="silent"'),'explicit silent choice');
 assert.match(html,/Originals are never changed/);
 const bare=videoExportMarkup(ready());
 assert.match(bare,/name="clip-narr" value="silent" checked/,'silent by default without recordings');
 assert.match(bare,/No saved recordings match this storyboard/);
});
test('exported films are recorded with their sources and flagged when the story changes',()=>{
 const p=ready();
 assert.equal(filmExportStale(p),false);
 recordFilmExport(p,{id:'f1',mimeType:'video/mp4',size:4609525,durationSec:23});
 assert.equal(p.video.filmExport.id,'f1');
 assert.equal(p.video.filmExport.eventRevision,p.event.revision);
 assert.equal(filmExportStale(p),false);
 p.answers[0].revision=2;
 assert.equal(filmExportStale(p),true);
 assert.throws(()=>recordFilmExport({video:null},{id:'x'}),/storyboard/);
 assert.throws(()=>recordFilmExport(p,{}),/film/i);
});
