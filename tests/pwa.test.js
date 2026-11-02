import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../web/sw.js',import.meta.url),'utf8');
function worker(){
 const listeners={},puts=[],deleted=[],store=new Map(),base='http://127.0.0.1:4282/';let claimed=false,activated=false;
 const cache={addAll:async urls=>urls.forEach(u=>store.set(u,{body:'public shell'})),match:async r=>store.get(typeof r==='string'?r:r.url),put:async(r,res)=>{puts.push(r.url);store.set(r.url,res);}};
 const context={URL,Response,Set,fetch:async()=>{throw Error('offline');},caches:{open:async()=>cache,keys:async()=>['other-app','witness-shell-old','witness-shell-test'],delete:async key=>deleted.push(key)},self:{location:{href:base+'sw.js'},addEventListener:(name,fn)=>listeners[name]=fn,clients:{claim:async()=>claimed=true},skipWaiting:()=>activated=true}};
 vm.runInNewContext(source.replace("/* WITNESS_BUILD */ {version:'development',files:[]}",JSON.stringify({version:'test',files:['./index.html','./app.js']})),context);
 return {listeners,puts,deleted,context,store,base,get claimed(){return claimed;},get activated(){return activated;}};
}
test('offline cache never intercepts API calls, private paths, POSTs, external files or signed queries',()=>{
 const w=worker();
 for(const path of ['api/ai/event','api/transcribe','exports/interview.json','private/audio.wav','app.js?token=private']){
  let intercepted=false;w.listeners.fetch({request:{method:'GET',url:w.base+path,mode:'cors'},respondWith:()=>intercepted=true});assert.equal(intercepted,false,path);
 }
 for(const request of [{method:'POST',url:w.base+'app.js'},{method:'GET',url:'https://other.test/app.js'},{method:'GET',url:w.base+'api/ai/event',mode:'navigate'}]){
  let intercepted=false;w.listeners.fetch({request,respondWith:()=>intercepted=true});assert.equal(intercepted,false);
 }
 assert.equal(w.puts.length,0);
});
test('installed shell can open the app offline; an update waits for an explicit activation message',async()=>{
 const w=worker();let done;w.listeners.install({waitUntil:p=>done=p});await done;assert.equal(w.activated,false);
 let response;w.listeners.fetch({request:{method:'GET',url:w.base,mode:'navigate'},respondWith:p=>response=p});assert.equal((await response).body,'public shell');
 w.listeners.message({data:{type:'unrelated'}});assert.equal(w.activated,false);
 w.listeners.message({data:{type:'WITNESS_ACTIVATE'}});assert.equal(w.activated,true);
 w.listeners.activate({waitUntil:p=>done=p});await done;
 assert.deepEqual(w.deleted,['witness-shell-old']);assert.equal(w.claimed,true);
});
test('Earth maps cache on demand, while arbitrary media never does',async()=>{
 const w=worker();w.context.fetch=async()=>({ok:true,type:'basic',clone(){return this;}});
 let response;w.listeners.fetch({request:{method:'GET',url:w.base+'assets/earth/earth-day.jpg',mode:'cors'},respondWith:p=>response=p});await response;
 assert.deepEqual(w.puts,[w.base+'assets/earth/earth-day.jpg']);
});
