import {isImageLiveEnabled,runMetaImage,IMAGE_MODEL} from './images.mjs';
import {runMockTask,mockEventGenerate,mockEventVerify,mockEditorGenerate,mockEditorVerify,mockPeriodGenerate,mockPeriodVerify} from '../../web/mock-ai.js';
import {isTextLiveEnabled,runMetaTask,DISCOVERY_TIMEOUT_MS} from './meta.mjs';
import {validateAIResult,validateDiscoveryInput,validateDiscoveryResult,validateStoryboard} from '../../web/ai-contracts.js';
import {runVerifiedEvent,verifiedEventEnvelope} from '../../web/event-verify.js';
import {isHosted} from '../config.mjs';
import {requireUser} from '../auth.mjs';
import {spendGeneration,acquireSlot} from './budget.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const UNAVAILABLE={
 interview:'Meta interviews are not available on this server right now. Your work is saved.',
 event:'Meta event drafts are not available on this server right now. Your work is saved.',
 archivist:'Meta event grouping is not available on this server right now. Your work is saved.',
 editor:'Meta wording help is not available on this server right now. Your work is saved.',
 period:'Meta period drafts are not available on this server right now. Your work is saved.',
 video:'Meta storyboards are not available on this server right now. Your work is saved.',
 discovery:'Semantic search is not available on this server right now.',
 image:'Meta image generation is not enabled on this server.',
};
export async function handleAI(request,env={},fetcher=globalThis.fetch,deps={}){
 const url=new URL(request.url);
 const live=isTextLiveEnabled(env,fetcher),hosted=isHosted(env);
 if(url.pathname==='/api/ai-status')return request.method==='GET'?json({provider:live?'meta':'mock',mode:hosted?'hosted':'local',authRequired:hosted,metaRequestsEnabled:live,textLiveAvailable:live,liveTasks:live?['interview','event','archivist','editor','period','discovery','video']:[],model:'muse-spark-1.3',imageLiveAvailable:isImageLiveEnabled(env),imageModel:IMAGE_MODEL,tasks:['interview','event','video','image','archivist','editor','period','discovery']}):json({error:'Method not allowed.'},405);
 const task={'/api/ai/interview':'interview','/api/ai/event':'event','/api/ai/video':'video','/api/ai/image':'image','/api/ai/archivist':'archivist','/api/ai/editor':'editor','/api/ai/period':'period','/api/ai/discovery':'discovery'}[url.pathname];if(!task)return null;
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'Open Witness before using this endpoint.'},403);
 let userId=null;
 if(hosted){
  try{({userId}=await requireUser(request,env,deps));}
  catch(err){return json({error:err.message},err.status||401);}
 }
 if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')return json({error:'Send the interview as JSON.'},415);
 // Hosted mode never serves mocks: without live Meta this is a short error.
 const mockOrUnavailable=async fn=>hosted?json({error:UNAVAILABLE[task]},503):json(await fn());
 try{
  const reader=request.body?.getReader();if(!reader)return json({error:'The interview is empty.'},400);const chunks=[];let total=0;for(;;){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>(task==='image'?12000000:150000)){await reader.cancel();return json({error:task==='image'?'That image request is too large for this preview. Use a smaller reference image.':'The interview is too long for this preview.'},413);}chunks.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const input=JSON.parse(new TextDecoder().decode(bytes));
  if(task==='image'){
   if(!isImageLiveEnabled(env))return json({error:UNAVAILABLE.image},503);
   let release;
   try{release=acquireSlot(env);}
   catch(err){return json({error:err.message},err.status||429);}
   try{spendGeneration(userId,env);return json(await runMetaImage(input,{apiKey:env.MODEL_API_KEY,fetcher,signal:request.signal}));}finally{release();}
  }
  if(task==='discovery'){
   // One bounded Muse call over public excerpts only: at most 40
   // candidates, 65 seconds, strict fail-closed ranking validation.
   // Nothing is sent unless the narrator clicked the explicit search.
   // Allowlist: only the search text plus public candidate excerpts reach
   // the model. Any extra or private input field is dropped here, never sent.
   const allowed={query:String(input?.query ?? ''),candidates:(Array.isArray(input?.candidates)?input.candidates:[]).map(c=>({id:String(c?.id ?? ''),revision:c?.revision,text:String(c?.text ?? '')}))};
   try{validateDiscoveryInput(allowed);}catch(err){return json({error:err.message},400);}
   if(!isTextLiveEnabled(env,fetcher))return json({error:UNAVAILABLE.discovery},503);
   let release;
   try{release=acquireSlot(env);}
   catch(err){return json({error:err.message},err.status||429);}
   try{
    spendGeneration(userId,env);
    const run=await runMetaTask('discovery',allowed,{apiKey:env.MODEL_API_KEY,fetcher,timeoutMs:DISCOVERY_TIMEOUT_MS,signal:request.signal,validateResult:false});
    try{
     const ranked=validateDiscoveryResult(run.result,allowed);
     return json({provider:run.provider,model:run.model,results:ranked.results});
    }catch(err){err.status=err.status||502;throw err;}
   }finally{release();}
  }
  if(task==='event'||task==='editor'||task==='period'){
   if(input&&typeof input==='object'&&'repair' in input)return json({error:'The server manages repair attempts. Send the interview without repair data.'},400);
   const validate=(r,a)=>validateAIResult(task,r,a);
   if(isTextLiveEnabled(env,fetcher)){
    let release;
    try{release=acquireSlot(env);}
    catch(err){return json({error:err.message},err.status||429);}
    try{
     // Verification and repair calls spend from the budget like any call.
     const spend=()=>spendGeneration(userId,env);
     const run=await runVerifiedEvent(input,{verifier:'meta',validate,signal:request.signal,
      generate:(inp,rep,opts)=>{spend();return runMetaTask(task,rep?{...inp,repair:rep}:inp,{apiKey:env.MODEL_API_KEY,fetcher,timeoutMs:opts.timeoutMs,signal:opts.signal,validateResult:false});},
      verify:async(cand,ans,opts)=>{spend();return (await runMetaTask('verify',{title:input.title,answers:ans,candidate:cand},{apiKey:env.MODEL_API_KEY,fetcher,timeoutMs:opts.timeoutMs,signal:opts.signal})).result;}});
     return json(verifiedEventEnvelope(run));
    }finally{release();}
   }
   return mockOrUnavailable(async()=>{
    const mock=task==='editor'?{generate:mockEditorGenerate,verify:mockEditorVerify}:task==='period'?{generate:mockPeriodGenerate,verify:mockPeriodVerify}:{generate:mockEventGenerate,verify:mockEventVerify};
    return verifiedEventEnvelope(await runVerifiedEvent(input,{verifier:'mock',validate,...mock}));
   });
  }
  if(isTextLiveEnabled(env,fetcher)){
   let release;
   try{release=acquireSlot(env);}
   catch(err){return json({error:err.message},err.status||429);}
   try{
    spendGeneration(userId,env);
    if(task==='video'){const run=await runMetaTask(task,input,{apiKey:env.MODEL_API_KEY,fetcher,signal:request.signal,validateResult:false});return json({provider:run.provider,model:run.model,result:validateStoryboard(run.result,input.answers)});}
    return json(await runMetaTask(task,input,{apiKey:env.MODEL_API_KEY,fetcher,signal:request.signal}));
   }
   finally{release();}
  }
  return mockOrUnavailable(()=>runMockTask(task,input));
 }catch(err){
  if(err instanceof SyntaxError)return json({error:'The interview could not be read.'},400);
  return json({error:err.message},err.status||400);
 }
}
