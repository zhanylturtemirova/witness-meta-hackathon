const STORAGE_KEY='witness.question-speech.v1';
const rates=[0.75,0.9,1,1.1,1.25];

// This controller never sends text to an API. Offer only installed English voices.
export function createQuestionSpeech({synth,Utterance,storage,onChange=()=>{}}={}){
 let settings={enabled:false,voiceURI:'',rate:1};
 try{
  const saved=JSON.parse(storage?.getItem(STORAGE_KEY)||'null');
  if(saved)settings={enabled:saved.enabled===true,voiceURI:typeof saved.voiceURI==='string'?saved.voiceURI:'',rate:rates.includes(saved.rate)?saved.rate:1};
 }catch{}
 let target=null,activated=false,lastKey=null,utterance=null,message='';
 const supported=!!(synth&&Utterance);
 const voices=()=>supported?synth.getVoices().filter(v=>v.localService===true&&/^en(?:[-_]|$)/i.test(v.lang)):[];
 const snapshot=()=>({supported,...settings,voices:voices(),speaking:!!utterance,message,ready:!!target&&!target.pending&&target.canSpeak()});
 const changed=()=>onChange(snapshot());
 function persist(){try{storage?.setItem(STORAGE_KEY,JSON.stringify(settings));}catch{message='Your voice preference could not be saved on this device.';}}
 function stop(){
  const active=utterance;utterance=null;
  if(active){active.onend=null;active.onerror=null;synth.cancel();}
  changed();
 }
 function read(){
  activated=true;
  if(!supported||!settings.enabled||!target||target.pending||!target.canSpeak())return false;
  stop();
  const available=voices();
  if(!available.length){message='No installed English voice is available. You can keep reading the questions.';changed();return false;}
  const voice=available.find(v=>v.voiceURI===settings.voiceURI)||available.find(v=>v.default)||available[0];
  const next=new Utterance(target.text);
  next.voice=voice;next.lang=voice.lang;next.rate=settings.rate;
  utterance=next;lastKey=target.key;message='';
  next.onend=()=>{if(utterance===next){utterance=null;changed();}};
  next.onerror=()=>{if(utterance===next){utterance=null;message='Read-aloud could not start. Try Read again, or choose another voice.';changed();}};
  try{synth.speak(next);}catch{next.onerror();}
  changed();return true;
 }
 return {
  snapshot,stop,read,
  setTarget(next){
   if(!next||next.pending||target?.key!==next.key)stop();
   target=next?{...next,canSpeak:next.canSpeak||(()=>true)}:null;
   if(target&&!target.pending&&settings.enabled&&activated&&target.key!==lastKey)read();
   changed();
  },
  configure(patch){
   stop();
   if(typeof patch.enabled==='boolean')settings.enabled=patch.enabled;
   if(typeof patch.voiceURI==='string')settings.voiceURI=patch.voiceURI;
   if(rates.includes(patch.rate))settings.rate=patch.rate;
   message='';persist();changed();
  },
  refresh:changed
 };
}

let controller=null;
const $=selector=>document.querySelector(selector);
export function questionSpeechMarkup(){return `<section class="question-speech" id="question-speech" aria-label="Read questions aloud"><label class="checkbox-label"><input type="checkbox" id="question-speech-enabled"> Read questions aloud</label><div class="question-speech-controls" id="question-speech-controls" hidden><label>Voice<select id="question-speech-voice" aria-label="Question voice"></select></label><label>Speed<select id="question-speech-rate" aria-label="Question speed">${rates.map(rate=>`<option value="${rate}">${rate}×</option>`).join('')}</select></label><button type="button" class="text-button" id="question-speech-read">Read again</button><button type="button" class="text-button" id="question-speech-stop">Stop</button></div><small id="question-speech-status" role="status"></small></section>`;}
function draw(state){
 const root=$('#question-speech');if(!root)return;
 const toggle=$('#question-speech-enabled');toggle.checked=state.enabled;toggle.disabled=!state.supported;
 $('#question-speech-controls').hidden=!state.enabled||!state.supported;
 const select=$('#question-speech-voice');
 const signature=JSON.stringify(state.voices.map(v=>[v.voiceURI,v.name,v.lang]));
 if(select.dataset.voices!==signature){
  select.replaceChildren();
  const option=document.createElement('option');option.value='';option.textContent='Device default (English)';select.append(option);
  for(const voice of state.voices){const item=document.createElement('option');item.value=voice.voiceURI;item.textContent=`${voice.name} · ${voice.lang}`;select.append(item);}
  select.dataset.voices=signature;
 }
 select.value=state.voices.some(v=>v.voiceURI===state.voiceURI)?state.voiceURI:'';
 select.disabled=!state.voices.length;
 $('#question-speech-rate').value=String(state.rate);
 $('#question-speech-read').disabled=!state.ready||!state.voices.length;
 $('#question-speech-stop').disabled=!state.speaking;
 $('#question-speech-status').textContent=!state.supported?'Read-aloud is not available in this browser.':state.message||(!state.enabled?'Uses an installed device voice.':!state.voices.length?'No installed English voice is available.':state.speaking?'Reading the question…':!state.ready?'Read-aloud is paused while you record or wait for a question.':'Device voice · choose Read again to listen.');
}
export function mountQuestionSpeech(target){
 if(!controller){
  let storage;try{storage=window.localStorage;}catch{}
  controller=createQuestionSpeech({synth:window.speechSynthesis,Utterance:window.SpeechSynthesisUtterance,storage,onChange:draw});
  window.speechSynthesis?.addEventListener('voiceschanged',()=>controller.refresh());
  window.addEventListener('pagehide',()=>controller.setTarget(null));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)controller.stop();});
 }
 controller.setTarget(target);
 $('#question-speech-enabled').onchange=e=>{controller.configure({enabled:e.target.checked});if(e.target.checked)controller.read();};
 $('#question-speech-voice').onchange=e=>controller.configure({voiceURI:e.target.value});
 $('#question-speech-rate').onchange=e=>controller.configure({rate:Number(e.target.value)});
 $('#question-speech-read').onclick=()=>controller.read();
 $('#question-speech-stop').onclick=()=>controller.stop();
 controller.refresh();
}
export function stopQuestionSpeech(){controller?.stop();}
export function refreshQuestionSpeech(){controller?.refresh();}
export function unmountQuestionSpeech(){controller?.setTarget(null);}
