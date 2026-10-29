import {wavInfo} from '../web/audio.js';
export const MAX_UPLOAD_BYTES=6*1024*1024;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const languages=new Set(['English','German','French','Spanish','Italian','Portuguese','Japanese','Korean','Mandarin Chinese','Arabic','Bengali','Dutch','Hebrew','Hindi','Indonesian','Kannada','Malay','Marathi','Polish','Tagalog','Tamil','Telugu','Thai','Turkish','Vietnamese']);
let inFlight=false;
export async function handleSpeech(request,env={},fetcher=fetch){
 const url=new URL(request.url),enabled=env.META_TRANSCRIPTION_ENABLED==='true'&&!!env.MODEL_API_KEY;
 if(url.pathname==='/api/speech-status')return request.method==='GET'?json({configured:enabled,model:'muse-voice-transcribe-1.0'}):json({error:'Method not allowed.'},405);
 if(url.pathname!=='/api/transcribe')return null;
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 const origin=request.headers.get('Origin');if((origin&&origin!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'Open Witness in this browser before transcribing.'},403);
 if(!enabled)return json({error:'Meta transcription is not connected. You can still record, listen, and download your audio.'},503);
 if(inFlight)return json({error:'Another recording is being transcribed. Please wait.'},429);
 if(request.headers.get('Content-Type')?.split(';')[0]!=='audio/wav')return json({error:'Upload a PCM WAV recording.'},415);
 if(Number(request.headers.get('Content-Length'))>MAX_UPLOAD_BYTES)return json({error:'Choose a recording smaller than 6 MB.'},413);
 const language=url.searchParams.get('language')||'';if(language&&!languages.has(language))return json({error:'Choose a supported transcription language.'},400);
 inFlight=true;
 try{
   const reader=request.body?.getReader();if(!reader)return json({error:'The recording is empty.'},400);
   const parts=[];let length=0;
   for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_UPLOAD_BYTES){await reader.cancel();return json({error:'Choose a recording smaller than 6 MB.'},413);}parts.push(value);}
   const bytes=new Uint8Array(length);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}
   try{wavInfo(bytes.buffer);}catch(err){return json({error:err.message},400);}
   const settings={mode:'PUSH_TO_TALK',model:'muse-voice-transcribe-1.0',audioEncoding:'WAV'};
   if(language)settings.languageBias=[language];
   const form=new FormData();form.append('request',new Blob([JSON.stringify(settings)],{type:'application/json'}),'request.json');form.append('audio',new Blob([bytes],{type:'audio/wav'}),'memory.wav');
   const upstream=await fetcher('https://api.meta.ai/v1/asr/transcribe',{method:'POST',headers:{Authorization:`Bearer ${env.MODEL_API_KEY}`,Accept:'application/json'},body:form,signal:AbortSignal.timeout(90000)});
   if(!upstream.ok){const messages={401:'The server API key was not accepted. Check the Meta connection.',402:'Meta requires billing to be set up. Check the payment method and available credits.',403:'This Meta account does not have access to speech transcription.',429:'Meta is busy or the account limit was reached. Wait a moment before trying again.'};return json({error:messages[upstream.status]||'Meta could not transcribe this recording. Your recording is still available; you can retry.'},upstream.status>=500?502:upstream.status);}
   const result=await upstream.json();if(typeof result.transcript!=='string')return json({error:'Meta returned an unreadable transcript. Your recording is still available.'},502);
   if(!result.transcript.trim())return json({error:'No speech was recognised. Listen to the recording or try again.'},422);
   if(result.transcript.length>20000)return json({error:'The transcript is too long for one answer. Use a shorter recording.'},422);
   return json({transcript:result.transcript,model:'muse-voice-transcribe-1.0'});
 }catch(err){return json({error:err.name==='TimeoutError'?'Transcription took too long. Your recording is still available; try again.':'The transcription service could not be reached. Your recording is still available.'},502);}
 finally{inFlight=false;}
}
