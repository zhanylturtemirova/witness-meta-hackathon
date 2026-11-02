import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmCollectionEvent,eventContentSignature,entryStatus,saveEvent} from '../web/event-model.js';
const project=()=>({id:'p',answers:[{id:'a',revision:1,text:'Around 2019 in Leeds.'},{id:'b',revision:1,text:'Another memory'}],events:[{id:'e',revision:1,confirmed:false,title:'First job',summary:'I learned to read a level.',dateText:'around 2019',location:'Leeds',people:[],themes:[],detailsToConfirm:[],sourceRefs:[{answerId:'a',revision:1}]}]});
test('a narrator can confirm a collection event using only its own sources, without changing other answers',()=>{
 const p=project(),e=p.events[0],before=JSON.stringify(p.answers);
 const next=confirmCollectionEvent(p,e.id,{...e,title:'My first building job'},eventContentSignature(e));
 assert.equal(entryStatus(next,p.answers),'Confirmed');assert.equal(p.events.length,1);assert.equal(next.dateText,'around 2019');assert.equal(next.revision,2);assert.equal(JSON.stringify(p.answers),before);assert.equal(p.event,undefined);
});
test('stale sources and replaced events cannot be confirmed from an old open review',()=>{
 const p=project(),capture=eventContentSignature(p.events[0]);p.answers[0].revision=2;
 assert.throws(()=>confirmCollectionEvent(p,'e',p.events[0],capture),/Source answers changed/);
 assert.equal(p.events[0].confirmed,false);
 p.answers[0].revision=1;p.events[0].summary='A newer draft';
 assert.throws(()=>confirmCollectionEvent(p,'e',p.events[0],capture),/event changed/);
});
test('invalid edits do not replace the event; edits to the current event stay in sync',()=>{
 const p=project(),e=p.events[0],capture=eventContentSignature(e);p.event={...e};
 assert.throws(()=>confirmCollectionEvent(p,'e',{...e,title:''},capture),/incomplete/);assert.equal(p.events[0].confirmed,false);
 confirmCollectionEvent(p,'e',e,capture);assert.equal(p.event.confirmed,true);assert.deepEqual(p.event,p.events[0]);
});
test('a confirmed whole-conversation event becomes current without duplicating the collection',()=>{
 const p=project();p.answers=p.answers.slice(0,1);const entry=p.events[0];
 confirmCollectionEvent(p,entry.id,entry,eventContentSignature(entry));
 assert.equal(p.event.id,entry.id);assert.equal(p.events.length,1);
});
test('confirmed collection event passes through the actual storyboard contract',async()=>{
 const {witnessAI,projectInput}=await import('../web/ai-client.js');
 const p=project();p.title='Fictional first job';p.answers.push({id:'c',revision:1,text:'Ray showed me how to read a level, then watched while I checked the fence by myself.'});
 for(const a of p.answers){a.question='What do you remember?';a.text+=' I remember the first morning on the small house building site, carrying timber and watching the foreman work.';}
 p.events[0].sourceRefs=p.answers.map(a=>({answerId:a.id,revision:a.revision}));
 const e=p.events[0];confirmCollectionEvent(p,e.id,e,eventContentSignature(e));
 const options={host:'thoughtful',setting:'sunlit-studio',tone:'warm'};
 const plan=await witnessAI.video({...projectInput(p),event:p.event,options});
 assert.equal(plan.result.scenes.length,3);assert.equal(plan.result.scenes[0].narratorText,p.answers[0].text);
});

test('building the current event reuses a matching collection entry instead of adding a duplicate',()=>{
 const p=project(),e=p.events[0];e.sourceRefs=p.answers.map(a=>({answerId:a.id,revision:a.revision}));
 saveEvent(p,{...e,title:'A rebuilt event'});
 assert.equal(p.event.id,e.id);assert.equal(p.events.length,1);assert.equal(p.events[0].title,'A rebuilt event');
});
