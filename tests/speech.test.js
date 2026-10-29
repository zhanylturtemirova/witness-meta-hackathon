import test from 'node:test';
import assert from 'node:assert/strict';
import {toWav,wavInfo} from '../web/audio.js';
import {handleSpeech,MAX_UPLOAD_BYTES} from '../server/transcribe.mjs';
const wav=()=>toWav([new Float32Array([0,.5,-.5,1,-1,0])],24000);
const env={META_TRANSCRIPTION_ENABLED:'true',MODEL_API_KEY:'test-key-not-real'};
const request=(body=wav(),options={})=>new Request('http://127.0.0.1:4173/api/transcribe?language=English',{method:'POST',headers:{'Content-Type':'audio/wav',Origin:'http://127.0.0.1:4173',...options.headers},body});
test('microphone PCM is converted to mono 24kHz 16-bit WAV with signed clipping',()=>{
 const data=toWav([new Float32Array([0,1.5,-2,.5])],24000);const view=new DataView(data);
 assert.deepEqual(wavInfo(data),{encoding:1,channels:1,rate:24000,byteRate:48000,block:2,bits:16,duration:4/24000});
 assert.equal(view.getInt16(46,true),32767);assert.equal(view.getInt16(48,true),-32768);
 const resampled=toWav([new Float32Array(48000)],48000);assert.equal(wavInfo(resampled).duration,1);
});
test('bad audio and oversized duration are rejected before any provider call',async()=>{
 assert.throws(()=>wavInfo(new ArrayBuffer(1)));const data=wav();new DataView(data).setUint16(22,2,true);assert.throws(()=>wavInfo(data),/mono/);
 let called=false;const res=await handleSpeech(request(new ArrayBuffer(10)),env,async()=>{called=true;});assert.equal(res.status,400);assert.equal(called,false);
 const large=await handleSpeech(request(wav(),{headers:{'Content-Length':String(MAX_UPLOAD_BYTES+1)}}),env,()=>{called=true;});assert.equal(large.status,413);assert.equal(called,false);
});
test('missing configuration and cross-origin requests never send audio',async()=>{
 const fetcher=()=>{throw Error('must not call provider');};
 const disabled=await handleSpeech(request(),{},fetcher);assert.equal(disabled.status,503);
 const foreign=await handleSpeech(request(wav(),{headers:{Origin:'https://another-site.test'}}),env,fetcher);assert.equal(foreign.status,403);
 const res=await handleSpeech(new Request('http://localhost/api/speech-status'),{});assert.equal((await res.json()).configured,false);
});
test('server sends the correct multipart settings and only returns transcript data',async()=>{
 const res=await handleSpeech(request(),env,async(url,options)=>{
  assert.equal(url,'https://api.meta.ai/v1/asr/transcribe');assert.equal(options.headers.Authorization,'Bearer test-key-not-real');
  assert.equal(options.body.get('audio').type,'audio/wav');assert.deepEqual(JSON.parse(await options.body.get('request').text()),{mode:'PUSH_TO_TALK',model:'muse-voice-transcribe-1.0',audioEncoding:'WAV',languageBias:['English']});
  return Response.json({transcript:'A fictional memory.',audioDurationMs:12});
 });
 assert.equal(res.status,200);assert.deepEqual(await res.json(),{transcript:'A fictional memory.',model:'muse-voice-transcribe-1.0'});
});
test('billing errors are actionable and malformed provider results do not become answers',async()=>{
 let res=await handleSpeech(request(),env,async()=>Response.json({secret:'do not relay this'}, {status:402}));assert.equal(res.status,402);const data=await res.json();assert.match(data.error,/billing/);assert.doesNotMatch(JSON.stringify(data),/secret/);
 res=await handleSpeech(request(),env,async()=>Response.json({transcript:''}));assert.equal(res.status,422);
 res=await handleSpeech(request(),env,async()=>Response.json({unexpected:'value'}));assert.equal(res.status,502);
});
