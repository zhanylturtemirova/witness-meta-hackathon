// Persistent browser media (voice recordings, scene images). Small metadata lives on
// the project in local storage; audio and image bytes live here, keyed by id.
// Falls back to session memory when IndexedDB is unavailable, and reports that
// visibly through mediaStatus() so the UI can warn instead of silently losing media.
const DB_NAME='witness-media-v1';
export const MEDIA_RECORDINGS='recordings';
export const MEDIA_IMAGES='images';
export const MEDIA_FILMS='films';
const DB_VERSION=2;
const MEDIA_STORES=[MEDIA_RECORDINGS,MEDIA_IMAGES,MEDIA_FILMS];
let dbPromise=null;
const memory=new Map();
let lastStatus={persistent:null,error:''};
export function mediaStatus(){return {...lastStatus};}
const slot=(store,id)=>store+'\n'+id;
function openDatabase(){
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(Error('unavailable'));return;}
  const request=indexedDB.open(DB_NAME,DB_VERSION);
  request.onupgradeneeded=()=>{const db=request.result;for(const store of MEDIA_STORES)if(!db.objectStoreNames.contains(store))db.createObjectStore(store,{keyPath:'id'});};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||Error('unavailable'));
  request.onblocked=()=>reject(Error('blocked'));
 }).catch(err=>{dbPromise=null;throw err;});
 return dbPromise;
}
function txDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||Error('failed'));tx.onabort=()=>reject(tx.error||Error('aborted'));});}
async function idbPut(store,record){
 const db=await openDatabase(),tx=db.transaction(store,'readwrite');
 tx.objectStore(store).put(record);await txDone(tx);
}
async function idbGet(store,id){
 const db=await openDatabase();
 return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),rq=tx.objectStore(store).get(id);rq.onsuccess=()=>resolve(rq.result||null);rq.onerror=()=>reject(rq.error||Error('failed'));});
}
async function idbDelete(store,id){
 const db=await openDatabase();
 const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(id);await txDone(tx);
}
export async function mediaSave(store,record){
 try{await idbPut(store,record);memory.delete(slot(store,record.id));lastStatus={persistent:true,error:''};return {persistent:true};}
 catch{memory.set(slot(store,record.id),record);lastStatus={persistent:false,error:'Media storage is unavailable in this browser. This file is kept for this session only.'};return {persistent:false,error:lastStatus.error};}
}
export async function mediaLoad(store,id){
 if(memory.has(slot(store,id)))return memory.get(slot(store,id));
 try{return await idbGet(store,id);}catch{return memory.get(slot(store,id))||null;}
}
export async function mediaDelete(store,id){
 memory.delete(slot(store,id));
 try{await idbDelete(store,id);}catch{}
}
