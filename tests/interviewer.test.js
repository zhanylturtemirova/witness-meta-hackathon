import test from 'node:test';
import assert from 'node:assert/strict';
import {interviewer} from '../agents/interviewer.mjs';
import {newProject,addAnswer,setInterviewer} from '../web/domain.js';
import {witnessAI,projectInput} from '../web/ai-client.js';
import {buildMetaRequest} from '../server/ai/meta.mjs';
import {interviewerCases,evaluateInterviewer,interviewerOptions} from '../scripts/evaluate-interviewer.mjs';

// The interviewer prompt is a live-model contract: mocks cannot validate
// wording, so pin the directives the follow-up quality depends on. Update
// these phrases together with agents/interviewer.mjs.
test('interviewer instructions require specific, unrepeated, balanced follow-ups', () => {
  assert.equal(interviewer.id, 'interviewer');
  assert.equal(interviewer.model, 'muse-spark-1.3');
  const text = interviewer.instructions.interview;
  for (const phrase of [
    'one short question',
    'do not force one into every question',
    'Never repeat a question already asked',
    'askedIntents',
    'do not re-ask a skipped thread',
    'genuinely new and useful question',
    'Alternate naturally',
    'mechanically turn figurative wording into a literal question',
    'may stand as it is',
    'never ask two in a row',
    'Do not assume emotions',
    'never ask how it changed their life',
    'wrap_up',
    'no invitation to continue',
    'continue even past three answers',
    'review_event',
    'valid source references',
  ]) assert.ok(text.includes(phrase), `missing directive: ${phrase}`);
});

// Fictional offline conversations through the mock interview path. Inline
// fiction only — holdout fixtures stay reserved for post-change evaluation.
// These pin structural guarantees (one short question, valid intent,
// latest-answer sourcing, no repeats); follow-up quality itself needs a
// bounded live evaluation with human review.
async function ask(entries) {
  const p = newProject('small-moment');
  for (const e of entries) {
    setInterviewer(p, {result: {question: e.q, ...(e.intent ? {intent: e.intent} : {})}, provider: 'mock', model: null});
    addAnswer(p, e.text);
  }
  const input = projectInput(p);
  const out = await witnessAI.interview(input, {provider: 'mock'});
  return {input, result: out.result, provider: out.provider, model: out.model, prior: entries.map(e => e.q), last: p.answers.at(-1)};
}

function assertWellFormed(t, askedIntents = []) {
  assert.equal(t.provider, 'mock');
  assert.equal(t.model, null);
  assert.ok(typeof t.result.question === 'string' && t.result.question.length > 0);
  assert.ok(t.result.question.length <= 600, 'one short question');
  assert.ok(t.result.question.endsWith('?'), 'a question, not a statement');
  assert.ok(!t.prior.includes(t.result.question), 'never repeats an asked question');
  assert.deepEqual(t.result.sourceRefs, [{answerId: t.last.id, revision: t.last.revision}]);
  assert.deepEqual(t.input.askedIntents, askedIntents);
}

test('interview offline: brief answer continues without forcing review', async () => {
  const t = await ask([{q: 'What stayed with you from today?', text: 'Rain on the windows.'}]);
  assertWellFormed(t);
  assert.equal(t.result.enoughMaterial, false);
  assert.equal(t.result.suggestedNextStep, 'continue');
});

test('interview offline: rich memory sources the latest answer', async () => {
  const t = await ask([
    {q: 'Which small moment keeps coming back?', intent: 'opening', text: 'We went to a concert in Manchester around 2018 and the band played two long encores.'},
    {q: 'Who was with you?', intent: 'people', text: 'My sister came with me. The music was so loud she covered her ears and laughed through the whole chorus.'},
    {q: 'What stayed with you from that night?', intent: 'detail', text: 'Walking home past midnight, still hearing the last song echo between the houses while the streets emptied.'},
  ]);
  assertWellFormed(t, ['opening', 'people', 'detail']);
  assert.equal(t.result.enoughMaterial, true);
});

test('interview offline: uncertainty is invited, never pressed', async () => {
  const t = await ask([{q: 'What stayed with you from that night?', text: 'Walking home past midnight. I am not sure about the month.'}]);
  assertWellFormed(t);
  assert.equal(t.result.intent, 'clarify');
  assert.match(t.result.question, /leave it as you remember it/);
  assert.equal(t.result.suggestedNextStep, 'continue');
});

