import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,addAnswer,reviseAnswer,createStory,validProject} from '../web/domain.js';
import {WEEK_TIMEZONES,deviceTimeZone,validTimeZone,localDate,weekStartISO,weekRangeLabel,entryDateLabel,groupAnswersByWeek,captureWeeklyBinding,weeklyBindingFresh,acceptWeeklyStory,removeWeeklyStory,sourceVersionText,paragraphSources} from '../web/weekly.js';
import {witnessAI} from '../web/ai-client.js';
import {validateAIInput,validateAIResult,validateVerifyOutput,sourcesChanged} from '../web/ai-contracts.js';
import {runVerifiedEvent} from '../web/event-verify.js';
import {mockPeriodGenerate,mockVerifyNarrative} from '../web/mock-ai.js';

// Fictional entries spanning three weeks. All people, places, and events are
// invented; the fixed instants make week boundaries deterministic.
function weeklyProject(){
 const p=newProject('small-moment','Three weeks of small days');
 const entries=[
  ['2026-10-19T09:00:00Z','Rain on the windows all morning. I stayed in and read.'],
  ['2026-10-21T18:30:00Z','Soup for dinner with my sister. She laughed at my burnt toast.'],
  ['2026-10-26T08:15:00Z','A morning walk to the bakery before eight. The street was empty.'],
  ['2026-10-30T20:00:00Z','My grandmother hummed an old lullaby while the kettle rattled.'],
  ['2026-11-02T12:00:00Z','A concert in Leeds. At first I said 2018, but the ticket stub says 2019.'],
 ];
 for(const [iso,text]of entries){const a=addAnswer(p,text);a.createdAt=Date.parse(iso);}
 return p;
}
function weeklyInput(p,ids,weekStart='2026-10-19',timeZone='UTC'){
 return {title:p.title,weekStart,timeZone,answers:ids.map(id=>{const a=p.answers.find(a=>a.id===id);return {id:a.id,revision:a.revision,text:a.text,question:a.question};})};
}

test('weekly entries group by recording week, newest first',()=>{
 const p=weeklyProject();
 const g=groupAnswersByWeek(p.answers,'UTC');
 assert.deepEqual(g.weeks.map(([w])=>w),['2026-11-02','2026-10-26','2026-10-19']);
 assert.deepEqual(g.weeks.map(([,a])=>a.length),[1,2,2]);
 assert.deepEqual(g.weeks[2][1].map(a=>a.createdAt),[Date.parse('2026-10-19T09:00:00Z'),Date.parse('2026-10-21T18:30:00Z')]);
 assert.deepEqual(g.undated,[]);
 assert.equal(weekRangeLabel('2026-10-19'),'Oct 19 – Oct 25, 2026');
 assert.equal(entryDateLabel(Date.parse('2026-10-21T18:30:00Z'),'UTC'),'Wed, Oct 21');
});

test('week boundaries split Sunday from Monday within the chosen timezone',()=>{
 assert.equal(weekStartISO(Date.parse('2026-10-25T23:30:00Z'),'UTC'),'2026-10-19');
 assert.equal(weekStartISO(Date.parse('2026-10-26T00:30:00Z'),'UTC'),'2026-10-26');
 assert.equal(weekStartISO(Date.parse('2025-01-01T12:00:00Z'),'UTC'),'2024-12-30');
 // The same instant falls in different weeks on either side of the Atlantic.
 assert.equal(weekStartISO(Date.parse('2026-10-26T02:00:00Z'),'UTC'),'2026-10-26');
 assert.equal(weekStartISO(Date.parse('2026-10-26T02:00:00Z'),'America/New_York'),'2026-10-19');
 assert.equal(localDate(Date.parse('2026-10-26T02:00:00Z'),'America/New_York'),'2026-10-25');
});

test('historical event dates never affect week grouping',()=>{
 const p=newProject('small-moment');
 const a=addAnswer(p,'In 2019 my sister and I saw a band in Manchester. I still remember the walk home.');
 a.createdAt=Date.parse('2026-11-04T10:00:00Z');
 const g=groupAnswersByWeek(p.answers,'UTC');
 assert.deepEqual(g.weeks.map(([w])=>w),['2026-11-02']);
});

test('timezone choices are explicit and validated',()=>{
 assert.ok(WEEK_TIMEZONES.includes('UTC'));
 assert.ok(WEEK_TIMEZONES.length>=8);
 assert.equal(validTimeZone('Europe/Berlin'),true);
 assert.equal(validTimeZone('Not/AZone'),false);
 assert.equal(validTimeZone(''),false);
 assert.equal(validTimeZone(deviceTimeZone()),true);
});

