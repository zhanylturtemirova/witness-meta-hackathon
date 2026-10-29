import {MAX_SECONDS,toWav,wavInfo} from './audio.js';
let recording=null,audioBlob=null,audioUrl='',audioProject=null,transcript='',busy=false,starting=false,tick=null,limit=null;
let status='Record a memory, then listen before using it.',error='',configured=false,configChecked=false,selectedProject=null;
let notify=()=>{},apply=()=>{};
export function voiceMarkup(){return `<div class="voice-box" id="voice-box"><div class="voice-toolbar"><button type="button" class="voice-record" id="voice-record"><svg width="15" height="19" viewBox="0 0 16 20" fill="none" aria-hidden="true"><rect x="5" y="1" width="6" height="11" rx="3" stroke="currentColor" stroke-width="1.4"/><path d="M2 9a6 6 0 0 0 12 0M8 15v4M5 19h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><span id="voice-record-label">Record an answer</span></button><span class="voice-duration" id="voice-duration">Up to 2 min · English</span><label class="voice-upload" id="voice-upload-label">Upload WAV<input type="file" id="voice-upload" accept=".wav,audio/wav" aria-label="Upload a WAV recording"></label></div><p class="voice-status" id="voice-status" role="status"></p><p class="voice-error" id="voice-error" role="alert" hidden></p><div class="voice-preview" id="voice-preview" hidden><audio id="voice-playback" controls aria-label="Listen to your recording"></audio><div class="voice-file-actions"><button type="button" id="voice-transcribe" class="text-button">Transcribe with Meta ↗</button><button type="button" id="voice-download" class="text-button">↓ Save audio</button><button type="button" id="voice-discard" class="text-button">Discard</button></div></div><p class="voice-connection" id="voice-connection">Checking the Meta connection…</p><div class="voice-transcript" id="voice-transcript-box" hidden><label for="voice-transcript">Check your transcript</label><textarea id="voice-transcript" rows="4" maxlength="20000"></textarea><button type="button" class="button outline small" id="voice-use">Add to my answer ↗</button></div></div>`;}
function draw(){
 const record=document.querySelector('#voice-record');if(!record)return;
 const active=!!recording,hasAudio=!!audioBlob;
 document.querySelector('#voice-record-label').textContent=active?'Stop recording':starting?'Opening microphone…':'Record an answer';
 record.disabled=busy||starting;record.classList.toggle('recording',active);record.setAttribute('aria-pressed',String(active));
 const elapsed=active?Math.min(MAX_SECONDS,Math.floor((Date.now()-recording.started)/1000)):0;
 document.querySelector('#voice-duration').textContent=active?`${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')} / 2:00`:'Up to 2 min · English';
 document.querySelector('#voice-status').textContent=status;
 const err=document.querySelector('#voice-error');err.textContent=error;err.hidden=!error;
 document.querySelector('#voice-preview').hidden=!hasAudio||active;
 const player=document.querySelector('#voice-playback');if(hasAudio&&player.getAttribute('src')!==audioUrl)player.src=audioUrl;
 const transcribe=document.querySelector('#voice-transcribe');transcribe.disabled=!configured||busy||active||!hasAudio;transcribe.textContent=busy?'Transcribing…':'Transcribe with Meta ↗';
 document.querySelector('#voice-discard').disabled=busy||active;
 const upload=document.querySelector('#voice-upload');upload.disabled=busy||active||starting;
 document.querySelector('#voice-connection').textContent=configChecked?(configured?'Transcribe sends this recording to Meta. Review the text before adding it.':'Meta transcription is not connected yet. You can still record and save audio.'):'Checking the Meta connection…';
 const box=document.querySelector('#voice-transcript-box');box.hidden=!transcript;
 const text=document.querySelector('#voice-transcript');if(document.activeElement!==text)text.value=transcript;
 document.querySelector('#voice-use').disabled=busy||active;
 const form=document.querySelector('#answer-form');if(form)form.querySelector('button[type="submit"]').disabled=active||busy||starting;
}
async function checkConnection(){
 try{const res=await fetch('/api/speech-status',{cache:'no-store',signal:AbortSignal.timeout(5000)});const result=res.ok?await res.json():{};configured=result.configured===true;}catch{configured=false;}finally{configChecked=true;draw();}
}
function release(){clearInterval(tick);clearTimeout(limit);tick=null;limit=null;}
async function stopCapture(keep=true){
 if(!recording)return;const rec=recording;recording=null;release();
 await new Promise(resolve=>{const timer=setTimeout(resolve,300);rec.node.port.onmessage=e=>{if(e.data?.stopped){clearTimeout(timer);resolve();}else if(e.data instanceof Float32Array)rec.chunks.push(e.data);};rec.node.port.postMessage('stop');});
 rec.stream.getTracks().forEach(t=>t.stop());rec.source.disconnect();rec.node.disconnect();rec.silent.disconnect();await rec.context.close().catch(()=>{});
 if(keep){try{const wav=toWav(rec.chunks,rec.rate);setAudio(new Blob([wav],{type:'audio/wav'}),rec.project);status='Listen to your recording. Nothing has been sent to Meta.';}catch(err){error=err.message;}}
 draw();
}
function setAudio(blob,project){if(audioUrl)URL.revokeObjectURL(audioUrl);audioBlob=blob;audioUrl=URL.createObjectURL(blob);audioProject=project;transcript='';error='';}
function clearAudio(){document.querySelector('#voice-playback')?.pause();if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl='';audioBlob=null;audioProject=null;transcript='';error='';status='Record a memory, then listen before using it.';draw();}
async function startCapture(){
 if(recording){await stopCapture();return;}if(busy||starting)return;
 if(audioBlob){error='Save or discard the current recording before starting another.';draw();return;}
 if(!navigator.mediaDevices?.getUserMedia||!window.AudioContext){error='Microphone recording is not available in this browser. You can upload a WAV file instead.';draw();return;}
 starting=true;error='';draw();let stream=null,context=null;
 try{
  const project=selectedProject;
  stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
  if(project!==selectedProject||!document.querySelector('#voice-box')){stream.getTracks().forEach(t=>t.stop());return;}
  context=new AudioContext();await context.resume();await context.audioWorklet.addModule('./pcm-recorder.js');
  const source=context.createMediaStreamSource(stream),node=new AudioWorkletNode(context,'witness-recorder'),silent=context.createGain();silent.gain.value=0;
  const rec={stream,context,source,node,silent,chunks:[],rate:context.sampleRate,started:Date.now(),project};
  node.port.onmessage=e=>{if(e.data instanceof Float32Array&&recording===rec)rec.chunks.push(e.data);};
  source.connect(node);node.connect(silent);silent.connect(context.destination);recording=rec;
  stream.getAudioTracks()[0].onended=()=>{if(recording===rec){status='Microphone disconnected.';stopCapture();}};
  status='Recording on this device. Stop when you’re ready.';tick=setInterval(draw,500);limit=setTimeout(()=>{status='Two-minute limit reached.';stopCapture();},MAX_SECONDS*1000);
 }catch(err){stream?.getTracks().forEach(t=>t.stop());await context?.close().catch(()=>{});error=err.name==='NotAllowedError'?'Microphone access was not allowed. You can allow it in browser settings or upload a WAV file.':err.name==='NotFoundError'?'No microphone was found. Connect one or upload a WAV file.':'The microphone could not be opened. Try again or upload a WAV file.';}
 finally{starting=false;draw();}
}
async function transcribe(){
 if(!audioBlob||busy||!configured)return;busy=true;error='';status='Sending this recording to Meta for transcription…';draw();
 try{
  const res=await fetch('/api/transcribe?language=English',{method:'POST',headers:{'Content-Type':'audio/wav'},body:audioBlob,signal:AbortSignal.timeout(95000)});
  let data;try{data=await res.json();}catch{throw Error('The transcription server did not respond correctly. Your recording is still here.');}
  if(!res.ok)throw Error(data.error||'Transcription failed. Your recording is still here.');
  if(typeof data.transcript!=='string'||!data.transcript.trim())throw Error('No speech was recognised. Listen to the recording or try again.');
  transcript=data.transcript;status='Your transcript is ready. Check it before adding it to your answer.';
 }catch(err){error=err.name==='TimeoutError'?'Transcription took too long. Your recording is still here.':err.message;status='Your recording is still available. You can retry or save it.';}
 finally{busy=false;draw();}
}
export function voiceBusy(){return !!recording||busy||starting;}
export function mountVoice(project,{onApply,onNotify}){
 selectedProject=project;apply=onApply;notify=onNotify;
 if(audioProject&&audioProject!==project)clearAudio();
 if(!document.querySelector('#voice-box'))return;
 document.querySelector('#voice-record').onclick=startCapture;
 document.querySelector('#voice-discard').onclick=clearAudio;
 document.querySelector('#voice-transcribe').onclick=transcribe;
 document.querySelector('#voice-download').onclick=()=>{const a=document.createElement('a');a.href=audioUrl;a.download='witness-memory.wav';a.click();};
 document.querySelector('#voice-upload').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  if(audioBlob){error='Save or discard the current recording before uploading another.';e.target.value='';draw();return;}
  try{if(file.size>6*1024*1024)throw Error('Choose a WAV recording smaller than 6 MB.');wavInfo(await file.arrayBuffer());setAudio(file,project);status='Recording loaded. Listen before transcribing.';}catch(err){error=err.message;}e.target.value='';draw();
 };
 document.querySelector('#voice-transcript').oninput=e=>{transcript=e.target.value;};
 document.querySelector('#voice-use').onclick=()=>{if(!transcript.trim())return;if(apply(transcript.trim())){clearAudio();notify('Transcript added. You can edit it before continuing.');}};
 draw();checkConnection();
}
export function leaveVoice(){selectedProject=null;if(recording)stopCapture(false);clearAudio();}
window.addEventListener('beforeunload',e=>{if(recording||audioBlob||busy){e.preventDefault();e.returnValue='';}});
