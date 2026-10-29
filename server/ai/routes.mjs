import {runMockTask} from '../../web/mock-ai.js';
import {META_NETWORK_ENABLED} from './meta.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function handleAI(request){
 const url=new URL(request.url);if(url.pathname==='/api/ai-status')return request.method==='GET'?json({provider:'mock',metaRequestsEnabled:META_NETWORK_ENABLED,model:'muse-spark-1.3',tasks:['interview','event','video']}):json({error:'Method not allowed.'},405);
 const task={'/api/ai/interview':'interview','/api/ai/event':'event','/api/ai/video':'video'}[url.pathname];if(!task)return null;
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'Open Witness before using this endpoint.'},403);
 if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')return json({error:'Send the interview as JSON.'},415);
 try{
  const reader=request.body?.getReader();if(!reader)return json({error:'The interview is empty.'},400);const chunks=[];let total=0;for(;;){const{done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>150000){await reader.cancel();return json({error:'The interview is too long for this preview.'},413);}chunks.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  const input=JSON.parse(new TextDecoder().decode(bytes));return json(await runMockTask(task,input));
 }catch(err){return json({error:err instanceof SyntaxError?'The interview could not be read.':err.message},400);}
}