test('empty selections are rejected with a clear error',()=>{
 const p=weeklyProject();
 assert.throws(()=>validateAIInput('period',{title:p.title,weekStart:'2026-10-19',timeZone:'UTC',answers:[]}),/answer/);
 assert.throws(()=>captureWeeklyBinding(p,'2026-10-19','UTC',[]),/at least one entry/);
 assert.throws(()=>captureWeeklyBinding(p,'2026-10-19','UTC',['missing']),/missing/);
 assert.deepEqual(groupAnswersByWeek([],'UTC'),{weeks:[],undated:[]});
 const q=newProject('person');addAnswer(q,'An old answer with no recording date.');
 delete q.answers[0].createdAt;
 const g=groupAnswersByWeek(q.answers,'UTC');
 assert.deepEqual(g.weeks,[]);
 assert.equal(g.undated.length,1);
});

test('a weekly draft verifies against its entries and invents nothing',async()=>{
 const p=weeklyProject();
 const ids=p.answers.slice(0,2).map(a=>a.id);
 const env=await witnessAI.period(weeklyInput(p,ids),{provider:'mock'});
 assert.equal(env.provider,'mock');
 assert.equal(env.verification.status,'verified');
 assert.equal(env.verification.attempts,1);
 assert.equal(env.result.rangeText,'Oct 19 – Oct 25, 2026');
 assert.ok(env.result.narrative.includes('Rain on the windows'));
 assert.ok(env.result.narrative.includes('burnt toast'));
 assert.deepEqual(env.result.sourceRefs.map(r=>r.answerId).sort(),ids.sort());
 for(const bad of ['2019','Manchester','Leeds','grandmother','bakery']){
  assert.equal(env.result.narrative.includes(bad),false,bad);
  assert.equal(env.result.title.includes(bad),false,bad);
 }
});

test('weekly repair removes an unsupported claim within the bounded loop',async()=>{
 const p=weeklyProject();
 const ids=p.answers.slice(2,4).map(a=>a.id);
 const input=weeklyInput(p,ids,'2026-10-26');
 const base=(await mockPeriodGenerate(input,null)).result;
 const badNarrative=base.narrative+' We met Jonathan Pryce after the show in 1999.';
 const badParas=badNarrative.split('\n\n');
 const bad={...base,narrative:badNarrative,paragraphRefs:base.paragraphRefs.map((e,i)=>i===base.paragraphRefs.length-1?{paragraph:badParas[badParas.length-1],sourceRefs:e.sourceRefs}:e)};
 const checked=mockVerifyNarrative(bad,p.answers.slice(2,4));
 assert.equal(checked.supported,false);
 const run=await runVerifiedEvent(input,{verifier:'mock',validate:(r,a)=>validateAIResult('period',r,a),
  generate:(inp,repair)=>repair?mockPeriodGenerate(inp,repair):Promise.resolve({provider:'mock',model:null,result:bad}),
  verify:async(cand,ans)=>mockVerifyNarrative(cand,ans)});
 assert.equal(run.status,'verified');
 assert.equal(run.attempts,2);
 assert.equal(run.event.narrative.includes('1999'),false);
 assert.equal(run.event.narrative.includes('Jonathan Pryce'),false);
 assert.ok(run.event.narrative.includes('bakery'));
});

test('a corrected source invalidates the proposal and preserves originals',()=>{
 const p=weeklyProject();createStory(p);
 const before=p.answers.map(a=>a.text).join('\n');
 const storyBefore=p.story.passages.map(s=>s.text).join('\n');
 const ids=p.answers.slice(0,2).map(a=>a.id);
 const binding=captureWeeklyBinding(p,'2026-10-19','UTC',ids);
 assert.equal(weeklyBindingFresh(p,binding),true);
 reviseAnswer(p,p.answers[0].id,'Rain on the windows all morning. I stayed in and wrote letters instead.');
 assert.equal(weeklyBindingFresh(p,binding),false);
 assert.equal(acceptWeeklyStory(p,{title:'Week',rangeText:'Oct 19 – Oct 25, 2026',narrative:'Rain on the windows all morning. I stayed in and read.',sourceRefs:binding.sourceRefs},binding),false);
 assert.equal(p.weekly,undefined);
 assert.equal(p.answers.map(a=>a.text).join('\n').includes('wrote letters'),true);
 assert.equal(p.story.passages.map(s=>s.text).join('\n'),storyBefore);
 assert.equal(p.answers.map(a=>a.text).join('\n')===before,false);
 const fresh=captureWeeklyBinding(p,'2026-10-19','UTC',ids);
 assert.equal(acceptWeeklyStory(p,{title:'Week',rangeText:'Oct 19 – Oct 25, 2026',narrative:'An accepted week.',sourceRefs:fresh.sourceRefs},fresh),true);
 reviseAnswer(p,p.answers[1].id,'Soup for dinner with my sister. She laughed at my burnt pie.');
 assert.equal(sourcesChanged(p.weekly[0].sourceRefs,p.answers),true);
 assert.equal(p.weekly[0].narrative,'An accepted week.');
});

