// Optional "Telephone voice" listening effect for playable audio.
//
// speechSynthesis output cannot be routed through Web Audio filters, so this
// effect only applies to real audio signals: saved recordings during playback
// and narration baked into an explicitly selected film export. Originals are
// never modified; Natural playback stays bit-transparent native audio.
//
// Two implementations share TELEPHONE_SPEC: native Web Audio nodes for the
// browser (createTelephoneChain, attachTelephonePlayback) and a dependency-
// free reference DSP (applyTelephoneEffect) that the test suite runs against
// generated fixtures. Node parameters match; the reference compressor is a
// static soft-knee curve while the live chain uses DynamicsCompressorNode.
export const TELEPHONE_SPEC={
 highpassHz:300,lowpassHz:3400,filterQ:Math.SQRT1_2,
 compThresholdDb:-20,compRatio:3,compKneeDb:12,compAttack:0.003,compRelease:0.2,
 saturationDrive:1.5,makeupDb:6,
 limiterThresholdDb:-2,limiterRatio:20,limiterAttack:0.002,limiterRelease:0.1,
 ceiling:0.98,minRate:8000,maxRate:192000,
};
export const LISTEN_MODE_KEY='witness.listen-mode.v1';
const dbToGain=db=>Math.pow(10,db/20);
const gainToDb=gain=>20*Math.log10(Math.max(1e-9,gain));

// --- Reference DSP: pure functions over Float32Array, no DOM. ---

function biquadCoefficients(type,frequency,sampleRate,Q=TELEPHONE_SPEC.filterQ){
 const w=2*Math.PI*frequency/sampleRate,cos=Math.cos(w),sin=Math.sin(w),alpha=sin/(2*Q);
 let b0,b1,b2,a0,a1,a2;
 if(type==='highpass'){b0=(1+cos)/2;b1=-(1+cos);b2=(1+cos)/2;a0=1+alpha;a1=-2*cos;a2=1-alpha;}
 else{b0=(1-cos)/2;b1=1-cos;b2=(1-cos)/2;a0=1+alpha;a1=-2*cos;a2=1-alpha;}
 return [b0/a0,b1/a0,b2/a0,a1/a0,a2/a0];
}
function runBiquad(samples,[b0,b1,b2,a1,a2]){
 const out=new Float32Array(samples.length);let x1=0,x2=0,y1=0,y2=0;
 for(let i=0;i<samples.length;i++){
  const x=samples[i],y=b0*x+b1*x1+b2*x2-a1*y1-a2*y2;
  x2=x1;x1=x;y2=y1;y1=y;out[i]=y;
 }
 return out;
}
// Static soft-knee downward compression on linear magnitudes.
function compressMagnitude(mag){
 const {compThresholdDb:T,compRatio:R,compKneeDb:K}=TELEPHONE_SPEC;
 const level=gainToDb(mag);
 if(level<=T-K/2)return mag;
 const compressed=level>=T+K/2?T+(level-T)/R:level+((1/R-1)*Math.pow(level-T+K/2,2))/(2*K);
 return dbToGain(compressed);
}
const saturate=x=>{
 const k=TELEPHONE_SPEC.saturationDrive;
 return Math.tanh(k*x)/k;
};
// Returns a new Float32Array; the input is never mutated.
export function applyTelephoneEffect(samples,sampleRate){
 if(!(samples instanceof Float32Array))throw Error('Telephone effect needs mono Float32 samples.');
 if(!Number.isFinite(sampleRate)||sampleRate<TELEPHONE_SPEC.minRate||sampleRate>TELEPHONE_SPEC.maxRate)throw Error('Telephone effect needs a sample rate between 8 and 192 kHz.');
 if(!samples.length)return new Float32Array(0);
 const highpassed=runBiquad(samples,biquadCoefficients('highpass',TELEPHONE_SPEC.highpassHz,sampleRate));
 const band=runBiquad(highpassed,biquadCoefficients('lowpass',TELEPHONE_SPEC.lowpassHz,sampleRate));
 const makeup=dbToGain(TELEPHONE_SPEC.makeupDb),out=new Float32Array(band.length);
 let peak=0;
 for(let i=0;i<band.length;i++){
  const x=band[i],sign=x<0?-1:1;
  const value=saturate(compressMagnitude(Math.abs(x))*sign)*makeup;
  out[i]=value;const a=Math.abs(value);if(a>peak)peak=a;
 }
 // Safety ceiling only: tame peaks that still exceed it, never amplify.
 if(peak>TELEPHONE_SPEC.ceiling){const scale=TELEPHONE_SPEC.ceiling/peak;for(let i=0;i<out.length;i++)out[i]*=scale;}
 return out;
}

// --- Native Web Audio chain for live playback and film export. ---

