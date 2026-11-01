import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateAgents,evaluationOptions} from '../scripts/evaluate-agents.mjs';
import {fixtureById} from '../web/demo-fixtures.js';

test('agent evaluation defaults to mocks and excludes held-out cases',()=>{
 const options=evaluationOptions([]);
 assert.equal(options.live,false);
 assert.equal(options.fixtures.length,8);
 assert.ok(options.fixtures.every(f=>!f.holdout));
 assert.throws(()=>evaluationOptions(['--live']),/allow-paid-api/);
 assert.throws(()=>evaluationOptions(['--live','--allow-paid-api','--max-calls','6']),/explicit fictional/);
 assert.throws(()=>evaluationOptions(['--case','missing']),/Unknown/);
});

test('mock evaluation exercises all four roles without network and preserves sources',async()=>{
 let networkCalls=0;
 const report=await evaluateAgents([fixtureById('FW-01')],{maxCalls:6,fetcher:async()=>{networkCalls++;throw Error('must not use network');}});
 assert.equal(networkCalls,0);
 assert.equal(report.mode,'mock');
 assert.equal(report.calls,6);
 assert.equal(report.cases[0].status,'ready_for_human_review');
 assert.equal(report.cases[0].humanReview.status,'required');
 assert.ok(report.cases[0].outputs.interviewer.question);
 assert.ok(report.cases[0].outputs.archivist.groups.length);
 assert.equal(report.cases[0].outputs.event.status,'verified');
 assert.equal(report.cases[0].outputs.editor.status,'verified');
});

test('live evaluation cannot exceed its actual upstream call budget',async()=>{
 let calls=0;
 const report=await evaluateAgents([fixtureById('FW-01')],{live:true,apiKey:'fictional-key',maxCalls:1,fetcher:async(_url,options)=>{
  calls++;
  const input=JSON.parse(JSON.parse(options.body).messages[1].content);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({question:'What do you remember about carrying timber?',intent:'detail',enoughMaterial:false,suggestedNextStep:'continue',sourceRefs:[{answerId:input.answers[0].id,revision:input.answers[0].revision}]})}}]});
 }});
 assert.equal(calls,1);
 assert.equal(report.calls,1);
 assert.equal(report.cases[0].status,'error');
 assert.match(report.cases[0].error,/budget/);
});

test('evaluation deadline interrupts even a fake transport that ignores abort',async()=>{
 const report=await evaluateAgents([fixtureById('FW-01')],{live:true,apiKey:'fictional-key',maxCalls:6,timeoutMs:25,fetcher:()=>new Promise(()=>{})});
 assert.equal(report.calls,1);
 assert.equal(report.cases[0].status,'error');
 assert.match(report.cases[0].error,/deadline/);
});