test('an accepted weekly story keeps its week, sources, and edits',()=>{
 const p=weeklyProject();
 const ids=p.answers.slice(2,4).map(a=>a.id);
 const binding=captureWeeklyBinding(p,'2026-10-26','UTC',ids);
 assert.equal(acceptWeeklyStory(p,{title:'A quieter week, in my words',rangeText:'Oct 26 – Nov 1, 2026',narrative:'Bakery mornings and an old lullaby.',sourceRefs:binding.sourceRefs,provider:'mock',model:null},binding),true);
 const w=p.weekly[0];
 assert.equal(w.weekStart,'2026-10-26');assert.equal(w.timeZone,'UTC');
 assert.equal(w.title,'A quieter week, in my words');
 assert.equal(w.rangeText,'Oct 26 – Nov 1, 2026');
 assert.deepEqual(w.sourceRefs,binding.sourceRefs);
 assert.equal(validProject(JSON.parse(JSON.stringify(p))),true);
 assert.equal(removeWeeklyStory(p,'missing'),false);
 assert.equal(removeWeeklyStory(p,w.id),true);
 assert.equal(p.weekly.length,0);
 assert.equal(p.answers.length,5);
 assert.throws(()=>acceptWeeklyStory(p,{title:'Empty',rangeText:'x',narrative:'  ',sourceRefs:binding.sourceRefs},binding),/empty/);
});

test('cancellation during weekly generation aborts without verifying',async()=>{
 const p=weeklyProject();
 const input=weeklyInput(p,p.answers.slice(0,2).map(a=>a.id));
 const controller=new AbortController();
 let verCalls=0,gate;
 const run=runVerifiedEvent(input,{verifier:'mock',signal:controller.signal,validate:(r,a)=>validateAIResult('period',r,a),
  generate:()=>{gate=new Promise(res=>setTimeout(()=>res({provider:'mock',model:null,result:null}),10));controller.abort();return gate;},
  verify:async()=>{verCalls++;return {supported:true,issues:[]};}});
 await assert.rejects(run,e=>e.status===499&&/cancelled/.test(e.message));
 assert.equal(verCalls,0);
});

test('a hanging weekly generation times out',async()=>{
 const p=weeklyProject();
 const input=weeklyInput(p,p.answers.slice(0,2).map(a=>a.id));
 await assert.rejects(runVerifiedEvent(input,{verifier:'mock',deadlineMs:30,validate:(r,a)=>validateAIResult('period',r,a),
  generate:()=>new Promise(()=>{}),
  verify:async()=>({supported:true,issues:[]})}),e=>e.status===504);
});

test('changing the selection, week, or timezone invalidates the proposal',()=>{
 const p=weeklyProject();
 const ids=p.answers.slice(0,4).map(a=>a.id);
 const binding=captureWeeklyBinding(p,'2026-10-19','UTC',ids);
 const full={weekStart:'2026-10-19',timeZone:'UTC',selectedIds:ids};
 assert.equal(weeklyBindingFresh(p,binding,full),true);
 assert.equal(weeklyBindingFresh(p,binding,{...full,selectedIds:ids.slice(0,3)}),false);
 assert.equal(weeklyBindingFresh(p,binding,{...full,selectedIds:[...ids,p.answers[4].id]}),false);
 assert.equal(weeklyBindingFresh(p,binding,{...full,weekStart:'2026-10-26'}),false);
 assert.equal(weeklyBindingFresh(p,binding,{...full,timeZone:'Europe/Berlin'}),false);
 const story={title:'W',rangeText:'r',narrative:'A week of entries.',sourceRefs:binding.sourceRefs};
 assert.equal(acceptWeeklyStory(p,story,binding,full),true);
 assert.equal(p.weekly.length,1);
 assert.equal(acceptWeeklyStory(p,{...story,narrative:'Other words.'},binding,{...full,selectedIds:ids.slice(0,3)}),false);
 assert.equal(p.weekly.length,1);
 assert.equal(p.weekly[0].narrative,'A week of entries.');
});

