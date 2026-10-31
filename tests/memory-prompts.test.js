import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,addAnswer,nextQuestion,validProject} from '../web/domain.js';
import {MEMORY_PROMPTS,promptOptions,suggestedPrompt,useMemoryPrompt} from '../web/memory-prompts.js';
test('Witness offers a fresh thread at the start and every three answers, with dismissal and opt-out',()=>{
 const p=newProject('small-moment');assert.ok(suggestedPrompt(p));
 addAnswer(p,'A fictional day.');assert.equal(suggestedPrompt(p),null);
 addAnswer(p,'I was with a friend.');addAnswer(p,'We had tea.');assert.ok(suggestedPrompt(p));
 p.dismissedNudgeAt=3;assert.equal(suggestedPrompt(p),null);delete p.dismissedNudgeAt;p.memoryNudges=false;assert.equal(suggestedPrompt(p),null);
});
test('chosen questions become exact answer sources, are not repeated, and survive reload',()=>{
 const p=newProject('small-moment'),q=MEMORY_PROMPTS[1];useMemoryPrompt(p,q);
 assert.equal(nextQuestion(p),q.question);assert.equal(suggestedPrompt(p),null);
 const a=addAnswer(p,'A fictional happy afternoon with my grandmother.');assert.equal(a.question,q.question);assert.equal(a.promptId,q.id);
 const reloaded=JSON.parse(JSON.stringify(p));assert.equal(validProject(reloaded),true);assert.ok(!promptOptions(reloaded).some(x=>x.id===q.id));
});
test('changing questions preserves an unfinished answer and does not assume a profession',()=>{
 const p=newProject('small-moment');p.draft='Still writing this memory';const before=JSON.stringify(p);
 assert.throws(()=>useMemoryPrompt(p,MEMORY_PROMPTS[0]),/Save your answer/);assert.equal(JSON.stringify(p),before);
 p.draft='';addAnswer(p,'My teacher was kind.');assert.doesNotMatch(promptOptions(p).find(x=>x.id==='calling').question,/be a teacher/);
 addAnswer(p,'I became a teacher.');assert.match(promptOptions(p).find(x=>x.id==='calling').question,/be a teacher/);
});
