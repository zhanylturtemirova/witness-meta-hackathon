import test from 'node:test';
import assert from 'node:assert/strict';
import {createQuestionSpeech,PREVIEW_TEXT} from '../web/question-speech.js';

function fixture(saved){
 const local={voiceURI:'local-en',name:'English device voice',lang:'en-US',localService:true,default:true};
 const remote={voiceURI:'remote',lang:'en-US',localService:false};
 const other={voiceURI:'local-fr',lang:'fr-FR',localService:true};
 const calls=[],values=new Map(saved?[['witness.question-speech.v1',JSON.stringify(saved)]]:[]);
 let available=[remote,other,local],cancels=0;
 const synth={getVoices:()=>available,speak:value=>calls.push(value),cancel:()=>cancels++};
 class Utterance{constructor(text){this.text=text;}}
 const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 const speech=createQuestionSpeech({synth,Utterance,storage});
 const target={key:'story-1:q1',text:'What do you remember about that morning?'};
 return {speech,calls,values,local,target,setVoices:value=>{available=value;},get cancels(){return cancels;}};
}

test('read-aloud is opt-in, uses an installed English voice, and persists preferences only',()=>{
 const f=fixture();f.speech.setTarget(f.target);
 assert.equal(f.speech.read(),false);assert.equal(f.calls.length,0);
 f.speech.configure({enabled:true,rate:0.9});f.speech.read();
 assert.equal(f.calls[0].text,f.target.text);assert.equal(f.calls[0].voice,f.local);assert.equal(f.calls[0].rate,0.9);
 const saved=JSON.parse(f.values.get('witness.question-speech.v1'));
 assert.deepEqual(saved,{enabled:true,voiceURI:'',voiceName:'',rate:0.9});
 assert.equal(JSON.stringify(saved).includes(f.target.text),false);
});

test('a saved enabled preference stays silent after reload until the user starts speech',()=>{
 const f=fixture({enabled:true,voiceURI:'gone',rate:99});
 f.speech.setTarget(f.target);f.speech.setTarget({...f.target,key:'story-1:q2'});
 assert.equal(f.calls.length,0);assert.equal(f.speech.snapshot().rate,1);
 f.speech.read();assert.equal(f.calls[0].voice,f.local);
});

test('waits for a ready follow-up, does not repeat it on redraw, and cancels on leaving',()=>{
 const f=fixture();f.speech.setTarget(f.target);f.speech.configure({enabled:true});f.speech.read();
 f.speech.setTarget(null);f.speech.setTarget(f.target);assert.equal(f.calls.length,1);
 const next={key:'story-1:q2',text:'Who was there?',pending:true};
 f.speech.setTarget(next);assert.equal(f.calls.length,1);
 f.speech.setTarget({...next,pending:false});assert.equal(f.calls.length,2);
 f.speech.setTarget({...next,pending:false});assert.equal(f.calls.length,2);
 const ended=f.calls[1].onend;
 f.speech.setTarget(null);assert.equal(f.speech.snapshot().speaking,false);
 ended();assert.equal(f.speech.snapshot().speaking,false);
 assert.ok(f.cancels>=2);
});

test('recording and playback can block speech without queuing it for later',()=>{
 const f=fixture();let recording=false;
 f.speech.setTarget({...f.target,canSpeak:()=>!recording});f.speech.configure({enabled:true});f.speech.read();
 const cancelled=f.calls[0].onerror;
 recording=true;f.speech.stop();assert.equal(f.speech.read(),false);assert.equal(f.calls.length,1);
 cancelled();assert.equal(f.speech.snapshot().message,'');
 recording=false;f.speech.refresh();assert.equal(f.calls.length,1);
 f.speech.read();assert.equal(f.calls.length,2);
 f.speech.configure({enabled:false});assert.equal(f.speech.snapshot().speaking,false);
 f.speech.setTarget({...f.target,key:'story-1:q2'});assert.equal(f.calls.length,2);
});

