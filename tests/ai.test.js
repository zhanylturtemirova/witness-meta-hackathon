import test from 'node:test';
import assert from 'node:assert/strict';
import {exampleProject,newProject,addAnswer,reviseAnswer} from '../web/domain.js';
import {witnessAI,projectInput} from '../web/ai-client.js';
import {saveEvent,confirmEvent,eventStale,saveVideo,videoStale} from '../web/event-model.js';
import {buildMetaRequest,runMetaTask,META_NETWORK_ENABLED} from '../server/ai/meta.mjs';
import {handleAI} from '../server/ai/routes.mjs';
import {handleSpeech} from '../server/transcribe.mjs';
const options={host:'thoughtful',setting:'garden',tone:'warm'};
async function confirmed(){const p=exampleProject();saveEvent(p,(await witnessAI.event(projectInput(p))).result);confirmEvent(p,{title:p.event.title,summary:p.event.summary});return p;}
test('Meta stays locked even with a key, and request preparation uses the structured contract',async()=>{
 let calls=0;await assert.rejects(runMetaTask('interview',projectInput(exampleProject()),{apiKey:'not-a-real-key',fetcher:async()=>{calls++;}}),/paused/);assert.equal(calls,0);assert.equal(META_NETWORK_ENABLED,false);
 const request=buildMetaRequest('event',projectInput(exampleProject()));assert.equal(request.model,'muse-spark-1.3');assert.equal(request.response_format.json_schema.name,'witness_event');assert.equal(request.response_format.json_schema.schema.additionalProperties,false);
 const response=await handleSpeech(new Request('http://localhost/api/speech-status'),{MODEL_API_KEY:'not-a-real-key',META_TRANSCRIPTION_ENABLED:'true'});assert.equal((await response.json()).configured,false);
});
test('mock interviewing follows context and avoids already-used question intents',async()=>{
 const p=newProject('small-moment');addAnswer(p,'I went to a concert with my sister.');let r=(await witnessAI.interview(projectInput(p))).result;assert.equal(r.intent,'people');assert.equal(r.sourceRefs[0].answerId,p.answers[0].id);p.interviewer=r;addAnswer(p,'We listened to the band together.');r=(await witnessAI.interview(projectInput(p))).result;assert.equal(r.intent,'detail');
});
test('event drafts keep uncertainty and missing facts, and require explicit confirmation',async()=>{
 const p=exampleProject();saveEvent(p,(await witnessAI.event(projectInput(p))).result);assert.equal(p.event.confirmed,false);assert.equal(p.event.dateText,'around 2018');assert.equal(p.event.location,'Manchester');assert.ok(p.event.detailsToConfirm.length);await assert.rejects(witnessAI.video({...projectInput(p),event:p.event,options}),/Confirm/);
 const empty=newProject('small-moment');addAnswer(empty,'A quiet afternoon with my sister.');const e=(await witnessAI.event(projectInput(empty))).result;assert.equal(e.dateText,null);assert.equal(e.location,null);
});
test('confirmed events produce source-linked plans; edits preserve old snapshots and require review',async()=>{
 const p=await confirmed();const result=(await witnessAI.video({...projectInput(p),event:p.event,options})).result;saveVideo(p,result,options);assert.equal(videoStale(p),false);const original=p.video.scenes[0].narratorText;assert.equal(original,p.answers[0].text);
 reviseAnswer(p,p.answers[0].id,'I went to a different concert in Manchester.');assert.equal(eventStale(p),true);assert.equal(videoStale(p),true);assert.equal(p.video.sourceAnswers[0].text,original);await assert.rejects(witnessAI.video({...projectInput(p),event:p.event,options}),/outdated/);assert.throws(()=>confirmEvent(p,{title:'Changed',summary:'Changed'}),/Rebuild/);
 saveEvent(p,(await witnessAI.event(projectInput(p))).result);assert.equal(p.event.confirmed,false);assert.equal(p.video.scenes[0].narratorText,original);
});
test('new answers invalidate event confirmation, and event revisions invalidate older video plans',async()=>{
 const p=await confirmed();saveVideo(p,(await witnessAI.video({...projectInput(p),event:p.event,options})).result,options);confirmEvent(p,{title:'A revised event',summary:p.event.summary});assert.equal(videoStale(p),true);
 addAnswer(p,'I remember the next morning too.');assert.equal(eventStale(p),true);await assert.rejects(witnessAI.video({...projectInput(p),event:p.event,options}),/new answers/);
});
test('local AI routes return mock results, reject bad sources and cross-origin posts',async()=>{
 const input=projectInput(exampleProject()),url='http://localhost/api/ai/event';let response=await handleAI(new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}));assert.equal(response.status,200);assert.equal((await response.json()).provider,'mock');
 response=await handleAI(new Request(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:JSON.stringify(input)}));assert.equal(response.status,403);
 const p=await confirmed();const bad=(await witnessAI.video({...projectInput(p),event:p.event,options})).result;bad.scenes[0].sourceRefs[0].revision=99;assert.throws(()=>saveVideo(p,bad,options),/outdated/);
});

test('video validation refuses invented narrator speech even when source IDs are valid',async()=>{
 const p=await confirmed(),result=(await witnessAI.video({...projectInput(p),event:p.event,options})).result;result.scenes[0].narratorText='Invented words that nobody said.';assert.throws(()=>saveVideo(p,result,options),/directly from a source/);assert.equal(p.video,undefined);
});