test('interview offline: ordinary diary entry stays ordinary', async () => {
  const t = await ask([
    {q: 'What stayed with you from today?', intent: 'opening', text: 'Rain ran down the kitchen window all evening. I made soup and read for an hour.'},
    {q: 'What did that evening feel like?', intent: 'meaning', text: 'Slow and calm. The flat felt small in a good way.'},
  ]);
  assertWellFormed(t, ['opening', 'meaning']);
  assert.equal(t.result.suggestedNextStep, 'continue');
});

test('interview offline: refusal closes the thread', async () => {
  const t = await ask([{q: 'Who would you like to remember?', text: "My uncle taught me to fish. I'd rather not talk about the last summer, though."}]);
  assertWellFormed(t);
  assert.equal(t.result.intent, 'wrap_up');
  assert.match(t.result.question, /Thank you for telling me/);
  assert.equal(t.result.suggestedNextStep, 'continue');
});

test('interview offline: topic change follows the latest thread', async () => {
  const t = await ask([
    {q: 'Which small moment keeps coming back?', intent: 'opening', text: 'We went to a concert in Manchester around 2018. The band played until late.'},
    {q: 'Who was with you?', intent: 'people', text: 'My sister. The music was so loud she covered her ears and laughed.'},
    {q: 'What is new in your life instead?', intent: 'detail', text: 'Actually, we moved to Bristol in 2021 with two suitcases and no plan at all.'},
  ]);
  assertWellFormed(t, ['opening', 'people', 'detail']);
  assert.ok(t.last.text.includes('Bristol'));
});

// The model can only avoid repeats if it receives the prior questions and
// the covered intents. Pin the exact handoff: project answers plus skipped
// intents into the request, unchanged into the model message.
test('interview request forwards questions, answers, and asked intents to the model', () => {
  const p = newProject('small-moment');
  setInterviewer(p, {result: {question: 'Who was with you?', intent: 'people'}, provider: 'mock', model: null});
  addAnswer(p, 'My sister. The music was so loud she covered her ears and laughed.');
  p.skippedIntents = ['meaning'];
  const input = projectInput(p);
  assert.equal(input.answers[0].question, 'Who was with you?');
  assert.deepEqual(input.askedIntents, ['people', 'meaning']);
  const req = buildMetaRequest('interview', input);
  assert.equal(req.model, 'muse-spark-1.3');
  assert.equal(req.messages[0].role, 'system');
  assert.equal(req.messages[0].content, interviewer.instructions.interview);
  assert.equal(req.messages[1].role, 'user');
  assert.deepEqual(JSON.parse(req.messages[1].content), input);
});

test('interview offline: skipped intents are not re-asked', async () => {
  const p = newProject('small-moment');
  setInterviewer(p, {result: {question: 'What stayed with you?'}, provider: 'mock', model: null});
  addAnswer(p, 'My sister and I moved to a new city after the concert. I am not sure about the month.');
  p.skippedIntents = ['clarify', 'people', 'detail', 'place'];
  const out = await witnessAI.interview(projectInput(p), {provider: 'mock'});
  assert.equal(out.result.intent, 'meaning');
  assert.match(out.result.question, /mean to you at the time/);
});

const FINISH_CLOSE = 'Thank you for sharing this. Your answers are saved, and you can review them whenever you are ready.';

test('interview offline: an explicit finish closes without a content question', async () => {
  for (const text of [
    'That is everything. I want to finish here.',
    'Thanks, I want to stop here.',
    "Let's finish for today.",
    "I'm done.",
    'No more questions, thank you.',
  ]) {
    const p = newProject('small-moment');
    setInterviewer(p, {result: {question: 'What else comes back?'}, provider: 'mock', model: null});
    addAnswer(p, text);
    const out = await witnessAI.interview(projectInput(p), {provider: 'mock'});
    assert.equal(out.result.intent, 'wrap_up', text);
    assert.equal(out.result.question, FINISH_CLOSE, text);
    assert.equal(out.result.question.includes('?'), false, 'a closing statement, not another question');
  }
});

test('interview offline: refusal still invites another memory, finish does not', async () => {
  const refused = await ask([{q: 'Who would you like to remember?', text: "I'd rather not talk about that night."}]);
  assert.equal(refused.result.intent, 'wrap_up');
  assert.match(refused.result.question, /remember something else instead/);
  const finished = await ask([{q: 'What else comes back?', text: "That's everything. I'm done."}]);
  assert.equal(finished.result.intent, 'wrap_up');
  assert.equal(finished.result.question.includes('?'), false);
  assert.equal(finished.result.question.includes('something else'), false);
  assert.match(finished.result.question, /review them whenever you are ready/);
});