test('handles voices arriving late, unavailable speech, and blocked browser playback',()=>{
 const f=fixture();f.setVoices([]);f.speech.setTarget(f.target);f.speech.configure({enabled:true});
 assert.equal(f.speech.read(),false);assert.match(f.speech.snapshot().message,/No installed English/);
 f.setVoices([f.local]);f.speech.refresh();assert.equal(f.calls.length,0);
 f.speech.read();f.calls[0].onerror();assert.match(f.speech.snapshot().message,/Read again/);
 f.speech.read();assert.equal(f.calls.length,2);
 const unavailable=createQuestionSpeech();unavailable.setTarget(f.target);
 assert.equal(unavailable.snapshot().supported,false);assert.equal(unavailable.read(),false);
});

test('novelty voices stay out of the main list but remain choosable',()=>{
 const f=fixture();
 const bells={voiceURI:'bells',name:'Bells',lang:'en-US',localService:true};
 const boing={voiceURI:'boing',name:'Boing',lang:'en-US',localService:true};
 const bubbles={voiceURI:'bubbles',name:'Bubbles',lang:'en-US',localService:true};
 f.setVoices([f.local,bells,boing,bubbles]);
 const snap=f.speech.snapshot();
 assert.deepEqual(snap.voices,[f.local]);
 assert.deepEqual(snap.otherVoices,[bells,boing,bubbles]);
 f.speech.setTarget(f.target);f.speech.configure({enabled:true,voiceURI:'bells'});
 f.speech.read();assert.equal(f.calls[0].voice,bells);
});

test('preview speaks a fixed sample without changing saved voice or speed',()=>{
 const f=fixture();f.speech.setTarget(f.target);
 f.speech.configure({enabled:true,rate:1.1});
 assert.equal(f.speech.preview('local-en'),true);
 assert.equal(f.calls[0].text,PREVIEW_TEXT);
 assert.equal(f.calls[0].voice,f.local);assert.equal(f.calls[0].rate,1.1);
 assert.equal(f.speech.snapshot().previewing,true);
 assert.deepEqual(JSON.parse(f.values.get('witness.question-speech.v1')),{enabled:true,voiceURI:'',voiceName:'',rate:1.1});
 f.calls[0].onend();assert.equal(f.speech.snapshot().previewing,false);
 assert.equal(f.speech.snapshot().speaking,false);
 f.speech.preview('unknown-voice');assert.equal(f.calls[1].voice,f.local);
 const unavailable=createQuestionSpeech();
 assert.equal(unavailable.preview('local-en'),false);
});

test('stop interrupts a preview like any other speech',()=>{
 const f=fixture();f.speech.setTarget(f.target);f.speech.configure({enabled:true});
 f.speech.preview('local-en');assert.equal(f.speech.snapshot().speaking,true);
 f.speech.stop();
 assert.equal(f.speech.snapshot().speaking,false);
 assert.equal(f.speech.snapshot().previewing,false);
 assert.ok(f.cancels>=1);
});

test('a saved voice that vanished is explained with the fallback on offer',()=>{
 const f=fixture({enabled:true,voiceURI:'gone',voiceName:'Old Voice',rate:1});
 f.speech.setTarget(f.target);
 const notice=f.speech.snapshot().notice;
 assert.match(notice,/Old Voice/);assert.match(notice,/not available/);
 assert.match(notice,/English device voice/);
 f.speech.read();assert.equal(f.calls[0].voice,f.local);
 f.speech.configure({voiceURI:'local-en'});
 assert.equal(f.speech.snapshot().notice,'');
 assert.equal(f.speech.snapshot().voiceName,'English device voice');
});

test('unavailable preference storage never prevents reading',()=>{
 const f=fixture();const storage={getItem(){throw Error('blocked');},setItem(){throw Error('full');}};
 const speech=createQuestionSpeech({synth:{getVoices:()=>[f.local],speak:value=>f.calls.push(value),cancel(){}},Utterance:class{constructor(text){this.text=text;}},storage});
 speech.setTarget(f.target);speech.configure({enabled:true});
 assert.match(speech.snapshot().message,/could not be saved/);
 speech.read();assert.equal(f.calls.length,1);
});
