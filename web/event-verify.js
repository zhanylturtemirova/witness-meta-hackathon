import {validateAIResult,validateVerifyOutput} from './ai-contracts.js';
// Bounded event verification loop: at most two candidates and two verifier calls.
// Transport errors abort immediately and never trigger regeneration. Only a candidate
// the verifier marks supported is accepted; reaching the attempt limit accepts nothing.
export const VERIFY_MAX_ATTEMPTS=2;
export const VERIFY_DEADLINE_MS=120000;
export function verifyTimeoutError(){
 const err=Error('Verification took too long. Your answers are still saved; you can retry.');
 err.status=504;return err;
}
function validCandidate(result,answers){
 try{return validateAIResult('event',result,answers);}catch{return null;}
}
function checkedVerifyOutput(output,candidate,answers){
 try{return validateVerifyOutput(output,candidate,answers);}
 catch(err){err.status=err.status||502;throw err;}
}
export async function runVerifiedEvent(input,{generate,verify,now=()=>Date.now(),deadlineMs=VERIFY_DEADLINE_MS,maxAttempts=VERIFY_MAX_ATTEMPTS,verifier='mock'}={}){
 const start=now();
 let genCalls=0,verCalls=0;
 const budget=()=>{const left=deadlineMs-(now()-start);if(!(left>0))throw verifyTimeoutError();return left;};
 const callWithinBudget=async(call)=>{
  const timeoutMs=Math.min(60000,budget()),controller=new AbortController();
  let timer;
  const expiry=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(verifyTimeoutError());},timeoutMs);});
  try{
   const result=await Promise.race([Promise.resolve().then(()=>call({timeoutMs,signal:controller.signal})),expiry]);
   budget(); // A late final verdict must never be accepted.
   return result;
  }finally{clearTimeout(timer);}
 };
 const checkedGenerate=async(repair)=>{
  if(genCalls>=maxAttempts)throw Error('The attempt limit was reached. Your answers are still saved.');
  genCalls++;
  return callWithinBudget(opts=>generate(input,repair,opts));
 };
 const checkedVerify=async(candidate)=>{
  if(verCalls>=maxAttempts)throw Error('The attempt limit was reached. Your answers are still saved.');
  verCalls++;
  return callWithinBudget(opts=>verify(candidate,input.answers,opts));
 };
 let rejected=null,lastIssues=[];
 let gen=await checkedGenerate(null);
 let current=validCandidate(gen.result,input.answers);
 if(current){
  const checked=checkedVerifyOutput(await checkedVerify(current),current,input.answers);
  if(checked.supported)return {status:'verified',event:current,issues:[],attempts:genCalls,provider:gen.provider,model:gen.model,verifier};
  lastIssues=checked.issues;rejected={candidate:current,issues:lastIssues};
 }
 const repair=current?{candidate:current,issues:lastIssues}:null;
 gen=await checkedGenerate(repair);
 current=validCandidate(gen.result,input.answers);
 if(!current)return {status:'unresolved',event:null,issues:lastIssues,rejected,attempts:genCalls,provider:gen.provider,model:gen.model,verifier};
 const rechecked=checkedVerifyOutput(await checkedVerify(current),current,input.answers);
 if(rechecked.supported)return {status:'verified',event:current,issues:[],attempts:genCalls,provider:gen.provider,model:gen.model,verifier};
 return {status:'unresolved',event:null,issues:rechecked.issues,rejected:{candidate:current,issues:rechecked.issues},attempts:genCalls,provider:gen.provider,model:gen.model,verifier};
}
export function verifiedEventEnvelope(run){
 return {provider:run.provider,model:run.model,result:run.event,rejected:run.rejected||null,verification:{status:run.status,issues:run.issues,attempts:run.attempts,verifier:run.verifier}};
}
