import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,addAnswer,reviseAnswer,createStory,isStale,refreshPassage,exportStory,nextQuestion,validProject} from '../web/domain.js';
test('an answer edit preserves the source used by an existing passage until explicitly refreshed',()=>{
 const p=newProject('turning-point');const a=addAnswer(p,'I moved around 2018, I think.');createStory(p);const s=p.story.passages[0];
 reviseAnswer(p,a.id,'I moved in 2019.');
 assert.equal(s.sourceText,'I moved around 2018, I think.');assert.equal(s.text,'I moved around 2018, I think.');assert.equal(isStale(p,s),true);
 assert.deepEqual(a.history,[{revision:1,text:'I moved around 2018, I think.'}]);
 assert.match(exportStory(p),/source changed; passage needs review/);
 refreshPassage(p,s.id);assert.equal(s.text,'I moved in 2019.');assert.equal(isStale(p,s),false);assert.equal(s.sourceRevision,2);
});
test('editable story export keeps the narrator edit and the exact original source separately',()=>{
 const p=newProject('person');addAnswer(p,'My sister was with me.');createStory(p);p.story.passages[0].text='That day, my sister came along.';
 const text=exportStory(p);assert.match(text,/That day, my sister came along\. \[1\]/);assert.match(text,/Original answer: My sister was with me\./);
 assert.equal(validProject(JSON.parse(JSON.stringify(p))),true);
});
test('follow-up can respond to the previous answer without inventing details',()=>{
 const p=newProject('small-moment');addAnswer(p,'I went to a concert.');assert.match(nextQuestion(p),/sound, sight, or detail/);
});
test('blank answers and broken source links are rejected',()=>{
 const p=newProject('person');assert.throws(()=>addAnswer(p,'   '));assert.equal(p.answers.length,0);assert.throws(()=>createStory(p));
 const a=addAnswer(p,'A memory.');assert.throws(()=>reviseAnswer(p,a.id,''));createStory(p);p.story.passages[0].sourceId='missing';assert.equal(validProject(p),false);
});