test('interview offline: finishing a full story suggests review, not another question', async () => {
  const t = await ask([
    {q: 'Which small moment keeps coming back?', intent: 'opening', text: 'We went to a concert in Manchester around 2018 and the band played two long encores for us.'},
    {q: 'Who was with you?', intent: 'people', text: 'My sister came with me. The music was so loud she covered her ears and laughed through the chorus.'},
    {q: 'What stayed with you from that night?', intent: 'detail', text: 'Walking home past midnight, still hearing the last song. That is everything, I want to finish here.'},
  ]);
  assert.equal(t.result.intent, 'wrap_up');
  assert.equal(t.result.question, FINISH_CLOSE);
  assert.equal(t.result.enoughMaterial, true);
  assert.equal(t.result.suggestedNextStep, 'review_event');
});

// The interview-only eval prepares one follow-up per fictional conversation
// with the exact input attached. These tests pin the harness (cases,
// budgets, gating); they say nothing about live question quality.
test('interviewer eval covers seven fictional conversations, flagging the holdout', () => {
  const cases = interviewerCases();
  assert.deepEqual(cases.map(c => c.id), ['brief', 'rich', 'uncertain', 'diary', 'refusal', 'topic-change', 'finish']);
  assert.deepEqual(cases.map(c => c.holdout), [true, false, false, false, false, false, false]);
  assert.deepEqual(cases.find(c => c.id === 'topic-change').fixtures, ['CO-01', 'MV-01']);
  assert.ok(cases.find(c => c.id === 'finish').entries.at(-1).text.includes('I want to finish here'));
  const options = interviewerOptions([]);
  assert.equal(options.live, false);
  assert.equal(options.maxCalls, 7);
  assert.throws(() => interviewerOptions(['--live']), /allow-paid-api/);
  assert.throws(() => interviewerOptions(['--live', '--allow-paid-api']), /max-calls/);
  assert.throws(() => interviewerOptions(['--case', 'missing']), /Unknown conversation/);
});

test('interviewer eval mock rehearsal uses no network and records exact inputs', async () => {
  const report = await evaluateInterviewer(interviewerCases(), {fetcher: async () => { throw Error('must not use network'); }});
  assert.equal(report.mode, 'mock');
  assert.equal(report.calls, 7);
  assert.ok(report.cases.every(c => c.status === 'ready_for_human_review'));
  const brief = report.cases.find(c => c.id === 'brief');
  assert.ok(brief.input.answers.some(a => a.text.includes('Rain on the windows')));
  const moved = report.cases.find(c => c.id === 'topic-change');
  assert.ok(moved.input.answers.at(-1).text.includes('Bristol'));
  // Realistic prior intents travel with the preserved question text, so the
  // model sees what a real conversation would have asked and covered.
  const byId = Object.fromEntries(report.cases.map(c => [c.id, c]));
  assert.deepEqual(byId.diary.input.askedIntents, ['opening', 'meaning']);
  assert.deepEqual(byId.rich.input.askedIntents, ['opening', 'detail', 'people', 'meaning']);
  assert.deepEqual(byId.finish.input.askedIntents, ['opening', 'meaning', 'detail']);
  assert.equal(byId.diary.input.answers[0].question, 'What stayed with you from today?');
  for (const c of report.cases) {
    assert.equal(c.input.askedIntents.length, c.input.answers.length);
    assert.ok(typeof c.output.question === 'string' && c.output.question.length <= 600);
    assert.equal(c.provider, 'mock');
  }
  assert.equal(byId.finish.output.intent, 'wrap_up');
});

test('interviewer eval live path records a canned follow-up without the key', async () => {
  const fakeLive = async (_url, options) => {
    const input = JSON.parse(JSON.parse(options.body).messages[1].content);
    const last = input.answers.at(-1);
    const result = {question: 'What else do you remember?', intent: 'detail', sourceRefs: [{answerId: last.id, revision: last.revision}], enoughMaterial: false, suggestedNextStep: 'continue'};
    return {ok: true, json: async () => ({choices: [{message: {content: JSON.stringify(result)}, finish_reason: 'stop'}]})};
  };
  const report = await evaluateInterviewer(interviewerCases().slice(0, 1), {live: true, apiKey: 'fictional-key', maxCalls: 1, fetcher: fakeLive});
  assert.equal(report.mode, 'meta-live');
  assert.equal(report.cases[0].output.question, 'What else do you remember?');
  assert.equal(report.cases[0].provider, 'meta');
  assert.equal(JSON.stringify(report).includes('fictional-key'), false);
});

test('interviewer eval stops at its call budget', async () => {
  const report = await evaluateInterviewer(interviewerCases(), {maxCalls: 2, fetcher: async () => { throw Error('must not use network'); }});
  assert.equal(report.calls, 2);
  assert.equal(report.completedCases, 2);
  assert.equal(report.requestedCases, 7);
});
