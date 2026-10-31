import test from 'node:test';
import assert from 'node:assert/strict';
import {exampleProject,newProject,addAnswer,reviseAnswer,setInterviewer,setReviewDraft} from '../web/domain.js';
import {witnessAI,projectInput,aiStatus,clearAIStatusCache} from '../web/ai-client.js';
import {saveEvent,confirmEvent,eventStale,saveVideo,videoStale,saveVerifiedEvent,eventVerification,captureEventGeneration,eventGenerationStale} from '../web/event-model.js';
import {runVerifiedEvent,verifiedEventEnvelope} from '../web/event-verify.js';
import {mockEventGenerate,mockVerifyEvent} from '../web/mock-ai.js';
import {validateVerifyOutput} from '../web/ai-contracts.js';
import {buildMetaRequest,runMetaTask,META_NETWORK_ENABLED,META_TEXT_NETWORK_ENABLED,META_SPEECH_NETWORK_ENABLED,isTextLiveEnabled} from '../server/ai/meta.mjs';
import {handleAI} from '../server/ai/routes.mjs';
import {handleSpeech} from '../server/transcribe.mjs';
const options={host:'thoughtful',setting:'garden',tone:'warm'};
const liveEnv={META_AI_ENABLED:'true',MODEL_API_KEY:'test-key-not-real'};
async function confirmed(){const p=exampleProject();saveEvent(p,(await witnessAI.event(projectInput(p),{provider:'mock'})).result);confirmEvent(p,{title:p.event.title,summary:p.event.summary});return p;}
function metaOk(result){return async()=>Response.json({choices:[{message:{content:JSON.stringify(result)},finish_reason:'stop'}]});}
test('live text needs server key and flag, stays mock by default, and keeps the structured contract',async()=>{
 assert.equal(META_NETWORK_ENABLED,false);assert.equal(META_TEXT_NETWORK_ENABLED,true);assert.equal(META_SPEECH_NETWORK_ENABLED,true);
 await assert.rejects(runMetaTask('interview',projectInput(exampleProject()),{}),/server API key is required/);
 await assert.rejects(runMetaTask('video',projectInput(exampleProject()),{apiKey:'x',fetcher:async()=>Response.json({})}),/local mocks/);
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
test('event drafts keep uncertainty and missing facts, and require explicit confirmation',async()=>{
 const p=exampleProject();saveEvent(p,(await witnessAI.event(projectInput(p),{provider:'mock'})).result);assert.equal(p.event.confirmed,false);assert.equal(p.event.dateText,'around 2018');assert.equal(p.event.location,'Manchester');assert.ok(p.event.detailsToConfirm.length);await assert.rejects(witnessAI.video({...projectInput(p),event:p.event,options}),/Confirm/);
 const empty=newProject('small-moment');addAnswer(empty,'A quiet afternoon with my sister.');const e=(await witnessAI.event(projectInput(empty),{provider:'mock'})).result;assert.equal(e.dateText,null);assert.equal(e.location,null);
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
test('local AI routes stay mock when disabled, and video stays mock when live',async()=>{
 const input=projectInput(exampleProject()),url='http://localhost/api/ai/event';let response=await handleAI(new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}));assert.equal(response.status,200);assert.equal((await response.json()).provider,'mock');
 response=await handleAI(new Request(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:JSON.stringify(input)}));assert.equal(response.status,403);
 response=await handleAI(new Request('http://localhost/api/ai-status'),{});assert.equal((await response.json()).textLiveAvailable,false);
 response=await handleAI(new Request('http://localhost/api/ai-status'),liveEnv,async()=>Response.json({}));const status=await response.json();assert.equal(status.textLiveAvailable,true);assert.deepEqual(status.liveTasks,['interview','event']);
 const p=await confirmed();response=await handleAI(new Request('http://localhost/api/ai/video',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...projectInput(p),event:p.event,options})}),liveEnv,async()=>{throw Error('video must not call Meta');});assert.equal(response.status,200);assert.equal((await response.json()).provider,'mock');
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
