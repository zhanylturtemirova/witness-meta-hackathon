import test from 'node:test';
import assert from 'node:assert/strict';
import {MY_EVENTS,SHARED_STORIES,matchesFor,projectPoint,greatCircle} from '../web/connect-data.js';
test('matching changes with the selected event and excludes unshared stories',()=>{
 const moving=matchesFor(MY_EVENTS.find(e=>e.id==='moving'));assert.equal(moving.length,4);assert.ok(moving.every(s=>s.category==='moving-abroad'));assert.ok(!moving.some(s=>s.id==='private-example'));
 const concert=matchesFor(MY_EVENTS.find(e=>e.id==='concert'));assert.equal(concert.length,3);assert.ok(concert.every(s=>s.category==='first-concert'));assert.ok(!concert.some(s=>moving.some(x=>x.id===s.id)));
 assert.equal(matchesFor(MY_EVENTS.find(e=>e.id==='pottery')).length,0);
});
test('globe projection hides the opposite side and places a focused point at the centre',()=>{
 const front=projectPoint(16,48,16,48,200);assert.ok(Math.abs(front.x)<1e-10);assert.ok(Math.abs(front.y)<1e-10);assert.ok(front.z>.999);
 assert.ok(projectPoint(196,-48,16,48).z<0);
});
test('connection arcs follow the sphere with correct end points, including an antipodal pair',()=>{
 const from={lon:16.37,lat:48.21},to={lon:-79.38,lat:43.65};for(const [t,p]of[[0,from],[1,to]]){const result=greatCircle(from,to,t);assert.ok(Math.abs(result.lon-p.lon)<1e-8);assert.ok(Math.abs(result.lat-p.lat)<1e-8);}
 for(const t of[0,.25,.5,.75,1]){const point=greatCircle({lon:0,lat:0},{lon:180,lat:0},t);assert.ok(Number.isFinite(point.lon)&&Number.isFinite(point.lat));}
});
test('every displayed shared story has valid coordinates and a readable fictional story',()=>{
 const ids=new Set();for(const s of SHARED_STORIES){assert.ok(!ids.has(s.id));ids.add(s.id);assert.ok(s.lon>=-180&&s.lon<=180&&s.lat>=-90&&s.lat<=90);if(s.shared){assert.ok(s.story.length>50);assert.ok(s.reason);}}
});
