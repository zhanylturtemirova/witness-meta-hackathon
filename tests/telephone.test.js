import test from 'node:test';
import assert from 'node:assert/strict';
import {TELEPHONE_SPEC,applyTelephoneEffect,telephoneCurve,createTelephoneChain,attachTelephonePlayback,loadListenMode,saveListenMode,applyListenMode} from '../web/telephone.js';
import {toWav,wavInfo} from '../web/audio.js';
import {storyAudioMarkup} from '../web/story-audio.js';
import {videoExportMarkup} from '../web/video-export.js';
import {exampleProject} from '../web/domain.js';
import {mockEvent,mockVideo} from '../web/mock-ai.js';
import {projectInput} from '../web/ai-client.js';
import {saveEvent,confirmEvent,saveVideo} from '../web/event-model.js';
function readyFilm(){const p=exampleProject();saveEvent(p,mockEvent(projectInput(p)));confirmEvent(p,{title:p.event.title,summary:p.event.summary});const options={host:'thoughtful',setting:'garden',tone:'warm'};saveVideo(p,mockVideo({...projectInput(p),event:p.event,options}),options);return p;}

const RATE=24000;
const sine=(hz,seconds=1,amp=0.04)=>{
 const n=Math.floor(RATE*seconds),out=new Float32Array(n);
 for(let i=0;i<n;i++)out[i]=amp*Math.sin(2*Math.PI*hz*i/RATE);
 return out;
};
const rmsAfter=(samples,skipSeconds=0.1)=>{
 const skip=Math.floor(RATE*skipSeconds);let sum=0,count=0;
 for(let i=skip;i<samples.length;i++){sum+=samples[i]*samples[i];count++;}
 return Math.sqrt(sum/Math.max(1,count));
};
const peak=samples=>samples.reduce((n,v)=>Math.max(n,Math.abs(v)),0);

test('telephone spec pins the vintage band and gentle dynamics',()=>{
 assert.equal(TELEPHONE_SPEC.highpassHz,300);
 assert.equal(TELEPHONE_SPEC.lowpassHz,3400);
 assert.ok(TELEPHONE_SPEC.compRatio<=4&&TELEPHONE_SPEC.saturationDrive<=2);
 assert.ok(TELEPHONE_SPEC.ceiling<=1);
});

test('reference DSP attenuates rumble and hiss while passing the voice band',()=>{
 const low=sine(100),mid=sine(1000),high=sine(8000);
 const rel=s=>rmsAfter(applyTelephoneEffect(s,RATE))/rmsAfter(s);
 const midRel=rel(mid);
 assert.ok(midRel>1.5&&midRel<2.5,`voice band roughly preserved, got ${midRel}`);
 assert.ok(rel(low)/midRel<0.25,`100 Hz stopped, got ${rel(low)/midRel}`);
 assert.ok(rel(high)/midRel<0.3,`8 kHz stopped, got ${rel(high)/midRel}`);
});

test('reference DSP never clips, silences, invents, or mutates audio',()=>{
 const mix=new Float32Array(RATE);
 const a=sine(300,1,0.5),b=sine(1200,1,0.4),c=sine(2900,1,0.3);
 for(let i=0;i<RATE;i++)mix[i]=a[i]+b[i]+c[i];
 const scale=0.99/peak(mix);
 for(let i=0;i<RATE;i++)mix[i]*=scale;
 const beforeHot=Float32Array.from(mix);
 const out=applyTelephoneEffect(mix,RATE);
 assert.deepEqual(mix,beforeHot);
 assert.ok(peak(out)<=1,`peaks bounded, got ${peak(out)}`);
 assert.ok(rmsAfter(out)>0.01,'loud input stays audible');
 for(const v of out)assert.ok(Number.isFinite(v),'no NaN or Infinity');
 const quiet=applyTelephoneEffect(sine(1000,0.5,0.001),RATE);
 assert.ok(rmsAfter(quiet,0.05)>0,'quiet input is not gated to silence');
 assert.deepEqual(applyTelephoneEffect(new Float32Array(RATE),RATE),new Float32Array(RATE));
 assert.deepEqual(applyTelephoneEffect(mix,RATE),applyTelephoneEffect(mix,RATE));
});

test('reference DSP rejects bad input and handles empties',()=>{
 assert.throws(()=>applyTelephoneEffect('nope',RATE));
 assert.throws(()=>applyTelephoneEffect(new Float32Array(10),4000));
 assert.throws(()=>applyTelephoneEffect(new Float32Array(10),NaN));
 assert.equal(applyTelephoneEffect(new Float32Array(0),RATE).length,0);
});

test('telephone WAV fixture round-trips through the effect without clipping',()=>{
 const n=Math.floor(RATE*0.5),mix=new Float32Array(n);
 const a=sine(440,0.5,0.3),b=sine(1200,0.5,0.2);
 for(let i=0;i<n;i++)mix[i]=a[i]+b[i];
 const wav=toWav([mix],RATE);
 const view=new DataView(wav),pcm=new Float32Array((wav.byteLength-44)/2);
 for(let i=0;i<pcm.length;i++)pcm[i]=view.getInt16(44+i*2,true)/32768;
 const out=applyTelephoneEffect(pcm,RATE);
 const rewav=toWav([out],RATE, RATE);
 const info=wavInfo(rewav);
 assert.equal(info.rate,RATE);
 const check=new DataView(rewav);let top=0;
 for(let i=0;i<pcm.length;i++)top=Math.max(top,Math.abs(check.getInt16(44+i*2,true)));
 assert.ok(top<=32767,`16-bit peaks bounded, got ${top}`);
});

