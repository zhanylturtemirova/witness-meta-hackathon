// Archivist extraction orchestration: one grouping call, then one verified
// event draft per group. A shared deadline and call budget cover grouping,
// drafting, verification, and repairs together, including in-flight calls:
// each transport receives the remaining time and a cancellation signal, hung
// calls are abandoned at the deadline, and a stop observed mid-flight aborts
// the current call. Processing never starts another call after cancellation,
// source changes, or budget exhaustion. Partial completion is reported
// honestly: completed drafts plus completed/total counts and the stop reason.
// Results that arrive after the deadline are discarded, never labelled
// completed. Callers decide what to keep: cancelled and stale runs keep
// nothing, while timeout and budget stops may keep completed drafts.
export const ARCHIVIST_DEADLINE_MS=120000;
export const ARCHIVIST_MAX_GROUPS=4;
// One grouping call plus up to four drafts of at most two generations and
// two verifier calls each: 1 + 4 * (2 + 2).
export const ARCHIVIST_MAX_CALLS=17;
const DRAFT_MIN_CALLS=2;
const STOP_POLL_MS=25;
export async function runArchivist(input,{listGroups,draftEvent,now=()=>Date.now(),deadlineMs=ARCHIVIST_DEADLINE_MS,maxCalls=ARCHIVIST_MAX_CALLS,maxGroups=ARCHIVIST_MAX_GROUPS,shouldStop=()=>null}={}){
 if(typeof listGroups!=='function'||typeof draftEvent!=='function')throw Error('Archivist extraction needs its transports.');
 const start=now();
 let calls=0;
 const remaining=()=>deadlineMs-(now()-start);
 const expired=()=>!(remaining()>0);
 const stopBeforeNext=()=>shouldStop()||(expired()?'timeout':null);
 const partial=(drafts,totalGroups,stopped)=>({drafts,completedGroups:drafts.length,totalGroups,stopped,partial:stopped!==null||drafts.length<totalGroups,calls});
 const draftCalls=value=>{
  const attempts=value?.verification?.attempts??value?.attempts;
  return (Number.isInteger(attempts)&&attempts>=1&&attempts<=2?attempts:2)*2;
 };
 const callWithinBudget=async call=>{
  const timeoutMs=remaining();
  if(!(timeoutMs>0))return {status:'stopped',reason:'timeout'};
  const controller=new AbortController();
  let timer,poller;
  try{
   return await Promise.race([
    Promise.resolve().then(()=>call({timeoutMs,signal:controller.signal})).then(value=>({status:'ok',value})),
    new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({status:'stopped',reason:'timeout'});},timeoutMs);}),
    new Promise(resolve=>{poller=setInterval(()=>{const reason=shouldStop();if(reason){controller.abort();resolve({status:'stopped',reason});}},STOP_POLL_MS);}),
   ]);
  }finally{clearTimeout(timer);clearInterval(poller);}
 };
 let reason=stopBeforeNext();
 if(reason)return partial([],0,reason);
 if(calls+1>maxCalls)return partial([],0,'budget');
 const grouped=await callWithinBudget(opts=>listGroups(input,opts));
 if(grouped.status==='stopped')return partial([],0,grouped.reason);
 if(expired())return partial([],0,'timeout');
 calls+=1;
 const groups=grouped.value.slice(0,maxGroups);
 const drafts=[];
 for(const group of groups){
  reason=stopBeforeNext();
  if(reason)return partial(drafts,groups.length,reason);
  if(calls+DRAFT_MIN_CALLS>maxCalls)return partial(drafts,groups.length,'budget');
  const subset={title:input.title,answers:input.answers.filter(a=>group.answerRefs.some(r=>r.answerId===a.id))};
  const drafted=await callWithinBudget(opts=>draftEvent(subset,group,opts));
  if(drafted.status==='stopped')return partial(drafts,groups.length,drafted.reason);
  // Each attempt is one generation plus up to one verifier call. Count the
  // spent budget even when the result arrives too late to keep.
  calls+=draftCalls(drafted.value);
  if(expired())return partial(drafts,groups.length,'timeout');
  drafts.push({group,envelope:drafted.value});
 }
 return partial(drafts,groups.length,null);
}