export function telephoneCurve(length=1024){
 const curve=new Float32Array(length);
 for(let i=0;i<length;i++){const x=(i/(length-1))*2-1;curve[i]=saturate(x);}
 return curve;
}
// Builds input -> highpass -> lowpass -> compressor -> saturator -> makeup
// -> limiter -> output. Works with AudioContext and OfflineAudioContext.
export function createTelephoneChain(context){
 for(const factory of ['createBiquadFilter','createDynamicsCompressor','createWaveShaper','createGain']){
  if(typeof context?.[factory]!=='function')throw Error('This browser cannot build audio effects.');
 }
 const s=TELEPHONE_SPEC;
 const high=context.createBiquadFilter();high.type='highpass';high.frequency.value=s.highpassHz;high.Q.value=s.filterQ;
 const low=context.createBiquadFilter();low.type='lowpass';low.frequency.value=s.lowpassHz;low.Q.value=s.filterQ;
 const comp=context.createDynamicsCompressor();
 comp.threshold.value=s.compThresholdDb;comp.knee.value=s.compKneeDb;comp.ratio.value=s.compRatio;
 comp.attack.value=s.compAttack;comp.release.value=s.compRelease;
 const shaper=context.createWaveShaper();shaper.curve=telephoneCurve();shaper.oversample='2x';
 const makeup=context.createGain();makeup.gain.value=dbToGain(s.makeupDb);
 const limiter=context.createDynamicsCompressor();
 limiter.threshold.value=s.limiterThresholdDb;limiter.knee.value=0;limiter.ratio.value=s.limiterRatio;
 limiter.attack.value=s.limiterAttack;limiter.release.value=s.limiterRelease;
 high.connect(low);low.connect(comp);comp.connect(shaper);shaper.connect(makeup);makeup.connect(limiter);
 return {input:high,output:limiter,nodes:{high,low,comp,shaper,makeup,limiter}};
}

// --- Listening-mode preference and <audio> playback routing. ---

export function loadListenMode(storage){
 try{if(storage?.getItem(LISTEN_MODE_KEY)==='telephone')return 'telephone';}catch{}
 return 'natural';
}
export function saveListenMode(storage,mode){
 const value=mode==='telephone'?'telephone':'natural';
 try{storage?.setItem(LISTEN_MODE_KEY,value);}catch{}
 return value;
}
let sharedContext=null;
export function sharedPlaybackContext(){
 if(sharedContext)return sharedContext;
 const Ctor=typeof window!=='undefined'?(window.AudioContext||window.webkitAudioContext):null;
 if(!Ctor)throw Error('This browser cannot play audio effects.');
 sharedContext=new Ctor();
 return sharedContext;
}
// Captures one <audio> element into a dry/wet graph. A MediaElementSource can
// be created only once per element, so handles are cached and dispose() only
// routes back to the unity-gain dry path; it cannot uncapture the element.
const unlockArmed=new WeakSet();
// Applies the saved listening mode to playable <audio> elements. Natural
// leaves native playback untouched; telephone captures each element once and
// arms a one-time resume for contexts created outside a user gesture.
// Returns the effective mode, falling back to natural on any failure.
export function applyListenMode(players,storage){
 const mode=loadListenMode(storage);
 const list=[...players||[]].filter(Boolean);
 if(!list.length||mode!=='telephone')return mode;
 try{
  const context=sharedPlaybackContext();
  for(const player of list){
   attachTelephonePlayback(player,context).setMode('telephone');
   if(context.state!=='running'&&!unlockArmed.has(player)&&typeof player.addEventListener==='function'){
    unlockArmed.add(player);
    player.addEventListener('play',()=>{context.resume?.().catch(()=>{});},{once:true});
   }
  }
  if(context.state!=='running')context.resume?.().catch(()=>{});
  return 'telephone';
 }catch{
  saveListenMode(storage,'natural');
  return 'natural';
 }
}
const attached=new WeakMap();
export function attachTelephonePlayback(element,context){
 if(!element||typeof element!=='object')throw Error('Telephone playback needs an audio element.');
 const known=attached.get(element);
 if(known){if(context&&known.context!==context)known.context=context;return known;}
 if(typeof context?.createMediaElementSource!=='function'||typeof context?.createGain!=='function'||!context.destination)throw Error('This browser cannot route playback audio through effects.');
 const source=context.createMediaElementSource(element);
 const dry=context.createGain();dry.gain.value=1;
 const wet=context.createGain();wet.gain.value=0;
 const chain=createTelephoneChain(context);
 source.connect(dry);dry.connect(context.destination);
 source.connect(chain.input);chain.output.connect(wet);wet.connect(context.destination);
 const fade=(param,value)=>{
  if(param&&typeof param.setTargetAtTime==='function'&&Number.isFinite(context.currentTime))param.setTargetAtTime(value,context.currentTime,0.03);
  else if(param)param.value=value;
 };
 const handle={
  context,mode:'natural',
  setMode(next){
   this.mode=next==='telephone'?'telephone':'natural';
   const on=this.mode==='telephone';
   fade(dry.gain,on?0:1);fade(wet.gain,on?1:0);
   return this.mode;
  },
  dispose(){this.setMode('natural');},
 };
 attached.set(element,handle);
 return handle;
}
