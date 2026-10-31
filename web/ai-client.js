import {runMockTask,mockEventGenerate,mockEventVerify} from './mock-ai.js';
import {validateAIResult,validateVerifyOutput} from './ai-contracts.js';
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
  const liveTasks=hasTasks?data.liveTasks.filter(t=>t==='interview'||t==='event'):[];
  const flagged=data.textLiveAvailable===true||data.metaRequestsEnabled===true;
  const liveAvailable=flagged&&(hasTasks?liveTasks.length>0:true);
  statusCache={provider:liveAvailable?'meta':'mock',textLiveAvailable:liveAvailable,liveTasks:hasTasks?liveTasks:(liveAvailable?['interview','event']:[]),model:'muse-spark-1.3'};
 }catch{
  statusCache={provider:'mock',textLiveAvailable:false,liveTasks:[],model:'muse-spark-1.3',static:true};
 }
 statusAt=now;return statusCache;
}
async function liveTask(task,input){
 let res;
 try{
  res=await globalThis.fetch('/api/ai/'+task,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(65000)});
 }catch(err){
  if(err?.name==='TimeoutError')throw Error('The AI request took too long. Your answers are still saved.');
  throw Error('The AI server could not be reached. Your answers are still saved.');
 }
 let data;
 try{data=await res.json();}catch{throw Error('The AI server did not respond correctly. Your answers are still saved.');}
 if(!res.ok)throw Error(typeof data?.error==='string'&&data.error||'The AI request failed. Your answers are still saved.');
 return {provider:data.provider||'meta',model:data.model||'muse-spark-1.3',result:validateAIResult(task,data.result,input.answers)};
}
function checkEventEnvelope(data,input){
 const bad=Error('The AI server did not respond correctly. Your answers are still saved.');
 const v=data?.verification;
 if(!data||typeof data!=='object'||!v||(v.status!=='verified'&&v.status!=='unresolved')||(v.attempts!==1&&v.attempts!==2))throw bad;
 const verifier=typeof v.verifier==='string'&&v.verifier?v.verifier:'meta';
 if(v.status==='verified'){
  if(!data.result)throw bad;
  return {provider:data.provider||'meta',model:data.model||'muse-spark-1.3',result:validateAIResult('event',data.result,input.answers),rejected:null,verification:{status:'verified',issues:[],attempts:v.attempts,verifier}};
 }
 let rejected=null;
 if(data.rejected){
  const candidate=validateAIResult('event',data.rejected.candidate,input.answers);
  const checked=validateVerifyOutput({supported:false,issues:data.rejected.issues},candidate,input.answers);
  rejected={candidate,issues:checked.issues};
 }
 return {provider:data.provider||'meta',model:data.model||'muse-spark-1.3',result:null,rejected,verification:{status:'unresolved',issues:rejected?rejected.issues:[],attempts:v.attempts,verifier}};
}
async function liveEvent(input){
 let res;
 try{
  res=await globalThis.fetch('/api/ai/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(EVENT_LIVE_TIMEOUT_MS)});
 }catch(err){
  if(err?.name==='TimeoutError')throw Error('The AI request took too long. Your answers are still saved.');
  throw Error('The AI server could not be reached. Your answers are still saved.');
 }
 let data;
 try{data=await res.json();}catch{throw Error('The AI server did not respond correctly. Your answers are still saved.');}
 if(!res.ok)throw Error(typeof data?.error==='string'&&data.error||'The AI request failed. Your answers are still saved.');
 return checkEventEnvelope(data,input);
}
async function mockEvent(input){
 return verifiedEventEnvelope(await runVerifiedEvent(input,{verifier:'mock',generate:mockEventGenerate,verify:mockEventVerify}));
}
export const witnessAI={
 async interview(input,{provider='auto'}={}){
  if(provider==='mock')return runMockTask('interview',input);
  if(provider==='live')return liveTask('interview',input);
  const status=await aiStatus();
  if(status.textLiveAvailable&&status.liveTasks.includes('interview'))return liveTask('interview',input);
  return runMockTask('interview',input);
 },
 async event(input,{provider='auto'}={}){
  if(provider==='mock')return mockEvent(input);
  if(provider==='live')return liveEvent(input);
  const status=await aiStatus();
  if(status.textLiveAvailable&&status.liveTasks.includes('event'))return liveEvent(input);
  return mockEvent(input);
 },
 // Video storyboards stay mock-only in this preview, even when interview/event are live.
 async video(input){return runMockTask('video',input);},
};
export function projectInput(project){return {title:project.title,topicId:project.topicId,questionIndex:project.questionIndex,answers:project.answers.map(({id,revision,text,question})=>({id,revision,text,question})),askedIntents:[...project.answers.map(a=>a.intent),...(project.skippedIntents||[])].filter(Boolean)};}