test('waveshaper curve is a subtle odd-symmetric saturator',()=>{
 const curve=telephoneCurve();
 assert.ok(curve instanceof Float32Array);
 assert.equal(curve.length,1024);
 assert.ok(Math.abs(curve[512])<0.01);
 assert.ok(Math.abs(curve[0]+0.603)<0.01&&Math.abs(curve[1023]-0.603)<0.01);
 for(let i=1;i<curve.length;i++)assert.ok(curve[i]>=curve[i-1],'monotonic, no kinks');
});

function fakeContext(){
 const ctx={calls:[],currentTime:0,destination:{kind:'destination'}};
 const node=kind=>{
  const target={kind,connects:[],connect(n){this.connects.push(n?.kind||n);ctx.calls.push(`${kind}->${n?.kind||n}`);}};
  return new Proxy(target,{
   get(t,prop){
    if(prop in t)return t[prop];
    if(!(prop in t))t[prop]={value:0};
    return t[prop];
   },
   set(t,prop,value){t[prop]=value;return true;},
  });
 };
 ctx.createBiquadFilter=()=>node('biquad');
 ctx.createDynamicsCompressor=()=>node('comp');
 ctx.createWaveShaper=()=>node('shaper');
 ctx.createGain=()=>node('gain');
 ctx.nodes=[];
 const wrap=name=>{const f=ctx[name];ctx[name]=(...a)=>{const n=f(...a);ctx.nodes.push(n);return n;};};
 ['createBiquadFilter','createDynamicsCompressor','createWaveShaper','createGain'].forEach(wrap);
 ctx.createMediaElementSource=el=>{ctx.calls.push('capture');const n=node('source');n.element=el;ctx.nodes.push(n);return n;};
 return ctx;
}

test('native chain wires band-pass, gentle compression, saturation, makeup, limiter',()=>{
 const ctx=fakeContext();
 const chain=createTelephoneChain(ctx);
 const [high,low,comp,shaper,makeup,limiter]=ctx.nodes;
 assert.equal(high.type,'highpass');assert.equal(high.frequency.value,300);
 assert.equal(low.type,'lowpass');assert.equal(low.frequency.value,3400);
 assert.equal(comp.threshold.value,-20);assert.equal(comp.ratio.value,3);
 assert.ok(shaper.curve instanceof Float32Array);assert.equal(shaper.oversample,'2x');
 assert.ok(makeup.gain.value>1&&makeup.gain.value<3);
 assert.equal(limiter.threshold.value,-2);assert.ok(limiter.ratio.value>=12);
 assert.deepEqual(ctx.calls,['biquad->biquad','biquad->comp','comp->shaper','shaper->gain','gain->comp']);
 assert.equal(chain.input,high);assert.equal(chain.output,limiter);
 assert.throws(()=>createTelephoneChain({}),/cannot build/);
});

test('playback handle toggles dry/wet, captures once, and falls back to natural',()=>{
 const ctx=fakeContext(),element={tag:'audio'};
 const handle=attachTelephonePlayback(element,ctx);
 const dry=ctx.nodes.find(n=>n.kind==='gain'&&n.gain.value===1);
 assert.ok(dry,'natural starts on the dry path');
 assert.equal(handle.mode,'natural');
 assert.equal(handle.setMode('telephone'),'telephone');
 assert.equal(ctx.calls.filter(c=>c==='capture').length,1);
 handle.setMode('natural');assert.equal(handle.mode,'natural');
 assert.equal(attachTelephonePlayback(element,ctx),handle);
 assert.equal(ctx.calls.filter(c=>c==='capture').length,1,'no double capture');
 handle.setMode('telephone');handle.dispose();assert.equal(handle.mode,'natural');
 assert.throws(()=>attachTelephonePlayback({tag:'other'},{}),/cannot route/);
});

test('playback fades click-free when the context supports it',()=>{
 const ctx=fakeContext();
 const fades=[];
 const gain=()=>({gain:{value:0,setTargetAtTime:v=>fades.push(v)},connect(){}});
 ctx.createGain=gain;
 const handle=attachTelephonePlayback({tag:'audio2'},ctx);
 handle.setMode('telephone');
 assert.deepEqual(fades,[0,1]);
});

test('applyListenMode leaves natural playback alone and degrades honestly',()=>{
 const store=new Map();
 const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
 assert.equal(applyListenMode([{tag:'audio'}],storage),'natural');
 assert.equal(loadListenMode(storage),'natural');
 saveListenMode(storage,'telephone');
 assert.equal(applyListenMode([],storage),'telephone');
 assert.equal(applyListenMode([{tag:'audio'}],storage),'natural','no Web Audio here, so back to natural');
 assert.equal(loadListenMode(storage),'natural');
});

test('story playback offers natural/telephone listening with originals untouched',()=>{
 const html=storyAudioMarkup({recordings:[{id:'r1',question:'What happened that spring?',durationSec:12}]});
 assert.ok(html.includes('name="story-listen"')&&html.includes('value="telephone"'));
 assert.match(html,/originals stay untouched/i);
 assert.equal(storyAudioMarkup({recordings:[]}),'','no players without recordings');
});

test('film export offers telephone narration as an explicit unchecked option',()=>{
 const html=videoExportMarkup(readyFilm());
 assert.ok(html.includes('id="clip-telephone"'));
 assert.ok(!/id="clip-telephone"[^>]*checked/.test(html),'unchecked by default');
 assert.match(html,/this export only/i);
 assert.match(html,/recording stays original/i);
});

test('listening-mode preference round-trips with a natural default',()=>{
 const store=new Map();
 const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
 assert.equal(loadListenMode(storage),'natural');
 assert.equal(saveListenMode(storage,'telephone'),'telephone');
 assert.equal(loadListenMode(storage),'telephone');
 assert.equal(saveListenMode(storage,'bogus'),'natural');
 assert.equal(loadListenMode(null),'natural');
});
