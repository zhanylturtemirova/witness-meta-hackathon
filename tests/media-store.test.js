import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaSave,mediaLoad,mediaDelete,mediaStatus,MEDIA_RECORDINGS,MEDIA_IMAGES} from '../web/media-store.js';
test('media store round-trips bytes and reports persistence explicitly',async()=>{
 const blob=new Blob([new Uint8Array([1,2,3,4])],{type:'audio/wav'});
 const saved=await mediaSave(MEDIA_RECORDINGS,{id:'r1',projectId:'p1',blob});
 assert.equal(typeof saved.persistent,'boolean');
 const back=await mediaLoad(MEDIA_RECORDINGS,'r1');
 assert.ok(back);assert.equal(back.id,'r1');assert.equal(back.projectId,'p1');
 assert.deepEqual(new Uint8Array(await back.blob.arrayBuffer()),new Uint8Array([1,2,3,4]));
 assert.equal(await mediaLoad(MEDIA_RECORDINGS,'missing'),null);
 await mediaDelete(MEDIA_RECORDINGS,'r1');
 assert.equal(await mediaLoad(MEDIA_RECORDINGS,'r1'),null);
 assert.equal(typeof mediaStatus().persistent,'boolean');
});
test('recordings and images use separate namespaces',async()=>{
 await mediaSave(MEDIA_RECORDINGS,{id:'same',projectId:'p',blob:new Blob(['a'])});
 await mediaSave(MEDIA_IMAGES,{id:'same',projectId:'p',blob:new Blob(['b'])});
 assert.equal(await (await mediaLoad(MEDIA_RECORDINGS,'same')).blob.text(),'a');
 assert.equal(await (await mediaLoad(MEDIA_IMAGES,'same')).blob.text(),'b');
 await mediaDelete(MEDIA_RECORDINGS,'same');await mediaDelete(MEDIA_IMAGES,'same');
 assert.equal(await mediaLoad(MEDIA_IMAGES,'same'),null);
});
