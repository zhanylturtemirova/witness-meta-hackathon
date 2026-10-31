import {isImageLiveEnabled,runMetaImage,IMAGE_MODEL} from './images.mjs';
import {runMockTask,mockEventGenerate,mockEventVerify} from '../../web/mock-ai.js';
import {isTextLiveEnabled,runMetaTask} from './meta.mjs';
import {runVerifiedEvent,verifiedEventEnvelope} from '../../web/event-verify.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
let inFlight=false;
export async function handleAI(request,env={},fetcher=globalThis.fetch){
 const url=new URL(request.url);
 const live=isTextLiveEnabled(env,fetcher);
 if(url.pathname==='/api/ai-status')return request.method==='GET'?json({provider:live?'meta':'mock',metaRequestsEnabled:live,textLiveAvailable:live,liveTasks:live?['interview','event']:[],model:'muse-spark-1.3',imageLiveAvailable:isImageLiveEnabled(env),imageModel:IMAGE_MODEL,tasks:['interview','event','video','image']}):json({error:'Method not allowed.'},405);
 const task={'/api/ai/interview':'interview','/api/ai/event':'event','/api/ai/video':'video','/api/ai/image':'image'}[url.pathname];if(!task)return null;
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'Open Witness before using this endpoint.'},403);
 if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')return json({error:'Send the interview as JSON.'},415);
 try{
  const reader=request.body?.getReader();if(!reader)return json({error:'The interview is empty.'},400);const chunks=[];let total=0;for(;;){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>150000){await reader.cancel();return json({error:'The interview is too long for this preview.'},413);}chunks.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const input=JSON.parse(new TextDecoder().decode(bytes));
  if(task==='image'){
   if(!isImageLiveEnabled(env))return json({error:'Meta image generation is not enabled on this server.'},503);
   if(inFlight)return json({error:'Another AI request is running. Wait before generating an image.'},429);
   inFlight=true;try{return json(await runMetaImage(input,{apiKey:env.MODEL_API_KEY,fetcher,signal:request.signal}));}finally{inFlight=false;}
  }
  if(task==='event'){
   if(input&&typeof input==='object'&&'repair' in input)return json({error:'The server manages repair attempts. Send the interview without repair data.'},400);
   if(isTextLiveEnabled(env,fetcher)){
    if(inFlight)return json({error:'Another AI request is running. Wait a moment before retrying. Your answers are still saved.'},429);
    inFlight=true;
    try{
     const run=await runVerifiedEvent(input,{verifier:'meta',
      generate:(inp,rep,opts)=>runMetaTask('event',rep?{...inp,repair:rep}:inp,{apiKey:env.MODEL_API_KEY,fetcher,timeoutMs:opts.timeoutMs,signal:opts.signal,validateResult:false}),
      verify:async(cand,ans,opts)=>(await runMetaTask('verify',{title:input.title,answers:ans,candidate:cand},{apiKey:env.MODEL_API_KEY,fetcher,timeoutMs:opts.timeoutMs,signal:opts.signal})).result});
     return json(verifiedEventEnvelope(run));
    }finally{inFlight=false;}
   }
   return json(verifiedEventEnvelope(await runVerifiedEvent(input,{verifier:'mock',generate:mockEventGenerate,verify:mockEventVerify})));
  }
  if(task!=='video'&&isTextLiveEnabled(env,fetcher)){
   if(inFlight)return json({error:'Another AI request is running. Wait a moment before retrying. Your answers are still saved.'},429);
   inFlight=true;
   try{return json(await runMetaTask(task,input,{apiKey:env.MODEL_API_KEY,fetcher}));}
   finally{inFlight=false;}
  }
  return json(await runMockTask(task,input));
 }catch(err){
  if(err instanceof SyntaxError)return json({error:'The interview could not be read.'},400);
  return json({error:err.message},err.status||400);
 }
}
