import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {INTERVIEW_FIXTURES,buildDemoProject} from '../web/demo-fixtures.js';
import {projectInput} from '../web/ai-client.js';
import {runMockTask,mockVerifyEvent,mockVerifyProse} from '../web/mock-ai.js';
import {validateAIResult} from '../web/ai-contracts.js';
import {runVerifiedEvent} from '../web/event-verify.js';
import {runMetaTask} from '../server/ai/meta.mjs';

// Mock results check the harness. Live results use the application's Muse roles
// and verifier; a model's own verdict is not an independent quality assessment.
export async function evaluateAgents(fixtures,{live=false,apiKey,maxCalls=48,timeoutMs=180000,fetcher=globalThis.fetch}={}){
 if(live&&!apiKey)throw Error('Live evaluation requires a server API key.');
 if(!Number.isInteger(maxCalls)||maxCalls<1||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('Set a positive call budget and timeout.');
 const started=Date.now(),controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(Error('Evaluation deadline reached.')),timeoutMs);
 const report={mode:live?'meta-live':'mock',model:live?'muse-spark-1.3':null,fictional:true,maxCalls,timeoutMs,calls:0,cases:[],limitations:['Mock output does not measure Muse quality.','A verifier verdict requires human review of fidelity and interview usefulness.']};
 const reserve=()=>{
  controller.signal.throwIfAborted();
  if(report.calls>=maxCalls)throw Error('Evaluation call budget reached.');
  report.calls++;
 };
 const boundedFetch=(url,options)=>{reserve();return fetcher(url,options);};
 const task=async(name,input,kind,options={})=>{
  controller.signal.throwIfAborted();
  if(live){
   if(report.calls>=maxCalls)throw Error('Evaluation call budget reached.');
   const signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;
   signal.throwIfAborted();
   let onAbort;
   const stopped=new Promise((_,reject)=>{onAbort=()=>reject(signal.reason||Error('Evaluation cancelled.'));signal.addEventListener('abort',onAbort,{once:true});});
   try{
    const result=await Promise.race([runMetaTask(name,input,{apiKey,fetcher:boundedFetch,signal,timeoutMs:Math.min(60000,options.timeoutMs||60000,timeoutMs-(Date.now()-started)),validateResult:false}),stopped]);
    signal.throwIfAborted();
    return result;
   }finally{signal.removeEventListener('abort',onAbort);}
  }
  reserve();
  if(name==='verify')return {provider:'mock',model:null,result:kind==='editor'?mockVerifyProse(input.candidate,input.answers):mockVerifyEvent(input.candidate,input.answers)};
  return runMockTask(name,input);
 };
 const draft=(name,input)=>runVerifiedEvent(input,{
  signal:controller.signal,deadlineMs:Math.min(120000,timeoutMs-(Date.now()-started)),verifier:live?'meta':'mock',
  validate:(result,answers)=>validateAIResult(name,result,answers),
  generate:(data,repair,options)=>task(name,repair?{...data,repair}:data,undefined,options),
  verify:async(candidate,answers,options)=>(await task('verify',{title:input.title,answers,candidate},name,options)).result,
 });
 try{
  for(const fixture of fixtures){
   const p=buildDemoProject(fixture),input=projectInput(p),before=JSON.stringify(input),caseStart=report.calls;
   const result={id:fixture.id,title:fixture.title,holdout:fixture.holdout,outputs:{},humanReview:{status:'required',expected:fixture.expected,prohibited:fixture.prohibited},status:'incomplete'};
   report.cases.push(result);
   try{
    const interview=await task('interview',input);
    result.outputs.interviewer=validateAIResult('interview',interview.result,input.answers);
    const archive=await task('archivist',input);
    result.outputs.archivist=validateAIResult('archivist',archive.result,input.answers);
    const event=await draft('event',input);
    result.outputs.event={status:event.status,draft:event.event,issues:event.issues,attempts:event.attempts};
    const editor=await draft('editor',{...input,passage:input.answers[0].text});
    result.outputs.editor={status:editor.status,draft:editor.event,issues:editor.issues,attempts:editor.attempts};
    if(JSON.stringify(input)!==before)throw Error('Source input changed during evaluation.');
    result.status=event.status==='verified'&&editor.status==='verified'?'ready_for_human_review':'unresolved';
   }catch(error){result.status='error';result.error=error.message;}
   result.calls=report.calls-caseStart;
   if(controller.signal.aborted||report.calls>=maxCalls)break;
  }
 }finally{clearTimeout(timer);}
 report.elapsedMs=Date.now()-started;
 report.completedCases=report.cases.length;
 report.requestedCases=fixtures.length;
 return report;
}

export function evaluationOptions(args){
 const {values}=parseArgs({args,options:{live:{type:'boolean'},'allow-paid-api':{type:'boolean'},case:{type:'string'},'max-calls':{type:'string'},'timeout-ms':{type:'string'},output:{type:'string'}}});
 if(values.live&&(!values['allow-paid-api']||!values['max-calls']))throw Error('Live mode requires --allow-paid-api and --max-calls.');
 if(values.live&&!values.case)throw Error('Live mode requires one explicit fictional --case.');
 const fixtures=values.case?INTERVIEW_FIXTURES.filter(f=>f.id===values.case):INTERVIEW_FIXTURES.filter(f=>!f.holdout);
 if(!fixtures.length)throw Error('Unknown fictional case.');
 const maxCalls=Number(values['max-calls']||(values.live?6:fixtures.length*8));
 const timeoutMs=Number(values['timeout-ms']||180000);
 if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>100||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000)throw Error('Use 1–100 calls and a timeout of 1–600000 milliseconds.');
 return {fixtures,live:!!values.live,maxCalls,timeoutMs,output:values.output||'exports/agent-evaluation.json'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const options=evaluationOptions(process.argv.slice(2));
  // The default mock run does not load .env or read API credentials.
  if(options.live)process.loadEnvFile('.env');
  const report=await evaluateAgents(options.fixtures,{...options,apiKey:options.live?process.env.MODEL_API_KEY:undefined});
  const destination=path.resolve(options.output);
  await mkdir(path.dirname(destination),{recursive:true});
  await writeFile(destination,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(`${report.mode}: ${report.completedCases}/${report.requestedCases} cases, ${report.calls}/${report.maxCalls} calls. Human review required. Report: ${destination}`);
  if(report.cases.some(c=>c.status==='error'||c.status==='unresolved')||report.completedCases<report.requestedCases)process.exitCode=1;
 }catch(error){console.error(error.message);process.exitCode=1;}
}
