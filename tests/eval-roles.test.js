import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,addAnswer,reviseAnswer} from '../web/domain.js';
import {witnessAI,projectInput} from '../web/ai-client.js';
import {mockVerifyProse,mockVerifyEvent} from '../web/mock-ai.js';
import {validateRefs} from '../web/ai-contracts.js';

// Fictional evaluation set for the Stage 3 roles. All cases run against local
// mocks with fake transports only; no model calls. Skipped cases document known
// mock limitations that live-model evaluation must cover.
function journal() {
  const p = newProject('small-moment');
  addAnswer(p, 'We went to a concert in Manchester around 2018. The band played until late.');
  addAnswer(p, 'The music was so loud my sister covered her ears and laughed.');
  addAnswer(p, 'We moved to a new city that autumn with two suitcases and no plan.');
  return p;
}

test('eval: vague dates stay approximate through extraction and editing', async () => {
  const p = journal();
  const draft = (await witnessAI.event(projectInput(p), {provider: 'mock'})).result;
  assert.equal(draft.dateText, 'around 2018');
  const checked = mockVerifyEvent(draft, p.answers.map(a => ({...a})));
  assert.equal(checked.supported, true);
  const env = await witnessAI.editor({...projectInput(p), passage: p.answers[0].text}, {provider: 'mock'});
  assert.equal(env.verification.status, 'verified');
  assert.ok(env.result.proposal.includes('around 2018'));
});

test('eval: invented years and names are flagged in events and wording', async () => {
  const p = journal();
  const answers = p.answers.map(a => ({...a}));
  const eventIssues = mockVerifyEvent({title: 'Evening', summary: 'A night in 1999.', dateText: null, location: null, people: [], themes: [], detailsToConfirm: []}, answers);
  assert.equal(eventIssues.supported, false);
  assert.ok(eventIssues.issues.some(i => i.reason === 'contradiction' && i.statement === '1999'));
  const proseIssues = mockVerifyProse({proposal: 'We met Jonathan Pryce after the show in 1999.'}, answers);
  assert.equal(proseIssues.supported, false);
  assert.ok(proseIssues.issues.some(i => i.reason === 'invented_fact'));
  assert.ok(proseIssues.issues.some(i => i.reason === 'contradiction'));
});

test('eval: corrections invalidate old references and flow into new drafts', async () => {
  const p = journal();
  const oldRef = [{answerId: p.answers[0].id, revision: p.answers[0].revision}];
  reviseAnswer(p, p.answers[0].id, 'We went to a concert in Leeds around 2019. The band played until late.');
  assert.throws(() => validateRefs(oldRef, p.answers), /unknown or outdated/);
  const draft = (await witnessAI.event(projectInput(p), {provider: 'mock'})).result;
  assert.equal(draft.dateText, 'around 2019');
  assert.equal(draft.location, 'Leeds');
});

test('eval: a refusal is acknowledged and never pressed', async () => {
  const p = newProject('small-moment');
  addAnswer(p, "I'd rather not talk about that night.");
  const r = (await witnessAI.interview(projectInput(p), {provider: 'mock'})).result;
  assert.equal(r.intent, 'wrap_up');
  assert.match(r.question, /Thank you for telling me/);
});

test('eval: a changed topic separates occasions and follows the latest thread', async () => {
  const p = journal();
  const groups = (await witnessAI.archivist(projectInput(p), {provider: 'mock'})).result.groups;
  assert.ok(groups.length >= 2);
  const seen = groups.flatMap(g => g.answerRefs.map(r => r.answerId));
  assert.equal(new Set(seen).size, seen.length);
  const next = (await witnessAI.interview(projectInput(p), {provider: 'mock'})).result;
  assert.equal(next.sourceRefs[0].answerId, p.answers.at(-1).id);
});

test('eval: short answers still group, draft, and continue the interview', async () => {
  const p = newProject('small-moment');
  addAnswer(p, 'Rain on the windows.');
  const groups = (await witnessAI.archivist(projectInput(p), {provider: 'mock'})).result.groups;
  assert.equal(groups.length, 1);
  const draft = (await witnessAI.event(projectInput(p), {provider: 'mock'})).result;
  assert.equal(draft.dateText, null);
  const next = (await witnessAI.interview(projectInput(p), {provider: 'mock'})).result;
  assert.equal(next.enoughMaterial, false);
  assert.equal(next.suggestedNextStep, 'continue');
});

test('eval: distinctive wording survives editing', async () => {
  const p = newProject('person');
  addAnswer(p, 'My grandmother hummed an old lullaby while the kettle rattled on the stove.');
  const env = await witnessAI.editor({...projectInput(p), passage: p.answers[0].text}, {provider: 'mock'});
  assert.equal(env.verification.status, 'verified');
  assert.ok(env.result.keptPhrases.some(w => /lullaby|grandmother|rattled/i.test(w)));
});

test('eval: two same-topic occasions stay apart', {skip: 'known mock limitation: keyword clustering cannot separate two concerts; needs live-model evaluation'}, async () => {
  const p = newProject('small-moment');
  addAnswer(p, 'The first concert was in a small club with my sister.');
  addAnswer(p, 'The second concert was in a stadium with my brother.');
  const groups = (await witnessAI.archivist(projectInput(p), {provider: 'mock'})).result.groups;
  assert.equal(groups.length, 2);
});

test('eval: semantic contradictions beyond years are caught', {skip: 'known mock limitation: mocks match years and names only; needs live-model evaluation'}, async () => {
  const p = newProject('small-moment');
  addAnswer(p, 'We stayed home all evening and never left the flat.');
  const issues = mockVerifyProse({proposal: 'We danced at the club until morning.'}, p.answers.map(a => ({...a})));
  assert.equal(issues.supported, false);
});
