import test from 'node:test';
import assert from 'node:assert/strict';
import {connectEventsFor,eventCoordinates} from '../web/connect-events.js';
test('Connect uses confirmed current events and their own locations, preserving uncertain dates',()=>{
 const answers=[{id:'a',revision:1}],entry={id:'e',title:'My first job',summary:'Learning on a small-house construction site.',dateText:'around 2019',location:'Leeds, UK',confirmed:true,sourceRefs:[{answerId:'a',revision:1}]};
 const p={id:'p',location:'Vienna, Austria',answers,events:[entry,{...entry,id:'draft',confirmed:false},{...entry,id:'stale',sourceRefs:[{answerId:'a',revision:0}]}]};
 const events=connectEventsFor([p]);assert.equal(events.length,1);assert.equal(events[0].year,'around 2019');assert.equal(events[0].lon,-1.55);assert.equal(events[0].category,'house-building');assert.equal(events[0].private,true);
 assert.equal(connectEventsFor([{...p,events:[{...entry,location:null}]}])[0].lon,undefined);
});
test('only explicit recognised cities are mapped',()=>{
 assert.deepEqual(eventCoordinates('Gdańsk, Poland'),{lon:18.65,lat:54.35});
 assert.equal(eventCoordinates('near Leeds'),null);assert.equal(eventCoordinates(null),null);assert.equal(eventCoordinates('Somewhere I lived'),null);
});