test('weekly drafts carry paragraph-level source references',async()=>{
 const p=weeklyProject();
 const ids=p.answers.slice(0,2).map(a=>a.id);
 const answers=p.answers.slice(0,2);
 const env=await witnessAI.period(weeklyInput(p,ids),{provider:'mock'});
 const refs=env.result.paragraphRefs;
 assert.equal(refs.length,2);
 assert.equal(refs[0].paragraph,p.answers[0].text);
 assert.deepEqual(refs[0].sourceRefs,[{answerId:p.answers[0].id,revision:1}]);
 assert.throws(()=>validateAIResult('period',{...env.result,paragraphRefs:refs.slice(0,1)},answers),/own sources/);
 assert.throws(()=>validateAIResult('period',{...env.result,paragraphRefs:[{paragraph:'Not in the narrative.',sourceRefs:refs[0].sourceRefs}]},answers),/does not match/);
 assert.throws(()=>validateAIResult('period',{...env.result,paragraphRefs:[{paragraph:refs[0].paragraph,sourceRefs:[{answerId:'nope',revision:1}]}]},answers),/unknown or outdated/);
 const {paragraphRefs,...rest}=env.result;
 assert.throws(()=>validateAIResult('period',rest,answers),/paragraph sources/);
});

test('weekly sources resolve the exact cited revisions',()=>{
 const p=weeklyProject();
 const a=p.answers[0];
 assert.deepEqual(sourceVersionText(p,a.id,1),{text:a.text,question:a.question,revision:1,current:true});
 reviseAnswer(p,a.id,'Rain all morning. I stayed in and wrote letters.');
 assert.equal(sourceVersionText(p,a.id,1).text,'Rain on the windows all morning. I stayed in and read.');
 assert.equal(sourceVersionText(p,a.id,1).current,false);
 assert.equal(sourceVersionText(p,a.id,2).current,true);
 assert.equal(sourceVersionText(p,'missing',1),null);
 assert.equal(sourceVersionText(p,a.id,99),null);
});

test('identical weekly paragraphs keep their own source occurrences',()=>{
 const first={answerId:'first',revision:1},second={answerId:'second',revision:2};
 const story={narrative:'Rain again.\n\nRain again.',sourceRefs:[first,second],paragraphRefs:[{paragraph:'Rain again.',sourceRefs:[first]},{paragraph:'Rain again.',sourceRefs:[second]}]};
 assert.deepEqual(paragraphSources(story).map(p=>p.sourceRefs),[[first],[second]]);
 assert.equal(story.paragraphRefs.length,2);
});

test('legacy weekly stories without paragraph sources stay readable',()=>{
 const p=weeklyProject();
 p.weekly=[{id:'old',weekStart:'2026-10-19',timeZone:'UTC',title:'Old',rangeText:'r',narrative:'First paragraph.\n\nSecond paragraph.',sourceRefs:[{answerId:p.answers[0].id,revision:1}]}];
 const rows=paragraphSources(p.weekly[0]);
 assert.equal(rows.length,2);
 assert.deepEqual(rows[0].sourceRefs,p.weekly[0].sourceRefs);
 assert.deepEqual(rows[1].sourceRefs,p.weekly[0].sourceRefs);
 const withRefs={...p.weekly[0],paragraphRefs:[{paragraph:'First paragraph.',sourceRefs:[{answerId:p.answers[0].id,revision:1}]},{paragraph:'Second paragraph.',sourceRefs:[{answerId:p.answers[1].id,revision:1}]}]};
 assert.deepEqual(paragraphSources(withRefs)[1].sourceRefs,[{answerId:p.answers[1].id,revision:1}]);
 assert.equal(validProject(p),true);
 p.weekly[0].paragraphRefs='broken';
 assert.equal(validProject(p),false);
});

test('the week range is metadata and is never flagged',()=>{
 const p=weeklyProject();
 const answers=p.answers.slice(0,2).map(a=>({...a}));
 const candidate={title:'A damp week',rangeText:'Oct 19 – Oct 25, 2026',narrative:'Rain on the windows all morning. I stayed in and read.\n\nSoup for dinner with my sister.',sourceRefs:answers.map(a=>({answerId:a.id,revision:a.revision}))};
 assert.equal(mockVerifyNarrative(candidate,answers).supported,true);
 assert.throws(()=>validateVerifyOutput({supported:false,issues:[{field:'rangeText',statement:'Oct 19',answerRefs:candidate.sourceRefs,reason:'invented_fact'}]},candidate,answers),/could not be read/);
 const narrativeIssue={supported:false,issues:[{field:'narrative',statement:'Rain on the windows',answerRefs:candidate.sourceRefs,reason:'contradiction'}]};
 assert.equal(validateVerifyOutput(narrativeIssue,candidate,answers).supported,false);
});
