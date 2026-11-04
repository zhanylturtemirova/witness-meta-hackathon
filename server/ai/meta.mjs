import {agentForTask} from '../../agents/index.mjs';
import {AI_SCHEMAS,validateAIInput,validateAIResult,validateVerifyOutput,validateDiscoveryInput,validateDiscoveryResult} from '../../web/ai-contracts.js';
// Master lock retained for future network features. Text interview/event and
// speech transcription each use their own lock below.
export const META_NETWORK_ENABLED=false;
// Deliberately unlocked: live interview/event work when the server also has
// META_AI_ENABLED=true plus MODEL_API_KEY, so mocks stay the default.
// Flip back to false to re-lock live text instantly.
// Transcription keeps its own META_TRANSCRIPTION_ENABLED flag; video planning uses the live art director when enabled.
export const META_TEXT_NETWORK_ENABLED=true;
// Deliberately unlocked: live voice transcription works when the server also has
// META_TRANSCRIPTION_ENABLED=true plus MODEL_API_KEY. Flip back to false to
// re-lock live transcription instantly.
export const META_SPEECH_NETWORK_ENABLED=true;
export const LIVE_TEXT_TASKS=['interview','event','archivist','editor','period','discovery','video'];
export const DISCOVERY_TIMEOUT_MS=65000;
export function isTextLiveEnabled(env={},fetcher=globalThis.fetch){
 return (META_TEXT_NETWORK_ENABLED||fetcher!==globalThis.fetch)&&env.META_AI_ENABLED==='true'&&!!env.MODEL_API_KEY;
}
export function buildMetaRequest(task,input){
 if(task==='discovery')validateDiscoveryInput(input);
 else validateAIInput(task,input);
 const agent=agentForTask(task);
 return {model:agent.model,messages:[{role:'system',content:agent.instructions[task]},{role:'user',content:JSON.stringify(input)}],response_format:{type:'json_schema',json_schema:{name:'witness_'+task,strict:true,schema:AI_SCHEMAS[task]}},max_tokens:8192};
}
function upstreamError(message,status=502){
 const err=Error(message);err.status=status;return err;
}
const DIAG_MAX = 120;
function diagField(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, DIAG_MAX);
}
// Safe failure diagnostics from a Meta error response: upstream status,
// error code/type/param, and the provider request id only. Never the
// message, raw body, other headers, keys, answers, or prompts.
export async function upstreamDiagnostics(response) {
  const out = {status: response.status, code: '', type: '', param: '', requestId: ''};
  try {
    out.requestId = diagField(response.headers?.get?.('x-request-id') || '');
  } catch {}
  try {
    const text = await response.text();
    const parsed = JSON.parse(String(text).slice(0, 4096));
    const err = parsed && typeof parsed === 'object' ? parsed.error : null;
    if (err && typeof err === 'object') {
      out.code = diagField(err.code);
      out.type = diagField(err.type);
      out.param = diagField(err.param);
    }
  } catch {}
  return out;
}
export function formatUpstreamLog(task, stage, diag) {
  const parts = [`[witness] meta ${task}.${stage} upstream=${diag.status}`];
  if (diag.code) parts.push(`code=${diag.code}`);
  if (diag.type) parts.push(`type=${diag.type}`);
  if (diag.param) parts.push(`param=${diag.param}`);
  if (diag.requestId) parts.push(`requestId=${diag.requestId}`);
  return parts.join(' ');
}
export async function runMetaTask(task,input,{apiKey,fetcher=globalThis.fetch,timeoutMs=60000,signal,validateResult=true,stage}={}){
 if(!META_TEXT_NETWORK_ENABLED&&fetcher===globalThis.fetch)throw Error('Meta requests are paused. Witness is using local mocks.');
 if(!apiKey)throw Error('A server API key is required.');
 const stageName=stage||(task==='verify'?'verify':'request');
 const body=buildMetaRequest(task,input);
 let response;
 try{
  response=await fetcher('https://api.meta.ai/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)});
 }catch(err){
  if(err?.name==='TimeoutError')throw upstreamError('Meta took too long to respond. Your answers are still saved; you can retry.');
  throw upstreamError('The Meta service could not be reached. Your answers are still saved; you can retry.');
 }
 if(!response.ok){
  // Safe observability: task, stage, status, error code/type/param, and
  // provider request id only. Never messages, bodies, keys, answers, or
  // prompts. Distinguishes generation failures from verification failures.
  try{console.error(formatUpstreamLog(task,stageName,await upstreamDiagnostics(response)));}catch{}
  const messages={401:'The server API key was not accepted. Your answers are still saved.',402:'Meta requires billing to be set up. Your answers are still saved.',403:'This Meta account does not have access to this model. Your answers are still saved.',429:'Meta is busy or the account limit was reached. Your answers are still saved; wait a moment before retrying.'};
  if(messages[response.status])throw upstreamError(messages[response.status],response.status);
  // Per Meta's docs a 404 means the model or path is wrong; our path is the
  // documented one, so this names the model side without guessing further.
  if(response.status===404)throw upstreamError('Meta could not find the requested model. Your answers are still saved.',404);
  throw upstreamError(stageName==='verify'?'Meta could not check the draft. Your answers are still saved.':'Meta could not complete this step. Your answers are still saved.',response.status>=500?502:response.status);
 }
 let payload;
 try{payload=await response.json();}catch{throw upstreamError('Meta returned an unreadable response. Your answers are still saved; you can retry.');}
 const message=payload.choices?.[0]?.message;
 if(message?.refusal)throw upstreamError('This request could not be completed. Your answers are still saved; you can continue editing.');
 if(typeof message?.content!=='string'||!message.content.trim()||payload.choices[0].finish_reason!=='stop')throw upstreamError('Meta returned an incomplete response. Your answers are still saved; you can retry.');
 let parsed;
 try{parsed=JSON.parse(message.content);}catch{throw upstreamError('Meta returned an unreadable response. Your answers are still saved; you can retry.');}
 try{
  if(task==='verify')return {provider:'meta',model:body.model,result:validateVerifyOutput(parsed,input.candidate,input.answers)};
  if(!validateResult)return {provider:'meta',model:body.model,result:parsed};
  return {provider:'meta',model:body.model,result:validateAIResult(task,parsed,input.answers)};
 }catch(err){
  err.status=err.status||502;throw err;
 }
}
