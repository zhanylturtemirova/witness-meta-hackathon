import {isImageLiveEnabled,runMetaImage,IMAGE_MODEL} from './images.mjs';
import {runMockTask,mockEventGenerate,mockEventVerify,mockEditorGenerate,mockEditorVerify,mockPeriodGenerate,mockPeriodVerify} from '../../web/mock-ai.js';
import {isTextLiveEnabled,runMetaTask,DISCOVERY_TIMEOUT_MS} from './meta.mjs';
import {validateAIResult,validateDiscoveryInput,validateDiscoveryResult,validateStoryboard} from '../../web/ai-contracts.js';
import {runVerifiedEvent,verifiedEventEnvelope} from '../../web/event-verify.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
let inFlight=false;
export async function handleAI(request,env={},fetcher=globalThis.fetch){
 const url=new URL(request.url);
 const live=isTextLiveEnabled(env,fetcher);
 if(url.pathname==='/api/ai-status')return request.method==='GET'?json({provider:live?'meta':'mock',metaRequestsEnabled:live,textLiveAvailable:live,liveTasks:live?['interview','event','archivist','editor','period','discovery','video']:[],model:'muse-spark-1.3',imageLiveAvailable:isImageLiveEnabled(env),imageModel:IMAGE_MODEL,tasks:['interview','event','video','image','archivist','editor','period','discovery']}):json({error:'Method not allowed.'},405);
 const task={'/api/ai/interview':'interview','/api/ai/event':'event','/api/ai/video':'video','/api/ai/image':'image','/api/ai/archivist':'archivist','/api/ai/editor':'editor','/api/ai/period':'period','/api/ai/discovery':'discovery'}[url.pathname];if(!task)return null;
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'Open Witness before using this endpoint.'},403);
 if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')return json({error:'Send the interview as JSON.'},415);
 try{
  const reader=request.body?.getReader();if(!reader)return json({error:'The interview is empty.'},400);const chunks=[];let total=0;for(;;){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>(task==='image'?12000000:150000)){await reader.cancel();return json({error:task==='image'?'That image request is too large for this preview. Use a smaller reference image.':'The interview is too long for this preview.'},413);}chunks.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const input=JSON.parse(new TextDecoder().decode(bytes));
  if(task==='image'){
   if(!isImageLiveEnabled(env))return json({error:'Meta image generation is not enabled on this server.'},503);
   if(inFlight)return json({error:'Another AI request is running. Wait before generating an image.'},429);
   inFlight=true;try{return json(await runMetaImage(input,{apiKey:env.MODEL_API_KEY,fetcher,signal:request.signal}));}finally{inFlight=false;}
  }
  if(task==='discovery'){
   // One bounded Muse call over public excerpts only: at most 40
   // candidates, 65 seconds, strict fail-closed ranking validation.
   // Nothing is sent unless the narrator clicked the explicit search.
   // Allowlist: only the search text plus public candidate excerpts reach
   // the model. Any extra or private input field is dropped here, never sent.
   const allowed={query:String(input?.query ?? ''),candidates:(Array.isArray(input?.candidates)?input.candidates:[]).map(c=>({id:String(c?.id ?? ''),revision:c?.revision,text:String(c?.text ?? '')}))};
   try{validateDiscoveryInput(allowed);}catch(err){return json({error:err.message},400);}
   if(!isTextLiveEnabled(env,fetcher))return json({error:'Muse discovery is not enabled on this server. Use the local topic preview instead.'},503);
   if(inFlight)return json({error:'Another AI request is running. Wait a moment before retrying. Your answers are still saved.'},429);
   inFlight=true;
   try{
    const run=await runMetaTask('discovery',allowed,{apiKey:env.MODEL_API_KEY,fetcher,timeoutMs:DISCOVERY_TIMEOUT_MS,signal:request.signal,validateResult:false});
    try{
     const ranked=validateDiscoveryResult(run.result,allowed);
     return json({provider:run.provider,model:run.model,results:ranked.results});
    }catch(err){err.status=err.status||502;throw err;}
   }finally{inFlight=false;}
  }
  if(task==='event'||task==='editor'||task==='period'){
   if(input&&typeof input==='object'&&'repair' in input)return json({error:'The server manages repair attempts. Send the interview without repair data.'},400);
   const validate=(r,a)=>validateAIResult(task,r,a);
   if(isTextLiveEnabled(env,fetcher)){
    if(inFlight)return json({error:'Another AI request is running. Wait a moment before retrying. Your answers are still saved.'},429);
    inFlight=true;
    try{
     const run=await runVerifiedEvent(input,{verifier:'meta',validate,signal:request.signal,
      generate:(inp,rep,opts)=>runMetaTask(task,rep?{...inp,repair:rep}:inp,{apiKey:env.MODEL_API_KEY,fetcher,timeoutMs:opts.timeoutMs,signal:opts.signal,validateResult:false}),
      verify:async(cand,ans,opts)=>(await runMetaTask('verify',{title:input.title,answers:ans,candidate:cand},{apiKey:env.MODEL_API_KEY,fetcher,timeoutMs:opts.timeoutMs,signal:opts.signal})).result});
     return json(verifiedEventEnvelope(run));
    }finally{inFlight=false;}
   }
   const mock=task==='editor'?{generate:mockEditorGenerate,verify:mockEditorVerify}:task==='period'?{generate:mockPeriodGenerate,verify:mockPeriodVerify}:{generate:mockEventGenerate,verify:mockEventVerify};
   return json(verifiedEventEnvelope(await runVerifiedEvent(input,{verifier:'mock',validate,...mock})));
  }
  if(isTextLiveEnabled(env,fetcher)){
   if(inFlight)return json({error:'Another AI request is running. Wait a moment before retrying. Your answers are still saved.'},429);
   inFlight=true;
   try{
    if(task==='video'){const run=await runMetaTask(task,input,{apiKey:env.MODEL_API_KEY,fetcher,signal:request.signal,validateResult:false});return json({provider:run.provider,model:run.model,result:validateStoryboard(run.result,input.answers)});}
    return json(await runMetaTask(task,input,{apiKey:env.MODEL_API_KEY,fetcher,signal:request.signal}));
   }
   finally{inFlight=false;}
  }
  return json(await runMockTask(task,input));
 }catch(err){
  if(err instanceof SyntaxError)return json({error:'The interview could not be read.'},400);
  return json({error:err.message},err.status||400);
 }
}
