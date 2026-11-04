import {MAX_SECONDS,toWav,wavInfo} from './audio.js';
import {stopQuestionSpeech,refreshQuestionSpeech} from './question-speech.js';
import {nextQuestion,questionIdentity,addRecordingMeta,getRecordingMeta,removeRecordingMeta,setRecordingTranscript,recordingAnswer} from './domain.js';
import {mediaSave,mediaLoad,mediaDelete,MEDIA_RECORDINGS} from './media-store.js';
import {applyListenMode,loadListenMode,saveListenMode} from './telephone.js';
import {apiAuthHeaders,ensureApiToken,hasApiToken,setApiToken,setHostedMode} from './api-auth.js';
const listenStorage=()=>{try{return window.localStorage;}catch{return undefined;}};
let recording=null,project=null,activeId=null;
const cache=new Map();
let busy=false,starting=false,stopping=false,loadingAudio=false,pendingSaves=0,tick=null,limit=null;
let status='Record a memory, then listen before using it.',error='',storageWarning='';
let configured=false,configChecked=false,speechHosted=false;
let attachArmed=null,lastProject=null;
const discardedIds=new Set();
let notify=()=>{},apply=()=>{},persist=()=>{},revisit=()=>{};
const fmtDur=s=>typeof s!=='number'||!(s>=0)?'–':`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const activeMeta=()=>project&&activeId?getRecordingMeta(project,activeId):null;
const activeAudio=()=>activeId?cache.get(activeId)||null:null;
export function voiceMarkup(){return `<div class="voice-box" id="voice-box"><div class="voice-toolbar"><button type="button" class="voice-record" id="voice-record"><svg width="15" height="19" viewBox="0 0 16 20" fill="none" aria-hidden="true"><rect x="5" y="1" width="6" height="11" rx="3" stroke="currentColor" stroke-width="1.4"/><path d="M2 9a6 6 0 0 0 12 0M8 15v4M5 19h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><span id="voice-record-label">Record an answer</span></button><span class="voice-duration" id="voice-duration">Up to 2 min · English</span><label class="voice-upload" id="voice-upload-label">Upload WAV<input type="file" id="voice-upload" accept=".wav,audio/wav" aria-label="Upload a WAV recording"></label></div><div class="voice-saved" id="voice-saved-wrap" hidden><label for="voice-saved">Saved recordings for this story</label><select id="voice-saved"></select></div><p class="voice-status" id="voice-status" role="status"></p><p class="voice-error" id="voice-error" role="alert" hidden></p><p class="muted" id="voice-storage" role="status" hidden></p><p class="muted" id="voice-recorded-for" hidden></p><div class="voice-preview" id="voice-preview" hidden><audio id="voice-playback" controls aria-label="Listen to your recording"></audio><div class="listen-mode" role="radiogroup" aria-label="Listen as"><span>Listen as:</span><label><input type="radio" name="voice-listen" value="natural"> Natural</label><label><input type="radio" name="voice-listen" value="telephone"> Telephone</label></div><p class="muted">Telephone changes playback only. The recording, transcript and download stay original.</p><div class="voice-file-actions"><button type="button" id="voice-transcribe" class="text-button">Transcribe with Meta ↗</button><button type="button" id="voice-download" class="text-button">↓ Save audio</button><button type="button" id="voice-discard" class="text-button">Discard</button></div></div><p class="voice-connection" id="voice-connection">Checking the Meta connection…</p><div class="voice-transcript" id="voice-transcript-box" hidden><label for="voice-transcript">Check your transcript</label><small class="voice-origin" id="voice-transcript-origin"></small><textarea id="voice-transcript" rows="4" maxlength="20000"></textarea><button type="button" class="button outline small" id="voice-use">Add to my answer ↗</button> <button type="button" class="text-button" id="voice-revisit" hidden>Open that answer in review</button></div></div>`;}
function draw(){
 const record=document.querySelector('#voice-record');if(!record||!project)return;
 const meta=activeMeta(),active=!!recording,hasAudio=!!(meta&&activeAudio());
 document.querySelector('#voice-record-label').textContent=active?'Stop recording':starting?'Opening microphone…':stopping?'Saving recording…':'Record an answer';
 record.disabled=busy||starting||stopping||loadingAudio;record.classList.toggle('recording',active);record.setAttribute('aria-pressed',String(active));
 const elapsed=active?Math.min(MAX_SECONDS,Math.floor((Date.now()-recording.started)/1000)):0;
 document.querySelector('#voice-duration').textContent=active?`${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')} / 2:00`:meta?`${fmtDur(meta.durationSec)} · WAV`:'Up to 2 min · English';
 const saved=document.querySelector('#voice-saved'),wrap=document.querySelector('#voice-saved-wrap');
 const list=project.recordings||[];wrap.hidden=list.length<2;
 if(list.length>=2){saved.innerHTML=list.map((r,i)=>`<option value="${r.id}"${r.id===activeId?' selected':''}>Recording ${i+1} · ${fmtDur(r.durationSec)} · ${r.question.slice(0,48)}</option>`).join('');}
 saved.disabled=busy||active||stopping||loadingAudio;
 document.querySelector('#voice-status').textContent=stopping?'Saving your recording…':loadingAudio?'Loading your saved recording…':status;
 const err=document.querySelector('#voice-error');err.textContent=error;err.hidden=!error;
 const store=document.querySelector('#voice-storage');store.textContent=storageWarning;store.hidden=!storageWarning;
 const recordedFor=document.querySelector('#voice-recorded-for');recordedFor.textContent=meta?`Recorded for: ${meta.question}`:'';recordedFor.hidden=!meta;
 document.querySelector('#voice-preview').hidden=!hasAudio||active;
 const player=document.querySelector('#voice-playback'),audio=activeAudio();if(hasAudio&&player.getAttribute('src')!==audio.url)player.src=audio.url;
 const listenMode=loadListenMode(listenStorage());document.querySelectorAll('input[name="voice-listen"]').forEach(r=>{r.checked=r.value===listenMode;});
 const needsSignin=speechHosted&&!hasApiToken();
 const transcribe=document.querySelector('#voice-transcribe');transcribe.disabled=!configured||needsSignin||busy||active||stopping||!hasAudio||loadingAudio;transcribe.textContent=busy?'Transcribing…':'Transcribe with Meta ↗';
 document.querySelector('#voice-discard').disabled=busy||active||stopping||!meta;
 document.querySelector('#voice-download').disabled=!hasAudio;
 const upload=document.querySelector('#voice-upload');upload.disabled=busy||active||starting||stopping||loadingAudio;
 document.querySelector('#voice-connection').textContent=!configChecked?'Checking the Meta connection…':!configured?'Meta transcription is not connected yet. You can still record and save audio.':speechHosted&&!hasApiToken()?'Sign in to transcribe with Meta. Recording and playback stay available.':'Transcribe sends this recording to Meta. Review the text before adding it.';
 const box=document.querySelector('#voice-transcript-box'),hasTranscript=!!(meta&&meta.transcript);box.hidden=!hasTranscript;
 document.querySelector('#voice-transcript-origin').textContent=hasTranscript&&meta.transcriptModel?`Transcribed with Meta · ${meta.transcriptModel}`:hasTranscript?'Transcript draft — not sent': '';
 const text=document.querySelector('#voice-transcript');if(document.activeElement!==text)text.value=meta?.transcript||'';
 const mismatch=!!(meta&&hasTranscript&&meta.questionKey!==questionIdentity(project));
 const armed=!!(meta&&mismatch&&attachArmed&&attachArmed.id===meta.id&&attachArmed.key===questionIdentity(project));
 const use=document.querySelector('#voice-use');use.disabled=busy||active||!hasTranscript;use.textContent=armed?'Add to this answer anyway':'Add to my answer ↗';
 document.querySelector('#voice-revisit').hidden=!mismatch||!recordingAnswer(project,meta);
 const form=document.querySelector('#answer-form');if(form)form.querySelector('button[type="submit"]').disabled=active||busy||starting||stopping;
 refreshQuestionSpeech();
}
async function checkConnection(){
 try{const res=await fetch('/api/speech-status',{cache:'no-store',signal:AbortSignal.timeout(5000)});const result=res.ok?await res.json():{};configured=result.configured===true;speechHosted=result.mode==='hosted';setHostedMode(speechHosted);if(speechHosted&&configured)await ensureApiToken();}catch{configured=false;speechHosted=false;setHostedMode(false);}finally{configChecked=true;draw();}
}
function release(){clearInterval(tick);clearTimeout(limit);tick=null;limit=null;}
async function ensureAudio(id){
 if(!id||cache.has(id))return cache.get(id)||null;
 if(discardedIds.has(id))return null;
 const record=await mediaLoad(MEDIA_RECORDINGS,id);
 if(discardedIds.has(id)||!record?.blob)return null;
 const entry={blob:record.blob,url:URL.createObjectURL(record.blob)};
 cache.set(id,entry);return entry;
}
async function restoreActive(){
 const meta=activeMeta();
 if(!meta){draw();return;}
 if(cache.has(meta.id)){draw();return;}
 loadingAudio=true;draw();
 const id=meta.id;
 try{
  const audio=await ensureAudio(id);
  if(!audio&&project&&activeId===id){error='A saved recording could not be opened. Its transcript, if any, is still below. Discard it to record again.';}
 }finally{loadingAudio=false;if(project)draw();}
}
async function saveRecording(owner,blob,question,questionKey,durationSec){
 const id=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(36).slice(2));
 const meta=addRecordingMeta(owner,{id,question,questionKey,projectId:owner.id,durationSec});
 pendingSaves++;
 try{
  const saved=await mediaSave(MEDIA_RECORDINGS,{id,projectId:owner.id,blob});
  if(!saved.persistent)storageWarning=saved.error||storageWarning;
 }finally{pendingSaves--;}
 if(project===owner)activeId=id;
 persist();return meta;
}
async function stopCapture(keep=true){
 if(!recording||stopping)return;const rec=recording;recording=null;release();stopping=true;
 const owner=project,ownerQuestion=project?nextQuestion(project):'',ownerKey=project?questionIdentity(project):'';
 draw();
 try{
  await new Promise(resolve=>{const timer=setTimeout(resolve,300);rec.node.port.onmessage=e=>{if(e.data?.stopped){clearTimeout(timer);resolve();}else if(e.data instanceof Float32Array)rec.chunks.push(e.data);};rec.node.port.postMessage('stop');});
  rec.stream.getTracks().forEach(t=>t.stop());rec.source.disconnect();rec.node.disconnect();rec.silent.disconnect();await rec.context.close().catch(()=>{});
  if(keep&&owner){
   const wav=toWav(rec.chunks,rec.rate);let duration=null;
   try{duration=wavInfo(wav).duration;}catch{}
   const blob=new Blob([wav],{type:'audio/wav'});
   const meta=await saveRecording(owner,blob,ownerQuestion,ownerKey,duration);
   cache.set(meta.id,{blob,url:URL.createObjectURL(blob)});
   if(project===owner){status='Recording saved for this story. Listen, transcribe, or keep it for narration.';error='';}
  }
 }catch(err){if(owner&&project===owner)error=err.message;}
 finally{stopping=false;draw();}
}
async function discardActive(){
 const owner=project,meta=activeMeta();if(!owner||!meta||busy||stopping||recording)return;
 attachArmed=null;
 const id=meta.id,cached=cache.get(id);
 cache.delete(id);if(cached)URL.revokeObjectURL(cached.url);
 discardedIds.add(id);
 try{await mediaDelete(MEDIA_RECORDINGS,id);}catch{}
 removeRecordingMeta(owner,id);
 persist();
 if(project!==owner)return;
 const rest=owner.recordings||[];activeId=rest.length?rest[rest.length-1].id:null;
 status=rest.length?'Recording discarded. Showing your most recent saved recording.':'Recording discarded.';error='';
 draw();restoreActive();
}
async function startCapture(){
 stopQuestionSpeech();
 if(recording){await stopCapture();return;}if(busy||starting||stopping||!project)return;
 if(!navigator.mediaDevices?.getUserMedia||!window.AudioContext){error='Microphone recording is not available in this browser. You can upload a WAV file instead.';draw();return;}
 starting=true;error='';draw();let stream=null,context=null;
 try{
  const current=project;
  stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
  if(project!==current||!document.querySelector('#voice-box')){stream.getTracks().forEach(t=>t.stop());return;}
  context=new AudioContext();await context.resume();
  if(context.state!=='running')throw Object.assign(Error('The microphone opened but recording could not start. Press Record again to try with a fresh tap.'),{name:'SuspendedError'});
  await context.audioWorklet.addModule('./pcm-recorder.js');
  const source=context.createMediaStreamSource(stream),node=new AudioWorkletNode(context,'witness-recorder'),silent=context.createGain();silent.gain.value=0;
  const rec={stream,context,source,node,silent,chunks:[],rate:context.sampleRate,started:Date.now(),project:current.id};
  node.port.onmessage=e=>{if(e.data instanceof Float32Array&&recording===rec)rec.chunks.push(e.data);};
  source.connect(node);node.connect(silent);silent.connect(context.destination);recording=rec;
  stream.getAudioTracks()[0].onended=()=>{if(recording===rec){status='Microphone disconnected.';stopCapture();}};
  status='Recording on this device. Stop when you’re ready.';tick=setInterval(draw,500);limit=setTimeout(()=>{status='Two-minute limit reached.';stopCapture();},MAX_SECONDS*1000);
 }catch(err){stream?.getTracks().forEach(t=>t.stop());await context?.close().catch(()=>{});error=err.name==='NotAllowedError'?'Microphone access was not allowed. You can allow it in browser settings or upload a WAV file.':err.name==='NotFoundError'?'No microphone was found. Connect one or upload a WAV file.':err.name==='SuspendedError'?err.message:'The microphone could not be opened. Try again or upload a WAV file.';}
 finally{starting=false;draw();}
}
async function transcribe(){
 const owner=project,meta=activeMeta(),audio=activeAudio();
 if(!owner||!meta||!audio||busy||!configured||loadingAudio)return;busy=true;error='';status='Sending this recording to Meta for transcription…';draw();
 try{
  await ensureApiToken();
  const res=await fetch('/api/transcribe?language=English',{method:'POST',headers:{'Content-Type':'audio/wav',...apiAuthHeaders()},body:audio.blob,signal:AbortSignal.timeout(95000)});
  let data;try{data=await res.json();}catch{throw Error('The transcription server did not respond correctly. Your recording is still here.');}
  if(res.status===401)setApiToken('');
  if(!res.ok)throw Error(data.error||'Transcription failed. Your recording is still here.');
  if(typeof data.transcript!=='string'||!data.transcript.trim())throw Error('No speech was recognised. Listen to the recording or try again.');
  try{setRecordingTranscript(owner,meta.id,data.transcript,typeof data.model==='string'?data.model:'');}catch(err){throw Error(err.message+' Your recording is still here.');}
  persist();status='Your transcript is ready. Check it before adding it to your answer.';
 }catch(err){error=err.name==='TimeoutError'?'Transcription took too long. Your recording is still here.':err.message;status='Your recording is still available. You can retry or save it.';}
 finally{busy=false;draw();}
}
export function voiceBusy(){return !!recording||busy||starting||stopping;}
export function startVoiceCapture(){return startCapture();}
export function voicePendingSaves(){return pendingSaves;}
export function mountVoice(p,{onApply,onNotify,onSave,onRevisit}){
 if(p!==lastProject){attachArmed=null;lastProject=p;}
 project=p;apply=onApply;notify=onNotify;persist=onSave||(()=>{});revisit=onRevisit||(()=>{});
 const list=p.recordings||[];
 if(!activeId||!list.some(r=>r.id===activeId))activeId=list.length?list[list.length-1].id:null;
 if(!document.querySelector('#voice-box'))return;
 document.querySelector('#voice-record').onclick=startCapture;
 const playback=document.querySelector('#voice-playback');
 playback.onplay=stopQuestionSpeech;playback.onpause=refreshQuestionSpeech;playback.onended=refreshQuestionSpeech;
 document.querySelector('#voice-discard').onclick=discardActive;
 document.querySelector('#voice-transcribe').onclick=transcribe;
 document.querySelector('#voice-download').onclick=()=>{const audio=activeAudio();if(!audio)return;const a=document.createElement('a');a.href=audio.url;a.download='witness-memory.wav';a.click();};
 document.querySelector('#voice-saved').onchange=e=>{if(busy||stopping||recording)return;attachArmed=null;activeId=e.target.value||null;error='';draw();restoreActive();};
 document.querySelector('#voice-upload').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  const owner=project;if(!owner||stopping){e.target.value='';return;}
  const ownerQuestion=nextQuestion(owner),ownerKey=questionIdentity(owner);
  try{
   if(file.size>6*1024*1024)throw Error('Choose a WAV recording smaller than 6 MB.');
   const buffer=await file.arrayBuffer();const info=wavInfo(buffer);
   const blob=new Blob([buffer],{type:'audio/wav'});
   const meta=await saveRecording(owner,blob,ownerQuestion,ownerKey,info.duration);
   cache.set(meta.id,{blob,url:URL.createObjectURL(blob)});
   if(project===owner){status='Recording saved for this story. Listen before transcribing.';error='';}
  }catch(err){if(project===owner)error=err.message;}e.target.value='';draw();
 };
 document.querySelector('#voice-transcript').oninput=e=>{const meta=activeMeta();if(!meta)return;try{setRecordingTranscript(project,meta.id,e.target.value);persist();}catch(err){error=err.message;draw();}};
 document.querySelector('#voice-use').onclick=()=>{
  const meta=activeMeta();if(!meta?.transcript.trim())return;
  const destination=questionIdentity(project);
  if(meta.questionKey!==destination&&!(attachArmed&&attachArmed.id===meta.id&&attachArmed.key===destination)){
   attachArmed={id:meta.id,key:destination};error='';
   status=recordingAnswer(project,meta)
    ?`This recording was made for “${meta.question}”. Open that answer in review, or add it to this answer anyway.`
    :`This recording was made for “${meta.question}”, which is no longer the current question. Add it to this answer anyway only if it belongs here.`;
   draw();return;
  }
  attachArmed=null;
  if(apply(meta.transcript.trim())){status='Transcript added. The recording stays saved until you discard it.';notify('Transcript added. You can edit it before continuing.');draw();}
 };
 document.querySelector('#voice-revisit').onclick=()=>{const meta=activeMeta();const found=meta&&recordingAnswer(project,meta);if(found)revisit(found.id);};
 document.querySelectorAll('input[name="voice-listen"]').forEach(r=>{r.onchange=()=>{const choice=document.querySelector('input[name="voice-listen"]:checked')?.value||'natural';saveListenMode(listenStorage(),choice);const effective=applyListenMode([document.querySelector('#voice-playback')],listenStorage());if(choice==='telephone'&&effective!=='telephone')status='Telephone playback is not available in this browser. Playing naturally.';draw();};});
 draw();checkConnection();restoreActive();applyListenMode([document.querySelector('#voice-playback')],listenStorage());
}
export function leaveVoice(){project=null;if(recording)stopCapture(false);}
window.addEventListener('beforeunload',e=>{if(recording||busy||starting||stopping||pendingSaves>0){e.preventDefault();e.returnValue='';}});
