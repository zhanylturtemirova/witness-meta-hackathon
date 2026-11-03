import {runMockTask,mockEventGenerate,mockEventVerify,mockEditorGenerate,mockEditorVerify,mockPeriodGenerate,mockPeriodVerify} from './mock-ai.js';
import {validateAIResult,validateVerifyOutput,validateStoryboard} from './ai-contracts.js';
import {runVerifiedEvent,verifiedEventEnvelope} from './event-verify.js';
// Capability detection decides the automatic provider. A missing or mock status uses
// local mocks automatically. A failed live generation never falls back silently:
// the UI must offer an explicit Retry (live) or Continue with mock choice.
// Event results arrive as verified envelopes; unresolved drafts are never promoted.
let statusCache=null,statusAt=0;
const STATUS_TTL=30000;
const EVENT_LIVE_TIMEOUT_MS=130000;
export function clearAIStatusCache(){statusCache=null;statusAt=0;}
export async function aiStatus(force=false){
 const now=Date.now();
 if(!force&&statusCache&&now-statusAt<STATUS_TTL)return statusCache;
 try{
  const res=await globalThis.fetch('/api/ai-status',{cache:'no-store',signal:AbortSignal.timeout(5000)});
  if(!res.ok)throw Error();
  const data=await res.json();
  const hasTasks=Array.isArray(data.liveTasks);
  const liveTasks=hasTasks?data.liveTasks.filter(t=>t==='interview'||t==='event'||t==='archivist'||t==='editor'||t==='period'||t==='discovery'||t==='video'):[];
  const flagged=data.textLiveAvailable===true||data.metaRequestsEnabled===true;
  const liveAvailable=flagged&&(hasTasks?liveTasks.length>0:true);
  statusCache={provider:liveAvailable?'meta':'mock',textLiveAvailable:liveAvailable,liveTasks:hasTasks?liveTasks:(liveAvailable?['interview','event']:[]),model:'muse-spark-1.3'};
 }catch{
  statusCache={provider:'mock',textLiveAvailable:false,liveTasks:[],model:'muse-spark-1.3',static:true};
 }
 statusAt=now;return statusCache;
}
// Combines a caller cancellation signal with a per-request time budget into
// one fetch signal, so shared operation deadlines reach the network call.
function requestSignal(timeoutMs,signal){
 const controller=new AbortController();
 if(signal?.aborted){controller.abort(signal.reason);return {signal:controller.signal,cleanup(){}};}
 const timer=setTimeout(()=>controller.abort(new DOMException('The AI request took too long.','TimeoutError')),timeoutMs);
 const onAbort=()=>{clearTimeout(timer);controller.abort(signal.reason);};
 signal?.addEventListener('abort',onAbort,{once:true});
 return {signal:controller.signal,cleanup(){clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}};
}
async function liveTask(task,input,{timeoutMs=65000,signal}={}){
 let res;
 const req=requestSignal(timeoutMs,signal);
 try{
  res=await globalThis.fetch('/api/ai/'+task,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:req.signal});
 }catch(err){
  req.cleanup();
  if(err?.name==='TimeoutError')throw Error('The AI request took too long. Your answers are still saved.');
  throw Error('The AI server could not be reached. Your answers are still saved.');
 }
 req.cleanup();
 if(signal?.aborted)throw Error('The request was cancelled. Your answers are still saved; you can retry.');
 let data;
 try{data=await res.json();}catch{throw Error('The AI server did not respond correctly. Your answers are still saved.');}
 if(!res.ok)throw Error(typeof data?.error==='string'&&data.error||'The AI request failed. Your answers are still saved.');
 return {provider:data.provider||'meta',model:data.model||'muse-spark-1.3',result:validateAIResult(task,data.result,input.answers)};
}
function checkLoopEnvelope(task,data,input){
 const bad=Error('The AI server did not respond correctly. Your answers are still saved.');
 const v=data?.verification;
 if(!data||typeof data!=='object'||!v||(v.status!=='verified'&&v.status!=='unresolved')||(v.attempts!==1&&v.attempts!==2))throw bad;
 const verifier=typeof v.verifier==='string'&&v.verifier?v.verifier:'meta';
 if(v.status==='verified'){
  if(!data.result)throw bad;
  return {provider:data.provider||'meta',model:data.model||'muse-spark-1.3',result:validateAIResult(task,data.result,input.answers),rejected:null,verification:{status:'verified',issues:[],attempts:v.attempts,verifier}};
 }
 let rejected=null;
 if(data.rejected){
  const candidate=validateAIResult(task,data.rejected.candidate,input.answers);
  const checked=validateVerifyOutput({supported:false,issues:data.rejected.issues},candidate,input.answers);
  rejected={candidate,issues:checked.issues};
 }
 return {provider:data.provider||'meta',model:data.model||'muse-spark-1.3',result:null,rejected,verification:{status:'unresolved',issues:rejected?rejected.issues:[],attempts:v.attempts,verifier}};
}
async function liveLoop(task,input,{timeoutMs=EVENT_LIVE_TIMEOUT_MS,signal}={}){
 let res;
 const req=requestSignal(timeoutMs,signal);
 try{
  res=await globalThis.fetch('/api/ai/'+task,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:req.signal});
 }catch(err){
  req.cleanup();
  if(err?.name==='TimeoutError')throw Error('The AI request took too long. Your answers are still saved.');
  throw Error('The AI server could not be reached. Your answers are still saved.');
 }
 req.cleanup();
 if(signal?.aborted)throw Error('The request was cancelled. Your answers are still saved; you can retry.');
 let data;
 try{data=await res.json();}catch{throw Error('The AI server did not respond correctly. Your answers are still saved.');}
 if(!res.ok)throw Error(typeof data?.error==='string'&&data.error||'The AI request failed. Your answers are still saved.');
 return checkLoopEnvelope(task,data,input);
}
async function mockEvent(input){
 return verifiedEventEnvelope(await runVerifiedEvent(input,{verifier:'mock',generate:mockEventGenerate,verify:mockEventVerify}));
}
async function mockEditor(input){
 return verifiedEventEnvelope(await runVerifiedEvent(input,{verifier:'mock',generate:mockEditorGenerate,verify:mockEditorVerify,validate:(r,a)=>validateAIResult('editor',r,a)}));
}
async function mockPeriod(input){
 return verifiedEventEnvelope(await runVerifiedEvent(input,{verifier:'mock',generate:mockPeriodGenerate,verify:mockPeriodVerify,validate:(r,a)=>validateAIResult('period',r,a)}));
}
async function singleTask(task,input,{provider,timeoutMs,signal}){
 if(provider==='mock')return runMockTask(task,input);
 if(provider==='live')return liveTask(task,input,{timeoutMs,signal});
 const status=await aiStatus();
 if(status.textLiveAvailable&&status.liveTasks.includes(task))return liveTask(task,input,{timeoutMs,signal});
 return runMockTask(task,input);
}
async function loopTask(task,input,{provider,timeoutMs,signal},mock){
 if(provider==='mock')return mock(input);
 if(provider==='live')return liveLoop(task,input,{timeoutMs,signal});
 const status=await aiStatus();
 if(status.textLiveAvailable&&status.liveTasks.includes(task))return liveLoop(task,input,{timeoutMs,signal});
 return mock(input);
}
export const witnessAI={
 async interview(input,{provider='auto',timeoutMs,signal}={}){
  return singleTask('interview',input,{provider,timeoutMs,signal});
 },
 async event(input,{provider='auto',timeoutMs,signal}={}){
  return loopTask('event',input,{provider,timeoutMs,signal},mockEvent);
 },
 async archivist(input,{provider='auto',timeoutMs,signal}={}){
  return singleTask('archivist',input,{provider,timeoutMs,signal});
 },
 async editor(input,{provider='auto',timeoutMs,signal}={}){
  return loopTask('editor',input,{provider,timeoutMs,signal},mockEditor);
 },
 async period(input,{provider='auto',timeoutMs,signal}={}){
  return loopTask('period',input,{provider,timeoutMs,signal},mockPeriod);
 },
 async video(input,{provider='auto',timeoutMs,signal}={}){
  const out=await singleTask('video',input,{provider,timeoutMs,signal});
  return {...out,result:validateStoryboard(out.result,input.answers)};
 },
};
export function projectInput(project){return {title:project.title,topicId:project.topicId,questionIndex:project.questionIndex,answers:project.answers.map(({id,revision,text,question,createdAt})=>({id,revision,text,question,recordedAt:Number.isFinite(createdAt)?new Date(createdAt).toISOString().slice(0,10):null})),askedIntents:[...project.answers.map(a=>a.intent),...(project.skippedIntents||[])].filter(Boolean)};}
