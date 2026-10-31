import test from 'node:test';
import assert from 'node:assert/strict';
import {exampleProject,reviseAnswer} from '../web/domain.js';
import {mockEvent,mockVideo} from '../web/mock-ai.js';
import {projectInput} from '../web/ai-client.js';
import {saveEvent,confirmEvent,saveVideo} from '../web/event-model.js';
import {videoCards,splitVideoText,recordingType,filmCards,filmFrame} from '../web/video-export.js';
function ready(){const p=exampleProject();saveEvent(p,mockEvent(projectInput(p)));confirmEvent(p,{title:p.event.title,summary:p.event.summary});const options={host:'thoughtful',setting:'garden',tone:'warm'};saveVideo(p,mockVideo({...projectInput(p),event:p.event,options}),options);return p;}
test('video cards preserve the complete reviewed questions and narrator wording',()=>{
 const p=ready(),cards=videoCards(p,3);assert.equal(cards[0].text,p.video.title);
 for(const scene of p.video.scenes){const sourceId=scene.sourceRefs[0].answerId;const sceneCards=cards.filter(c=>c.sourceRefs?.[0].answerId===sourceId);assert.equal(sceneCards.filter(c=>c.role==='host').map(c=>c.text).join(' '),scene.hostQuestion);assert.equal(sceneCards.filter(c=>c.role==='narrator').map(c=>c.text).join(' '),scene.narratorText);}
 assert.ok(cards.every(c=>c.seconds===3&&c.text.length<=190));
});
test('stale or unconfirmed sources cannot be exported as a current video',()=>{const p=ready();reviseAnswer(p,p.answers[0].id,'A corrected memory.');assert.throws(()=>videoCards(p),/current storyboard/);});
test('pagination handles blank text and very long words without dropping characters',()=>{assert.deepEqual(splitVideoText('   '),[]);const text='x'.repeat(450);assert.equal(splitVideoText(text).join(''),text);assert.ok(splitVideoText(text).every(p=>p.length<=190));});
test('video export enforces supported pace, duration, and actual media container',()=>{const p=ready();assert.throws(()=>videoCards(p,1),/pace/);p.video.scenes.push(...Array.from({length:70},()=>p.video.scenes[0]));assert.throws(()=>videoCards(p,8),/three-minute/);assert.equal(recordingType(t=>t==='video/mp4'),'video/mp4');assert.equal(recordingType(()=>false),null);});

test('illustrated film preserves narrator words, uses scene indices, and advances on card timing',()=>{const p=ready(),cards=filmCards(p,5);assert.equal(cards[0].seconds,3);assert.equal(filmFrame(cards,3).index,1);for(let i=0;i<p.video.scenes.length;i++){assert.equal(cards.filter(c=>c.scene===i&&c.role==='narrator').map(c=>c.text).join(' '),p.video.scenes[i].narratorText);}assert.equal(filmFrame(cards,10000).index,cards.length-1);});

test('MP4 is preferred for playback compatibility when both containers can be recorded',()=>{assert.equal(recordingType(()=>true),'video/mp4;codecs=avc1.42E01E,mp4a.40.2');assert.equal(recordingType(t=>['video/webm','video/mp4'].includes(t)),'video/mp4');assert.equal(recordingType(t=>t==='video/webm'),'video/webm');});
