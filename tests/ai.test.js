import test from 'node:test';
import assert from 'node:assert/strict';
import {exampleProject,newProject,addAnswer,reviseAnswer,setInterviewer,setReviewDraft,validProject} from '../web/domain.js';
import {witnessAI,projectInput,aiStatus,clearAIStatusCache} from '../web/ai-client.js';
import {saveEvent,confirmEvent,eventStale,saveVideo,videoStale,saveVerifiedEvent,eventVerification,captureEventGeneration,eventGenerationStale,eventStatus,upsertCollectionEvent,acceptCollectionEvent,entryStatus,findEntryByAnswers} from '../web/event-model.js';
import {runVerifiedEvent,verifiedEventEnvelope} from '../web/event-verify.js';
import {mockEventGenerate,mockVerifyEvent,mockEditorGenerate,mockEditorVerify,mockPeriodGenerate,mockVideo} from '../web/mock-ai.js';
import {validateVerifyOutput,validateAIResult,validateAIInput} from '../web/ai-contracts.js';
import {buildMetaRequest,runMetaTask,META_NETWORK_ENABLED,META_TEXT_NETWORK_ENABLED,META_SPEECH_NETWORK_ENABLED,isTextLiveEnabled} from '../server/ai/meta.mjs';
import {handleAI} from '../server/ai/routes.mjs';
import {handleSpeech} from '../server/transcribe.mjs';
import {runArchivist,ARCHIVIST_MAX_CALLS,ARCHIVIST_MAX_GROUPS} from '../web/archivist.js';
const options={host:'thoughtful',setting:'garden',tone:'warm'};
const liveEnv={META_AI_ENABLED:'true',MODEL_API_KEY:'test-key-not-real'};
async function confirmed(){const p=exampleProject();saveEvent(p,(await witnessAI.event(projectInput(p),{provider:'mock'})).result);confirmEvent(p,{title:p.event.title,summary:p.event.summary});return p;}
function metaOk(result){return async()=>Response.json({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]});}
test('live text needs server key and flag, stays mock by default, and keeps the structured contract',async()=>{
 assert.equal(META_NETWORK_ENABLED,false);assert.equal(META_TEXT_NETWORK_ENABLED,true);assert.equal(META_SPEECH_NETWORK_ENABLED,true);
 await assert.rejects(runMetaTask('interview',projectInput(exampleProject()),{}),/server API key is required/);
 const vp=await confirmed(),boardInput={...projectInput(vp),event:vp.event,options},board=mockVideo(boardInput);
 const planned=await runMetaTask('video',boardInput,{apiKey:'x',fetcher:metaOk(board)});assert.equal(planned.provider,'meta');assert.equal(planned.result.scenes.length,board.scenes.length);
 await assert.rejects(runMetaTask('video',boardInput,{apiKey:'x',fetcher:async()=>Response.json({})}),/incomplete response/);
 const fake=async()=>Response.json({});
 assert.equal(isTextLiveEnabled({},globalThis.fetch),false);
 assert.equal(isTextLiveEnabled(liveEnv,globalThis.fetch),true);
 assert.equal(isTextLiveEnabled(liveEnv,fake),true);
 assert.equal(isTextLiveEnabled({META_AI_ENABLED:'true'},fake),false);
 assert.equal(isTextLiveEnabled({MODEL_API_KEY:'x'},fake),false);
 const request=buildMetaRequest('event',projectInput(exampleProject()));assert.equal(request.model,'muse-spark-1.3');assert.equal(request.response_format.json_schema.name,'witness_event');assert.equal(request.response_format.json_schema.schema.additionalProperties,false);
 const response=await handleSpeech(new Request('http://localhost/api/speech-status'),{MODEL_API_KEY:'not-a-real-key',META_TRANSCRIPTION_ENABLED:'true'});assert.equal((await response.json()).configured,true);
 const unflagged=await handleSpeech(new Request('http://localhost/api/speech-status'),{MODEL_API_KEY:'not-a-real-key'});assert.equal((await unflagged.json()).configured,false);
});
test('mock interviewing follows context and avoids already-used question intents',async()=>{
 clearAIStatusCache();
 const p=newProject('small-moment');addAnswer(p,'I went to a concert with my sister.');let r=(await witnessAI.interview(projectInput(p),{provider:'mock'})).result;assert.equal(r.intent,'people');assert.equal(r.sourceRefs[0].answerId,p.answers[0].id);p.interviewer=r;addAnswer(p,'We listened to the band together.');r=(await witnessAI.interview(projectInput(p),{provider:'mock'})).result;assert.equal(r.intent,'detail');
});
test('a refusal is acknowledged instead of pressed',async()=>{
 const p=newProject('small-moment');addAnswer(p,"I'd rather not talk about that night.");
 const r=(await witnessAI.interview(projectInput(p),{provider:'mock'})).result;
 assert.equal(r.intent,'wrap_up');assert.match(r.question,/Thank you for telling me/);
 const q=newProject('small-moment');addAnswer(q,"I don't want to forget the smell of rain that day.");
 const r2=(await witnessAI.interview(projectInput(q),{provider:'mock'})).result;
 assert.equal(/Thank you for telling me/.test(r2.question),false);
});
test('the archivist groups distinct occasions with disjoint valid references',async()=>{
 const p=newProject('small-moment');
 addAnswer(p,'We went to a concert in Manchester. The band played until late.');
 addAnswer(p,'The music was so loud my sister covered her ears and laughed.');
 addAnswer(p,'We moved to a new city that autumn with two suitcases.');
 const r=(await witnessAI.archivist(projectInput(p),{provider:'mock'})).result;
 assert.ok(r.groups.length>=2);
 const seen=[];
 for(const g of r.groups){assert.ok(g.label.length>0);assert.ok(g.answerRefs.length>0);seen.push(...g.answerRefs.map(x=>x.answerId));}
 assert.equal(new Set(seen).size,seen.length);
});
test('archivist groupings reject double-grouped and unknown answers',async()=>{
 const p=exampleProject(),answers=projectInput(p).answers;
 const dup={groups:[{label:'A',answerRefs:[{answerId:answers[0].id,revision:answers[0].revision}]},{label:'B',answerRefs:[{answerId:answers[0].id,revision:answers[0].revision}]}]};
 assert.throws(()=>validateAIResult('archivist',dup,answers),/two event groups/);
 assert.throws(()=>validateAIResult('archivist',{groups:[]},answers),/incomplete/);
});
test('editor wording verifies on the first pass and keeps distinctive words',async()=>{
 const p=newProject('person');addAnswer(p,'My grandmother hummed an old lullaby while the kettle rattled on the stove.');
 const env=await witnessAI.editor({...projectInput(p),passage:p.answers[0].text},{provider:'mock'});
 assert.equal(env.verification.status,'verified');assert.equal(env.verification.attempts,1);
 assert.ok(env.result.proposal.includes('lullaby'));
 assert.ok(env.result.keptPhrases.some(w=>/lullaby|grandmother|rattled/i.test(w)));
 for(const w of env.result.keptPhrases)assert.ok(env.result.proposal.toLowerCase().includes(w.toLowerCase()));
});
test('editor repair removes an unsupported claim within the same bounded loop',async()=>{
 const p=newProject('person');addAnswer(p,'My grandmother hummed an old lullaby while the kettle rattled.');
 const input={...projectInput(p),passage:'My grandmother hummed in 1999 while the kettle rattled.'};
 const run=await runVerifiedEvent(input,{verifier:'mock',generate:mockEditorGenerate,verify:mockEditorVerify,validate:(r,a)=>validateAIResult('editor',r,a)});
 assert.equal(run.status,'verified');assert.equal(run.attempts,2);
 assert.ok(!run.event.proposal.includes('1999'));
 const env=verifiedEventEnvelope(run);assert.equal(env.verification.attempts,2);assert.equal(env.rejected,null);
});
test('editor repair requests validate the draft and its issues',async()=>{
 const p=newProject('person');addAnswer(p,'A short memory of home.');
 const input={...projectInput(p),passage:'A short memory of home.'};
 assert.throws(()=>validateAIInput('editor',{...input,repair:{candidate:{proposal:'x',keptPhrases:[],sourceRefs:[]},issues:[]}}),/repair request/);
});
test('archivist and editor routes serve mocks by default and live with a key',async()=>{
 const post=(url,body,env,fetcher)=>handleAI(new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env,fetcher);
 const p=exampleProject(),ainput=projectInput(p);
 let response=await post('http://localhost/api/ai/archivist',ainput);
 assert.equal(response.status,200);assert.equal((await response.json()).provider,'mock');
 response=await post('http://localhost/api/ai/editor',{...ainput,passage:p.answers[0].text});
 assert.equal(response.status,200);
 const envelope=await response.json();assert.equal(envelope.provider,'mock');assert.equal(envelope.verification.status,'verified');
 response=await post('http://localhost/api/ai/editor',{...ainput,passage:p.answers[0].text,repair:{candidate:{},issues:[]}});
 assert.equal(response.status,400);
 const groups={groups:[{label:'Evening',answerRefs:[{answerId:p.answers[0].id,revision:p.answers[0].revision}]}]};
 response=await post('http://localhost/api/ai/archivist',ainput,liveEnv,metaOk(groups));
 assert.equal(response.status,200);
 const live=await response.json();assert.equal(live.provider,'meta');assert.equal(live.result.groups[0].label,'Evening');
});
test('interview inputs carry recording dates separately from event dates',async()=>{
 const p=newProject('person');const a=addAnswer(p,'Something from today.');
 const dated=projectInput(p).answers[0];
 assert.match(dated.recordedAt,/^\d{4}-\d{2}-\d{2}$/);
 delete a.createdAt;
 assert.equal(projectInput(p).answers[0].recordedAt,null);
});
test('period routes serve mocks by default and live with a key',async()=>{
 const post=(url,body,env,fetcher)=>handleAI(new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env,fetcher);
 const p=exampleProject(),input={...projectInput(p),weekStart:'2026-11-02',timeZone:'UTC'};
 let response=await post('http://localhost/api/ai/period',input);
 assert.equal(response.status,200);
 const envelope=await response.json();
 assert.equal(envelope.provider,'mock');
 assert.equal(envelope.verification.status,'verified');
 assert.equal(envelope.result.rangeText,'Nov 2 – Nov 8, 2026');
 assert.ok(envelope.result.narrative.includes('Manchester'));
 response=await post('http://localhost/api/ai/period',{...input,repair:{candidate:{},issues:[]}});
 assert.equal(response.status,400);
 const good=(await mockPeriodGenerate(input,null)).result;
 const calls=[];
 response=await post('http://localhost/api/ai/period',input,liveEnv,async(url,init)=>{
  const body=JSON.parse(init.body),name=body.response_format.json_schema.name;
  calls.push(name);
  assert.equal(body.model,'muse-spark-1.3');
  const payload=name==='witness_verify'?{supported:true,issues:[]}:good;
  return Response.json({choices:[{message:{content:JSON.stringify(payload)},finish_reason:'stop'}]});
 });
 assert.equal(response.status,200);
 const live=await response.json();
 assert.deepEqual(calls,['witness_period','witness_verify']);
 assert.equal(live.provider,'meta');
 assert.equal(live.verification.status,'verified');
 assert.equal(live.verification.verifier,'meta');
});
test('weekly drafts validate their candidates, issues, and repairs',async()=>{
 const p=exampleProject(),answers=projectInput(p).answers;
 const refs=answers.map(a=>({answerId:a.id,revision:a.revision}));
 const draft={title:'A week',rangeText:'Nov 2 – Nov 8, 2026',narrative:'A concert with my sister.',sourceRefs:refs,paragraphRefs:[{paragraph:'A concert with my sister.',sourceRefs:refs}]};
 validateAIResult('period',draft,answers);
 assert.throws(()=>validateAIResult('period',{...draft,narrative:''},answers),/incomplete/);
 const issue={field:'narrative',statement:'A concert with my sister.',answerRefs:refs,reason:'contradiction'};
 validateVerifyOutput({supported:false,issues:[issue]},draft,answers);
 assert.throws(()=>validateVerifyOutput({supported:false,issues:[{...issue,field:'rangeText'}]},draft,answers),/could not be read/);
 buildMetaRequest('verify',{title:p.title,answers,candidate:draft});
 assert.throws(()=>validateAIInput('period',{title:p.title,weekStart:'2026-11-02',timeZone:'UTC',answers,repair:{candidate:draft,issues:[]}}),/repair request/);
 validateAIInput('period',{title:p.title,weekStart:'2026-11-02',timeZone:'UTC',answers,repair:{candidate:draft,issues:[issue]}});
});
test('period and match contracts validate their shapes',async()=>{
 const answers=projectInput(exampleProject()).answers;
 const refs=[{answerId:answers[0].id,revision:answers[0].revision}];
 validateAIResult('period',{title:'A week',rangeText:'Nov 1–7',narrative:'A quiet week.',sourceRefs:refs,paragraphRefs:[{paragraph:'A quiet week.',sourceRefs:refs}]},answers);
 validateAIResult('match',{matchType:'similar_experience',reason:'Both evenings end with music.',evidenceRefs:refs},answers);
 assert.throws(()=>validateAIResult('period',{title:'',rangeText:'x',narrative:'y',sourceRefs:refs},answers),/incomplete/);
 assert.throws(()=>validateAIResult('match',{matchType:'same_street',reason:'x',evidenceRefs:refs},answers),/incomplete/);
});
test('event drafts keep uncertainty and missing facts, and require explicit confirmation',async()=>{
 const p=exampleProject();saveEvent(p,(await witnessAI.event(projectInput(p),{provider:'mock'})).result);assert.equal(p.event.confirmed,false);assert.equal(p.event.dateText,'around 2018');assert.equal(p.event.location,'Manchester');assert.ok(p.event.detailsToConfirm.length);await assert.rejects(witnessAI.video({...projectInput(p),event:p.event,options}),/Confirm/);
 const empty=newProject('small-moment');addAnswer(empty,'A quiet afternoon with my sister.');const e=(await witnessAI.event(projectInput(empty),{provider:'mock'})).result;assert.equal(e.dateText,null);assert.equal(e.location,null);
});
test('saved events keep a stable identity independent of their title',async()=>{
 const p=exampleProject();saveEvent(p,(await witnessAI.event(projectInput(p),{provider:'mock'})).result);
 const id=p.event.id;assert.equal(typeof id,'string');assert.ok(id.length>0);
 confirmEvent(p,{title:p.event.title,summary:p.event.summary});assert.equal(p.event.id,id);
 reviseAnswer(p,p.answers[0].id,'I went to a different concert in Manchester.');
 saveEvent(p,(await witnessAI.event(projectInput(p),{provider:'mock'})).result);
 assert.equal(p.event.id,id);assert.equal(p.event.revision,3);
 const q=exampleProject();saveEvent(q,(await witnessAI.event(projectInput(q),{provider:'mock'})).result);
 assert.notEqual(q.event.id,id);
});
test('collection entries upsert by identity and track their own sources',async()=>{
 const p=exampleProject();
 const draft=(await witnessAI.event(projectInput(p),{provider:'mock'})).result;
 const entry=acceptCollectionEvent(p,{...draft,sourceRefs:[{answerId:p.answers[0].id,revision:p.answers[0].revision}]},{provider:'mock',model:null});
 assert.equal(typeof entry.id,'string');assert.equal(entry.revision,1);assert.equal(entry.confirmed,false);
 assert.equal(p.events.length,1);
 assert.equal(findEntryByAnswers(p,[p.answers[0].id])?.id,entry.id);
 assert.equal(findEntryByAnswers(p,['nope']),null);
 assert.equal(entryStatus(entry,p.answers),'Draft');
 entry.confirmed=true;assert.equal(entryStatus(entry,p.answers),'Confirmed');
 reviseAnswer(p,p.answers[0].id,'A rewritten evening with new details.');
 assert.equal(entryStatus(entry,p.answers),'Needs review');
 assert.equal(entryStatus(null,p.answers),null);
});
test('the verified single event mirrors into the collection',async()=>{
 const p=exampleProject();
 saveEvent(p,(await witnessAI.event(projectInput(p),{provider:'mock'})).result);
 assert.equal(p.events.length,1);assert.equal(p.events[0].id,p.event.id);
 confirmEvent(p,{title:p.event.title,summary:p.event.summary});
 assert.equal(p.events.length,1);assert.equal(p.events[0].confirmed,true);
});
test('projects validate an optional well-formed event collection',async()=>{
 const p=exampleProject();assert.equal(validProject(p),true);
 p.events=[{id:'e1',title:'Evening'}];assert.equal(validProject(p),true);
 p.events=[{id:'e1'}];assert.equal(validProject(p),false);
});
test('stale events read as Needs review instead of Confirmed',async()=>{
 const p=exampleProject();saveEvent(p,(await witnessAI.event(projectInput(p),{provider:'mock'})).result);
 assert.equal(eventStatus(p),'Draft');
 confirmEvent(p,{title:p.event.title,summary:p.event.summary});assert.equal(eventStatus(p),'Confirmed');
 reviseAnswer(p,p.answers[0].id,'A changed evening.');
 assert.equal(eventStatus(p),'Needs review');
 assert.equal(eventStatus(newProject('person')),null);
});
test('confirmed events produce source-linked plans; edits preserve old snapshots and require review',async()=>{
 const p=await confirmed();const result=(await witnessAI.video({...projectInput(p),event:p.event,options})).result;saveVideo(p,result,options);assert.equal(videoStale(p),false);const original=p.video.scenes[0].narratorText;assert.equal(original,p.answers[0].text);
 reviseAnswer(p,p.answers[0].id,'I went to a different concert in Manchester.');assert.equal(eventStale(p),true);assert.equal(videoStale(p),true);assert.equal(p.video.sourceAnswers[0].text,original);await assert.rejects(witnessAI.video({...projectInput(p),event:p.event,options}),/outdated/);assert.throws(()=>confirmEvent(p,{title:'Changed',summary:'Changed'}),/Rebuild/);
 saveEvent(p,(await witnessAI.event(projectInput(p),{provider:'mock'})).result);assert.equal(p.event.confirmed,false);assert.equal(p.video.scenes[0].narratorText,original);
});
test('new answers invalidate event confirmation, and event revisions invalidate older video plans',async()=>{
 const p=await confirmed();saveVideo(p,(await witnessAI.video({...projectInput(p),event:p.event,options})).result,options);confirmEvent(p,{title:'A revised event',summary:p.event.summary});assert.equal(videoStale(p),true);
 addAnswer(p,'I remember the next morning too.');assert.equal(eventStale(p),true);await assert.rejects(witnessAI.video({...projectInput(p),event:p.event,options}),/new answers/);
});
test('local AI routes stay mock when disabled, and video goes live when enabled',async()=>{
 const input=projectInput(exampleProject()),url='http://localhost/api/ai/event';let response=await handleAI(new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}));assert.equal(response.status,200);assert.equal((await response.json()).provider,'mock');
 response=await handleAI(new Request(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:JSON.stringify(input)}));assert.equal(response.status,403);
 response=await handleAI(new Request('http://localhost/api/ai-status'),{});assert.equal((await response.json()).textLiveAvailable,false);
 response=await handleAI(new Request('http://localhost/api/ai-status'),liveEnv,async()=>Response.json({}));const status=await response.json();assert.equal(status.textLiveAvailable,true);assert.deepEqual(status.liveTasks,['interview','event','archivist','editor','period','discovery','video']);
 const p=await confirmed(),vinput={...projectInput(p),event:p.event,options};
 response=await handleAI(new Request('http://localhost/api/ai/video',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(vinput)}),{},async()=>{throw Error('video must stay local when disabled');});assert.equal(response.status,200);assert.equal((await response.json()).provider,'mock');
 response=await handleAI(new Request('http://localhost/api/ai/video',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(vinput)}),liveEnv,metaOk(mockVideo(vinput)));assert.equal(response.status,200);const planned=await response.json();assert.equal(planned.provider,'meta');assert.ok(planned.result.scenes.length>=4&&planned.result.scenes.length<=6);assert.ok(planned.result.styleSpec);
 const bad=(await witnessAI.video({...projectInput(p),event:p.event,options})).result;bad.scenes[0].sourceRefs[0].revision=99;assert.throws(()=>saveVideo(p,bad,options),/outdated/);
});
test('live interview dispatch validates sources and keeps answers on provider failures',async()=>{
 const p=exampleProject(),input=projectInput(p);
 const good={question:'What stayed with you from that night?',intent:'meaning',sourceRefs:[{answerId:p.answers[2].id,revision:1}],enoughMaterial:true,suggestedNextStep:'review_event'};
 let seen={};
 let response=await handleAI(new Request('http://localhost/api/ai/interview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),liveEnv,async(url,init)=>{seen={url,auth:init.headers.Authorization,model:JSON.parse(init.body).model};return Response.json({choices:[{message:{content:JSON.stringify(good)},finish_reason:'stop'}]});});
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.provider,'meta');assert.equal(data.result.question,good.question);
 assert.equal(seen.url,'https://api.meta.ai/v1/chat/completions');assert.equal(seen.auth,'Bearer test-key-not-real');assert.equal(seen.model,'muse-spark-1.3');
 response=await handleAI(new Request('http://localhost/api/ai/interview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),liveEnv,async()=>Response.json({message:'busy'},{status:429}));
 assert.equal(response.status,429);assert.match((await response.json()).error,/still saved/);
 response=await handleAI(new Request('http://localhost/api/ai/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),liveEnv,async()=>Response.json({choices:[{message:{content:'{"title":"x"}'},finish_reason:'length'}]}));
 assert.equal(response.status,502);
 const badRefs={...good,sourceRefs:[{answerId:p.answers[0].id,revision:99}]};
 response=await handleAI(new Request('http://localhost/api/ai/interview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),liveEnv,metaOk(badRefs));
 assert.equal(response.status,502);
 const speech=await handleSpeech(new Request('http://localhost/api/speech-status'),liveEnv);assert.equal((await speech.json()).configured,false);
});
test('editing an answer during event generation keeps the edits when the request completes',async()=>{
 const p=await confirmed();
 const inputBefore=projectInput(p),capture=captureEventGeneration(p),originalTitle=p.event.title;
 reviseAnswer(p,p.answers[0].id,'I went to a different concert in Manchester.');
 const lateResult=(await witnessAI.event(inputBefore,{provider:'mock'})).result;
 assert.equal(eventGenerationStale(capture,p),true);
 if(!eventGenerationStale(capture,p))saveEvent(p,lateResult);
 assert.equal(p.event.title,originalTitle);
 assert.equal(p.answers[0].text,'I went to a different concert in Manchester.');
 assert.equal(p.answers[0].revision,2);
 assert.equal(eventGenerationStale(captureEventGeneration(p),p),false);
});
test('event drafts and interview questions keep their provider and model',async()=>{
 const p=exampleProject();
 const draft=(await witnessAI.event(projectInput(p),{provider:'mock'})).result;
 saveEvent(p,draft,{provider:'meta',model:'muse-spark-1.3'});
 assert.equal(p.event.provider,'meta');assert.equal(p.event.model,'muse-spark-1.3');
 confirmEvent(p,{title:p.event.title,summary:p.event.summary});
 assert.equal(p.event.provider,'meta');assert.equal(p.event.model,'muse-spark-1.3');
 const q=(await witnessAI.interview(projectInput(p),{provider:'mock'})).result;
 setInterviewer(p,{provider:'mock',model:null,result:q});
 assert.equal(p.interviewer.provider,'mock');assert.equal(p.interviewer.model,null);
 assert.equal(p.interviewer.question,q.question);
});
test('video validation refuses invented narrator speech even when source IDs are valid',async()=>{
 const p=await confirmed(),result=(await witnessAI.video({...projectInput(p),event:p.event,options})).result;result.scenes[0].narratorText='Invented words that nobody said.';assert.throws(()=>saveVideo(p,result,options),/directly from a source/);assert.equal(p.video,undefined);
});
test('browser uses mocks for static mode and never silently falls back after a live failure',async()=>{
 const realFetch=globalThis.fetch;
 try{
  clearAIStatusCache();globalThis.fetch=async()=>{throw Error('no server');};
  let status=await aiStatus(true);assert.equal(status.textLiveAvailable,false);
  let r=await witnessAI.interview(projectInput(exampleProject()));assert.equal(r.provider,'mock');
  clearAIStatusCache();
  let posts=0;
  globalThis.fetch=async(url,init)=>{
   if(url==='/api/ai-status')return Response.json({provider:'meta',textLiveAvailable:true,liveTasks:['interview','event'],model:'muse-spark-1.3'});
   if(url==='/api/ai/interview'&&init?.method==='POST'){posts++;return Response.json({error:'Meta is busy. Your answers are still saved.'},{status:429});}
   throw Error('unexpected '+url);
  };
  await assert.rejects(witnessAI.interview(projectInput(exampleProject())),/still saved/);assert.equal(posts,1);
  r=await witnessAI.interview(projectInput(exampleProject()),{provider:'mock'});assert.equal(r.provider,'mock');assert.equal(posts,1);
  await assert.rejects(witnessAI.interview(projectInput(exampleProject()),{provider:'live'}),/still saved/);assert.equal(posts,2);
  clearAIStatusCache();
  globalThis.fetch=async(url)=>{if(url==='/api/ai-status')return Response.json({provider:'meta',textLiveAvailable:true,liveTasks:['interview','event']});throw Error('video must stay local');};
  const p=exampleProject();saveEvent(p,(await witnessAI.event(projectInput(p),{provider:'mock'})).result);confirmEvent(p,{title:p.event.title,summary:p.event.summary});
  const v=await witnessAI.video({...projectInput(p),event:p.event,options});assert.equal(v.provider,'mock');
 }finally{globalThis.fetch=realFetch;clearAIStatusCache();}
});
test('verified event generation accepts a supported draft on the first pass',async()=>{
 const p=exampleProject();
 const env=await witnessAI.event(projectInput(p),{provider:'mock'});
 assert.equal(env.verification.status,'verified');
 assert.equal(env.verification.attempts,1);
 assert.equal(env.verification.verifier,'mock');
 assert.deepEqual(env.verification.issues,[]);
 assert.ok(env.result);assert.equal(env.rejected,null);
 assert.equal(env.result.dateText,'around 2018');
});
test('verification repairs an overconfident summary and accepts the second candidate',async()=>{
 const p=newProject('small-moment');
 addAnswer(p,'I went to a concert in Manchester in 2019.');
 addAnswer(p,'I think it rained that evening, but I am not sure.');
 const input=projectInput(p),repairs=[];
 const run=await runVerifiedEvent(input,{verifier:'mock',
  generate:async(inp,rep)=>{if(rep)repairs.push(rep);return mockEventGenerate(inp,rep);},
  verify:async(cand,ans)=>mockVerifyEvent(cand,ans)});
 assert.equal(run.status,'verified');assert.equal(run.attempts,2);
 assert.equal(repairs.length,1);assert.equal(repairs[0].issues.length,1);
 assert.equal(repairs[0].issues[0].reason,'certainty_overreach');
 assert.match(run.event.summary,/not sure/);
});
test('verification stops after two candidates and never accepts on the limit',async()=>{
 const p=exampleProject(),input=projectInput(p);
 const good=(await mockEventGenerate(input,null)).result;
 let genCalls=0,verCalls=0;
 const issueFor=c=>({field:'summary',statement:String(c.summary).split(/(?<=[.!?])\s/)[0],answerRefs:c.sourceRefs,reason:'contradiction'});
 const run=await runVerifiedEvent(input,{verifier:'mock',
  generate:async()=>{genCalls++;return {provider:'mock',model:null,result:JSON.parse(JSON.stringify(good))};},
  verify:async(cand)=>{verCalls++;return {supported:false,issues:[issueFor(cand)]};}});
 assert.equal(run.status,'unresolved');assert.equal(run.attempts,2);
 assert.equal(genCalls,2);assert.equal(verCalls,2);
 assert.equal(run.event,null);assert.equal(run.issues.length,1);
 assert.ok(run.rejected);
 assert.equal(saveVerifiedEvent(p,captureEventGeneration(p),verifiedEventEnvelope(run)),false);
 assert.equal(p.event,undefined);
});
test('invalid verifier output aborts without repair',async()=>{
 const p=exampleProject(),input=projectInput(p);
 const good=(await mockEventGenerate(input,null)).result;
 const firstLine=String(good.summary).split(/(?<=[.!?])\s/)[0];
 const cases=[
  {supported:false,issues:[]},
  {supported:true,issues:[{field:'summary',statement:'x',answerRefs:[],reason:'invented_fact'}]},
  {supported:false,issues:[{field:'summary',statement:firstLine,answerRefs:[{answerId:'nope',revision:1}],reason:'invented_fact'}]},
  {supported:false,issues:[{field:'location',statement:firstLine,answerRefs:good.sourceRefs,reason:'invented_fact'}]},
 ];
 for(const output of cases){
  let genCalls=0,verCalls=0;
  await assert.rejects(runVerifiedEvent(input,{verifier:'mock',
   generate:async()=>{genCalls++;return {provider:'mock',model:null,result:JSON.parse(JSON.stringify(good))};},
   verify:async()=>{verCalls++;return JSON.parse(JSON.stringify(output));}}));
  assert.equal(genCalls,1);assert.equal(verCalls,1);
 }
});
test('a candidate with unknown source references gets one fresh attempt',async()=>{
 const p=exampleProject(),input=projectInput(p);
 const good=(await mockEventGenerate(input,null)).result;
 const bad=JSON.parse(JSON.stringify(good));bad.sourceRefs[0]={answerId:bad.sourceRefs[0].answerId,revision:99};
 let calls=0;const repairs=[];
 const run=await runVerifiedEvent(input,{verifier:'mock',
  generate:async(inp,rep)=>{calls++;repairs.push(rep||null);const r=calls===1?bad:JSON.parse(JSON.stringify(good));return {provider:'mock',model:null,result:r};},
  verify:async()=>({supported:true,issues:[]})});
 assert.equal(run.status,'verified');assert.equal(run.attempts,2);assert.equal(calls,2);
 assert.equal(repairs[1],null);
});
test('the overall deadline aborts the operation without further calls',async()=>{
 const p=exampleProject(),input=projectInput(p);
 const good=(await mockEventGenerate(input,null)).result;
 let now=1000,genCalls=0,verCalls=0;const budgets=[];
 await assert.rejects(runVerifiedEvent(input,{verifier:'mock',now:()=>now,deadlineMs:500,
  generate:async(inp,rep,opts)=>{genCalls++;budgets.push(opts.timeoutMs);now+=600;return {provider:'mock',model:null,result:JSON.parse(JSON.stringify(good))};},
  verify:async()=>{verCalls++;return {supported:true,issues:[]};}}),/took too long/);
 assert.equal(genCalls,1);assert.equal(verCalls,0);
 assert.deepEqual(budgets,[500]);
 now=0;const seen=[];
 await runVerifiedEvent(input,{verifier:'mock',now:()=>now,deadlineMs:1000,
  generate:async(inp,rep,opts)=>{seen.push(opts.timeoutMs);now+=100;return {provider:'mock',model:null,result:JSON.parse(JSON.stringify(good))};},
  verify:async(cand,ans,opts)=>{seen.push(opts.timeoutMs);return {supported:true,issues:[]};}});
 assert.deepEqual(seen,[1000,900]);
});
test('provider errors abort without regeneration',async()=>{
 const p=exampleProject(),input=projectInput(p);
 for(const status of [401,402,403,429]){
  let genCalls=0,verCalls=0;
  const err=Error('provider failed');err.status=status;
  await assert.rejects(runVerifiedEvent(input,{verifier:'meta',
   generate:async()=>{genCalls++;throw err;},
   verify:async()=>{verCalls++;return {supported:true,issues:[]};}}),/provider failed/);
  assert.equal(genCalls,1);assert.equal(verCalls,0);
 }
 const good=(await mockEventGenerate(input,null)).result;
 let genCalls=0,verCalls=0;
 const issue={field:'summary',statement:String(good.summary).split(/(?<=[.!?])\s/)[0],answerRefs:good.sourceRefs,reason:'contradiction'};
 await assert.rejects(runVerifiedEvent(input,{verifier:'meta',
  generate:async()=>{genCalls++;if(genCalls>1){const e=Error('late failure');e.status=429;throw e;}return {provider:'meta',model:'muse-spark-1.3',result:JSON.parse(JSON.stringify(good))};},
  verify:async()=>{verCalls++;return {supported:false,issues:[JSON.parse(JSON.stringify(issue))]};}}),/late failure/);
 assert.equal(genCalls,2);assert.equal(verCalls,1);
});
test('unresolved verification preserves the existing event and drafts',async()=>{
 const p=await confirmed();
 setReviewDraft(p,p.answers[0].id,'Unsaved wording stays.');
 const originalTitle=p.event.title,originalRevision=p.event.revision,originalText=p.answers[0].text;
 const unresolved={provider:'mock',model:null,result:null,rejected:null,verification:{status:'unresolved',issues:[],attempts:2,verifier:'mock'}};
 assert.equal(saveVerifiedEvent(p,captureEventGeneration(p),unresolved),false);
 assert.equal(p.event.title,originalTitle);assert.equal(p.event.revision,originalRevision);
 assert.equal(p.answers[0].text,originalText);
 assert.equal(p.reviewDrafts[p.answers[0].id],'Unsaved wording stays.');
});
test('editing event content or sources invalidates the verification label',async()=>{
 const p=exampleProject();
 const env=await witnessAI.event(projectInput(p),{provider:'mock'});
 assert.equal(env.verification.status,'verified');
 assert.equal(saveVerifiedEvent(p,captureEventGeneration(p),env),true);
 let v=eventVerification(p);assert.ok(v);assert.equal(v.verifier,'mock');assert.equal(v.attempts,1);
 p.event={...p.event,title:'Edited title',revision:p.event.revision+1,confirmed:false};
 assert.equal(eventVerification(p),null);
 assert.equal(saveVerifiedEvent(p,captureEventGeneration(p),env),true);
 assert.ok(eventVerification(p));
 reviseAnswer(p,p.answers[0].id,'Changed answer.');
 assert.equal(eventVerification(p),null);
});
test('narrator confirmation stays separate from model verification',async()=>{
 const p=exampleProject();
 const draft=(await witnessAI.event(projectInput(p),{provider:'mock'})).result;
 saveEvent(p,draft);
 assert.equal(eventVerification(p),null);
 confirmEvent(p,{title:p.event.title,summary:p.event.summary});
 assert.equal(p.event.confirmed,true);
 const q=exampleProject();
 const env=await witnessAI.event(projectInput(q),{provider:'mock'});
 assert.equal(saveVerifiedEvent(q,captureEventGeneration(q),env),true);
 confirmEvent(q,{title:q.event.title,summary:q.event.summary});
 assert.equal(q.event.confirmed,true);
 assert.ok(eventVerification(q));
});
test('uncertainty notes cannot hide an unchanged unsupported claim',async()=>{
 const p=exampleProject(),input=projectInput(p);
 const base=(await mockEventGenerate(input,null)).result;
 const doctored={...base,dateText:'1999',detailsToConfirm:['Some details are uncertain.']};
 const checked=mockVerifyEvent(doctored,p.answers);
 assert.equal(checked.supported,false);
 assert.ok(checked.issues.some(i=>i.field==='dateText'&&i.reason==='invented_fact'));
 const wrongField={supported:false,issues:[{field:'location',statement:doctored.dateText,answerRefs:doctored.sourceRefs,reason:'invented_fact'}]};
 assert.throws(()=>validateVerifyOutput(wrongField,doctored,p.answers),/does not match/);
});
test('first-event unresolved verification recovers without losing work',async()=>{
 const p=newProject('small-moment');
 addAnswer(p,'I went to a concert in Manchester in 2019.');
 const input=projectInput(p);
 const good=(await mockEventGenerate(input,null)).result;
 const issue={field:'summary',statement:String(good.summary).split(/(?<=[.!?])\s/)[0],answerRefs:good.sourceRefs,reason:'contradiction'};
 const run=await runVerifiedEvent(input,{verifier:'mock',
  generate:async()=>({provider:'mock',model:null,result:JSON.parse(JSON.stringify(good))}),
  verify:async()=>({supported:false,issues:[JSON.parse(JSON.stringify(issue))]})});
 assert.equal(run.status,'unresolved');
 const env=verifiedEventEnvelope(run);
 assert.equal(saveVerifiedEvent(p,captureEventGeneration(p),env),false);
 assert.equal(p.event,undefined);
 await assert.rejects(witnessAI.video({...input,event:p.event,options}),/Confirm/);
 addAnswer(p,'We stayed for the encore and walked home together.');
 const retry=await witnessAI.event(projectInput(p),{provider:'mock'});
 assert.equal(retry.verification.status,'verified');
 assert.equal(saveVerifiedEvent(p,captureEventGeneration(p),retry),true);
 assert.ok(p.event);
});
test('every operation stays within two generations and two verifier calls',async()=>{
 const p=exampleProject(),input=projectInput(p);
 const good=(await mockEventGenerate(input,null)).result;
 const issue={field:'summary',statement:String(good.summary).split(/(?<=[.!?])\s/)[0],answerRefs:good.sourceRefs,reason:'contradiction'};
 for(const scenario of ['always-issues','garbage-verify','timeout','transport-error']){
  let genCalls=0,verCalls=0,now=0;
  const generate=async()=>{genCalls++;if(scenario==='transport-error'&&genCalls>1){const e=Error('boom');e.status=503;throw e;}return {provider:'mock',model:null,result:JSON.parse(JSON.stringify(good))};};
  const verify=async()=>{verCalls++;if(scenario==='garbage-verify')return {supported:'yes'};if(scenario==='timeout')now+=999999;return {supported:false,issues:[JSON.parse(JSON.stringify(issue))]};};
  try{await runVerifiedEvent(input,{verifier:'mock',generate,verify,now:()=>now});}catch{}
  assert.ok(genCalls<=2,`${scenario}: ${genCalls} generations`);
  assert.ok(verCalls<=2,`${scenario}: ${verCalls} verifier calls`);
 }
});
test('live event route verifies the draft and returns the envelope',async()=>{
 const p=exampleProject(),input=projectInput(p);
 const candidate=(await mockEventGenerate(input,null)).result;
 const calls=[];
 const fetcher=async(url,init)=>{
  const body=JSON.parse(init.body);
  calls.push(body.response_format.json_schema.name);
  const payload=body.response_format.json_schema.name==='witness_verify'?{supported:true,issues:[]}:candidate;
  assert.equal(init.headers.Authorization,'Bearer '+liveEnv.MODEL_API_KEY);
  return Response.json({choices:[{message:{content:JSON.stringify(payload)},finish_reason:'stop'}]});
 };
 const response=await handleAI(new Request('http://localhost/api/ai/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),liveEnv,fetcher);
 assert.equal(response.status,200);
 const data=await response.json();
 assert.deepEqual(calls,['witness_event','witness_verify']);
 assert.equal(data.verification.status,'verified');
 assert.equal(data.verification.verifier,'meta');
 assert.equal(data.provider,'meta');assert.equal(data.model,'muse-spark-1.3');
 assert.ok(data.result);
});
test('event routes reject caller-supplied repair data',async()=>{
 const input={...projectInput(exampleProject()),repair:{candidate:{},issues:[]}};
 const response=await handleAI(new Request('http://localhost/api/ai/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}));
 assert.equal(response.status,400);assert.match((await response.json()).error,/repair/);
});
test('live event provider errors fail once without regeneration',async()=>{
 const input=projectInput(exampleProject());
 let calls=0;
 const response=await handleAI(new Request('http://localhost/api/ai/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),liveEnv,async()=>{calls++;return Response.json({message:'busy'},{status:429});});
 assert.equal(response.status,429);assert.equal(calls,1);
});

test('late final verdict is refused and each call is capped at 60 seconds',async()=>{
 const input=projectInput(exampleProject()),good=(await mockEventGenerate(input,null)).result;let clock=0;const limits=[];
 await assert.rejects(runVerifiedEvent(input,{deadlineMs:120000,now:()=>clock,
  generate:async(inp,rep,opts)=>{limits.push(opts.timeoutMs);clock=100000;return {provider:'mock',model:null,result:good};},
  verify:async(cand,ans,opts)=>{limits.push(opts.timeoutMs);clock=120001;return {supported:true,issues:[]};}}),e=>e.status===504);
 assert.deepEqual(limits,[60000,20000]);
});
test('a hanging verifier is interrupted by the shared operation deadline',async()=>{
 const input=projectInput(exampleProject()),good=(await mockEventGenerate(input,null)).result;let signal,verCalls=0;
 await assert.rejects(runVerifiedEvent(input,{deadlineMs:30,
  generate:async()=>({provider:'mock',model:null,result:good}),
  verify:async(cand,ans,opts)=>{verCalls++;signal=opts.signal;return new Promise(()=>{});}}),e=>e.status===504);
 assert.equal(verCalls,1);assert.equal(signal.aborted,true);
});
test('approximate dates are repaired in the date and claim, not hidden by a disclaimer',async()=>{
 const p=newProject('turning-point','Moving');addAnswer(p,'I think I moved around 2018, but I am not sure.');
 const input=projectInput(p),base=(await mockEventGenerate(input,null)).result;
 const bad={...base,dateText:'2018',summary:'I moved in 2018. I am not sure about every detail.'};
 const verdict=mockVerifyEvent(bad,p.answers);assert.equal(verdict.supported,false);
 assert.ok(verdict.issues.some(i=>i.field==='dateText'));assert.ok(verdict.issues.some(i=>i.field==='summary'));
 const run=await runVerifiedEvent(input,{generate:(inp,repair)=>repair?mockEventGenerate(inp,repair):Promise.resolve({provider:'mock',model:null,result:bad}),verify:async(cand,ans)=>mockVerifyEvent(cand,ans)});
 assert.equal(run.status,'verified');assert.equal(run.attempts,2);assert.equal(run.event.dateText,'around 2018');assert.equal(run.event.summary,p.answers[0].text);
});
function deferred(){let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};}
async function waitFor(cond){for(let i=0;i<1000&&!cond();i++)await new Promise(r=>setTimeout(r,0));assert.equal(cond(),true);}
function abortableRequest(url,input){
 const controller=new AbortController();
 const req=new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:controller.signal});
 return {req,controller};
}
async function liveInterviewOk(input){
 const res=await handleAI(new Request('http://localhost/api/ai/interview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),liveEnv,metaOk({question:'What stayed with you?',intent:'meaning',sourceRefs:[],enoughMaterial:true,suggestedNextStep:'review_event'}));
 assert.equal(res.status,200);
}
function archivistInput(){
 const p=newProject('small-moment');
 addAnswer(p,'We went to a concert in Manchester. The band played until late.');
 addAnswer(p,'We moved to a new city that autumn with two suitcases.');
 return projectInput(p);
}
function twoGroups(input){
 return [{label:'Music',answerRefs:[{answerId:input.answers[0].id,revision:input.answers[0].revision}]},{label:'Moving',answerRefs:[{answerId:input.answers[1].id,revision:input.answers[1].revision}]}];
}
function draftEnvelope(label,attempts=1){
 return {provider:'mock',model:null,result:{title:label},rejected:null,verification:{status:'verified',issues:[],attempts,verifier:'mock'}};
}
test('archivist extraction stops before the next group when cancelled, keeping an honest partial',async()=>{
 const input=archivistInput(),groups=twoGroups(input);
 const grouping=deferred(),first=deferred();let drafts=0,cancelled=false;
 const run=runArchivist(input,{shouldStop:()=>cancelled?'cancelled':null,
  listGroups:()=>grouping.promise,
  draftEvent:async()=>{drafts++;return first.promise;}});
 grouping.resolve(groups);
 for(let i=0;i<1000&&drafts===0;i++)await new Promise(r=>setTimeout(r,0));
 assert.equal(drafts,1);
 first.resolve(draftEnvelope('Music'));
 cancelled=true;
 const result=await run;
 assert.equal(result.drafts.length,1);
 assert.equal(result.completedGroups,1);assert.equal(result.totalGroups,2);
 assert.equal(result.stopped,'cancelled');
 assert.equal(result.partial,true);
});
test('archivist extraction stops when answers change mid-run',async()=>{
 const input=archivistInput(),groups=twoGroups(input);
 let stale=false;const calls=[];
 const result=await runArchivist(input,{shouldStop:()=>stale?'stale':null,
  listGroups:async()=>groups,
  draftEvent:async(subset,group)=>{calls.push(group.label);if(calls.length===1)stale=true;return draftEnvelope(group.label);}});
 assert.deepEqual(calls,['Music']);
 assert.equal(result.stopped,'stale');
 assert.equal(result.partial,true);
});
test('archivist extraction shares one call budget across grouping, drafts, and repairs',async()=>{
 assert.equal(ARCHIVIST_MAX_GROUPS,4);
 assert.equal(ARCHIVIST_MAX_CALLS,17);
 const input=archivistInput(),groups=twoGroups(input);
 let drafts=0;
 const result=await runArchivist(input,{maxCalls:3,
  listGroups:async()=>groups,
  draftEvent:async()=>{drafts++;return draftEnvelope('Music',1);}});
 assert.equal(drafts,1);
 assert.equal(result.stopped,'budget');
 assert.equal(result.partial,true);
 assert.ok(result.calls<=3);
});
test('archivist extraction shares one deadline across all groups',async()=>{
 const input=archivistInput(),groups=twoGroups(input);
 let now=0;const calls=[];
 const result=await runArchivist(input,{now:()=>now,deadlineMs:100,
  listGroups:async()=>groups,
  draftEvent:async(subset,group)=>{calls.push(group.label);now+=200;return draftEnvelope(group.label);}});
 assert.deepEqual(calls,['Music']);
 assert.equal(result.stopped,'timeout');
 assert.equal(result.partial,true);
});
test('archivist extraction completes all groups within budget and reports no partial',async()=>{
 const input=archivistInput(),groups=twoGroups(input);
 const seen=[];
 const result=await runArchivist(input,{
  listGroups:async()=>groups,
  draftEvent:async(subset,group)=>{seen.push([group.label,subset.answers.length]);return draftEnvelope(group.label);}});
 assert.deepEqual(seen,[['Music',1],['Moving',1]]);
 assert.equal(result.stopped,null);
 assert.equal(result.partial,false);
 assert.equal(result.completedGroups,2);assert.equal(result.totalGroups,2);
 assert.ok(result.calls<=ARCHIVIST_MAX_CALLS);
});
test('archivist transports receive the remaining shared time and a live signal',async()=>{
 const input=archivistInput(),groups=twoGroups(input);
 let now=0;const seen={};
 const result=await runArchivist(input,{now:()=>now,deadlineMs:1000,
  listGroups:async (inp,opts)=>{seen.grouping=opts.timeoutMs;now=300;return groups;},
  draftEvent:async (subset,group,opts)=>{seen[group.label]=opts.timeoutMs;seen.signal=opts.signal;return draftEnvelope(group.label);}});
 assert.equal(result.stopped,null);
 assert.equal(seen.grouping,1000);
 assert.equal(seen.Music,700);
 assert.equal(seen.Moving,700);
 assert.equal(seen.signal.aborted,false);
});
test('a draft that finishes after the shared deadline is discarded, not completed',async()=>{
 const input=archivistInput(),groups=twoGroups(input);
 let now=0;const groupingGate=deferred(),gate=deferred();let drafts=0;
 const run=runArchivist(input,{now:()=>now,deadlineMs:100,
  listGroups:()=>groupingGate.promise,
  draftEvent:async()=>{drafts++;return gate.promise;}});
 groupingGate.resolve(groups);
 for(let i=0;i<1000&&drafts===0;i++)await new Promise(r=>setTimeout(r,0));
 assert.equal(drafts,1);
 now=200;
 gate.resolve(draftEnvelope('Music'));
 const result=await run;
 assert.equal(result.drafts.length,0);
 assert.equal(result.completedGroups,0);
 assert.equal(result.stopped,'timeout');
 assert.equal(result.partial,true);
});
test('cancellation while a draft is in flight aborts it and keeps nothing late',async()=>{
 const input=archivistInput(),groups=twoGroups(input);
 let cancelled=false;const gate=deferred();let signal=null;
 const run=runArchivist(input,{shouldStop:()=>cancelled?'cancelled':null,
  listGroups:async()=>groups,
  draftEvent:async (subset,group,opts)=>{signal=opts.signal;return gate.promise;}});
 setTimeout(()=>{cancelled=true;},10);
 const result=await run;
 assert.equal(result.stopped,'cancelled');
 assert.equal(result.drafts.length,0);
 assert.equal(result.partial,true);
 assert.equal(signal.aborted,true);
 gate.resolve(draftEnvelope('Music'));
});
test('a hanging transport is abandoned at the shared deadline',async()=>{
 const input=archivistInput(),groups=twoGroups(input);
 let signal=null;
 const result=await runArchivist(input,{deadlineMs:40,
  listGroups:async()=>groups,
  draftEvent:async (subset,group,opts)=>{signal=opts.signal;return new Promise(()=>{});}});
 assert.equal(result.stopped,'timeout');
 assert.equal(result.drafts.length,0);
 assert.equal(signal.aborted,true);
});
test('a verified run with an already-cancelled signal starts no model call',async()=>{
 const input=projectInput(exampleProject());
 const controller=new AbortController();controller.abort();
 let genCalls=0,verCalls=0;
 await assert.rejects(runVerifiedEvent(input,{signal:controller.signal,
  generate:async()=>{genCalls++;throw Error('must not run');},
  verify:async()=>{verCalls++;return {supported:true,issues:[]};}}),e=>e.status===499&&/cancelled/.test(e.message));
 assert.equal(genCalls,0);assert.equal(verCalls,0);
});
test('aborting an event request during generation starts no verification and verifies nothing',async()=>{
 const input=projectInput(exampleProject());
 const good=(await mockEventGenerate(input,null)).result;
 const genGate=deferred();const calls=[];
 const fetcher=async(url,init)=>{const name=JSON.parse(init.body).response_format.json_schema.name;calls.push(name);if(name==='witness_event')return genGate.promise;return Response.json({choices:[{message:{content:JSON.stringify({supported:true,issues:[]})},finish_reason:'stop'}]});};
 const {req,controller}=abortableRequest('http://localhost/api/ai/event',input);
 const resPromise=handleAI(req,liveEnv,fetcher);
 await waitFor(()=>calls.length===1);
 controller.abort();
 genGate.resolve(Response.json({choices:[{message:{content:JSON.stringify(good)},finish_reason:'stop'}]}));
 const res=await resPromise;
 assert.equal(res.status,499);
 assert.equal((await res.json()).result,undefined);
 await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(calls,['witness_event']);
 await liveInterviewOk(input);
});
test('aborting an event request during verification starts no repair and verifies nothing',async()=>{
 const input=projectInput(exampleProject());
 const good=(await mockEventGenerate(input,null)).result;
 const verGate=deferred();const calls=[];
 const fetcher=async(url,init)=>{const name=JSON.parse(init.body).response_format.json_schema.name;calls.push(name);if(name==='witness_verify')return verGate.promise;return Response.json({choices:[{message:{content:JSON.stringify(good)},finish_reason:'stop'}]});};
 const {req,controller}=abortableRequest('http://localhost/api/ai/event',input);
 const resPromise=handleAI(req,liveEnv,fetcher);
 await waitFor(()=>calls.length===2);
 controller.abort();
 const res=await resPromise;
 assert.equal(res.status,499);
 assert.equal((await res.json()).result,undefined);
 verGate.resolve(Response.json({choices:[{message:{content:JSON.stringify({supported:true,issues:[]})},finish_reason:'stop'}]}));
 await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(calls,['witness_event','witness_verify']);
 await liveInterviewOk(input);
});
test('a late editor draft after cancellation is not verified and starts no check',async()=>{
 const p=exampleProject();
 const input={...projectInput(p),passage:p.answers[0].text};
 const good=(await mockEditorGenerate(input,null)).result;
 const genGate=deferred();const calls=[];
 const fetcher=async(url,init)=>{const name=JSON.parse(init.body).response_format.json_schema.name;calls.push(name);if(name==='witness_editor')return genGate.promise;return Response.json({choices:[{message:{content:JSON.stringify({supported:true,issues:[]})},finish_reason:'stop'}]});};
 const {req,controller}=abortableRequest('http://localhost/api/ai/editor',input);
 const resPromise=handleAI(req,liveEnv,fetcher);
 await waitFor(()=>calls.length===1);
 controller.abort();
 genGate.resolve(Response.json({choices:[{message:{content:JSON.stringify(good)},finish_reason:'stop'}]}));
 const res=await resPromise;
 assert.equal(res.status,499);
 assert.equal((await res.json()).result,undefined);
 await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(calls,['witness_editor']);
 await liveInterviewOk(projectInput(p));
});
test('live browser transports propagate mid-flight cancellation to the network call',async()=>{
 const realFetch=globalThis.fetch;
 try{
  const p=exampleProject(),input=projectInput(p);
  const good=(await mockEventGenerate(input,null)).result;
  const seen={};let release;
  globalThis.fetch=(url,init)=>{seen[url]=init.signal;return new Promise(res=>{release=res;});};
  const controller=new AbortController();
  const pending=witnessAI.archivist(input,{provider:'live',timeoutMs:5000,signal:controller.signal});
  await waitFor(()=>!!seen['/api/ai/archivist']);
  controller.abort();
  assert.equal(seen['/api/ai/archivist'].aborted,true);
  release(Response.json({provider:'meta',model:'muse-spark-1.3',result:{groups:[{label:'Evening',answerRefs:input.answers.map(a=>({answerId:a.id,revision:a.revision}))}]}}));
  await assert.rejects(pending,/cancelled/);
  const controller2=new AbortController();
  const pending2=witnessAI.event(input,{provider:'live',timeoutMs:5000,signal:controller2.signal});
  await waitFor(()=>!!seen['/api/ai/event']);
  controller2.abort();
  assert.equal(seen['/api/ai/event'].aborted,true);
  release(Response.json({provider:'meta',model:'muse-spark-1.3',result:good,rejected:null,verification:{status:'verified',issues:[],attempts:1,verifier:'meta'}}));
  await assert.rejects(pending2,/cancelled/);
 }finally{globalThis.fetch=realFetch;clearAIStatusCache();}
});
test('a late live response after cancellation is never accepted',async()=>{
 const realFetch=globalThis.fetch;
 try{
  const p=exampleProject();
  const input={...projectInput(p),weekStart:'2026-11-02',timeZone:'UTC'};
  const good=(await mockPeriodGenerate(input,null)).result;
  let release;
  const gate=new Promise(res=>{release=res;});
  globalThis.fetch=async()=>gate;
  const controller=new AbortController();
  const pending=witnessAI.period(input,{provider:'live',timeoutMs:60000,signal:controller.signal});
  controller.abort();
  release(Response.json({provider:'meta',model:'muse-spark-1.3',result:good,rejected:null,verification:{status:'verified',issues:[],attempts:1,verifier:'meta'}}));
  await assert.rejects(pending,/cancelled/);
  const interviewGate=new Promise(res=>{release=res;});
  globalThis.fetch=async()=>interviewGate;
  const controller2=new AbortController();
  const pending2=witnessAI.interview(projectInput(p),{provider:'live',timeoutMs:60000,signal:controller2.signal});
  controller2.abort();
  release(Response.json({provider:'meta',model:'muse-spark-1.3',result:{question:'Late question?',intent:'meaning',sourceRefs:[],enoughMaterial:false,suggestedNextStep:'continue'}}));
  await assert.rejects(pending2,/cancelled/);
 }finally{globalThis.fetch=realFetch;clearAIStatusCache();}
});
test('unmapped upstream failures keep a short message and log task, stage, and status only',async()=>{
 const p=exampleProject(),input=projectInput(p);
 const lines=[],realError=console.error;
 console.error=(...a)=>{lines.push(a.join(' '));};
 try{
  for(const status of [400,404,500,503]){
   try{await runMetaTask('event',input,{apiKey:'k',fetcher:async()=>Response.json({message:'x'},{status})});assert.fail('expected throw '+status);}
   catch(err){assert.equal(err.message,'Meta could not complete this step. Your answers are still saved.');assert.equal(err.status,status>=500?502:status);}
  }
  assert.equal(lines.length,4);
  assert.ok(lines.every(l=>/^.*meta event\.request upstream=(400|404|500|503)$/.test(l)),lines.join('\n'));
  const answerWords=input.answers.flatMap(a=>a.text.split(/\s+/).filter(w=>w.length>4));
  for(const w of answerWords)assert.ok(lines.every(l=>!l.includes(w)),'log leaks answer text: '+w);
  assert.ok(lines.every(l=>!l.includes('test-key')&&!l.includes('Bearer')),'log leaks credentials');
 }finally{console.error=realError;}
});
test('verification-stage upstream failures name the check, not the draft',async()=>{
 const p=exampleProject(),input=projectInput(p);
 const refs=input.answers.map(a=>({answerId:a.id,revision:a.revision}));
 const candidate={title:'A memory',summary:input.answers[0].text,dateText:null,location:null,people:[],themes:[],detailsToConfirm:[],sourceRefs:refs};
 const realError=console.error;let line='';
 console.error=(...a)=>{line=a.join(' ');};
 try{
  await assert.rejects(runMetaTask('verify',{title:input.title,answers:input.answers,candidate},{apiKey:'k',fetcher:async()=>Response.json({message:'x'},{status:503})}),/could not check the draft/);
  assert.match(line,/meta verify\.verify upstream=503/);
 }finally{console.error=realError;}
});
