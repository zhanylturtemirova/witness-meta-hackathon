import test from 'node:test';
import assert from 'node:assert/strict';
import {INTERVIEW_FIXTURES,HOLDOUT_IDS,fixtureById,buildDemoProject,buildDemoStarter,DEMO_STORY_ID} from '../web/demo-fixtures.js';
import {CONNECT_EVENTS,CONNECT_STORIES,CONNECT_EXPECTATIONS} from '../web/connect-fixtures.js';
import {TOPICS,validProject,exportStory,createStory} from '../web/domain.js';
import {witnessAI,projectInput} from '../web/ai-client.js';

const PRINTABLE = /^[ -~À-ÿ\s“”’—…]*$/;

test('interview fixtures are well-formed, fictional, and resolve their references', () => {
  assert.equal(INTERVIEW_FIXTURES.length, 12);
  assert.equal(new Set(INTERVIEW_FIXTURES.map(f => f.id)).size, 12);
  for (const f of INTERVIEW_FIXTURES) {
    assert.ok(TOPICS.some(t => t.id === f.topic), f.id);
    assert.equal(typeof f.holdout, 'boolean', f.id);
    assert.ok(f.entries.length >= 1 && f.entries.length <= 6, f.id);
    for (const e of f.entries) {
      assert.ok(e.q.trim().length > 0 && e.text.trim().length > 0, f.id);
      assert.ok(PRINTABLE.test(e.q + e.text), f.id);
    }
    assert.ok(f.expected.facts.length > 0 && f.prohibited.length > 0, f.id);
    for (const r of f.expected.refs) assert.ok(f.entries[r.entry], f.id);
  }
});

test('exactly four cases stay reserved for post-prompt-change evaluation', () => {
  assert.deepEqual([...HOLDOUT_IDS].sort(), ['CO-02', 'FW-02', 'MV-02', 'SH-01']);
  assert.deepEqual(INTERVIEW_FIXTURES.filter(f => f.holdout).map(f => f.id).sort(), [...HOLDOUT_IDS].sort());
  assert.equal(fixtureById(DEMO_STORY_ID).holdout, false);
});

test('loading a demo always builds a fresh valid project, never overwrites', () => {
  for (const f of INTERVIEW_FIXTURES) {
    const a = buildDemoProject(f), b = buildDemoProject(f);
    assert.equal(validProject(a), true);
    assert.equal(a.title, f.title);
    assert.equal(a.answers.length, f.entries.length);
    assert.deepEqual(a.answers.map(x => x.question), f.entries.map(e => e.q));
    assert.deepEqual(a.answers.map(x => x.text), f.entries.map(e => e.text));
    assert.notEqual(a.id, b.id);
    assert.deepEqual(a.answers.map(x => x.id).some(id => b.answers.some(y => y.id === id)), false);
  }
});

test('connect fixtures distinguish occasions, kindred experiences, and lookalikes', () => {
  assert.equal(new Set(CONNECT_EVENTS.map(e => e.id)).size, CONNECT_EVENTS.length);
  assert.equal(new Set(CONNECT_STORIES.map(s => s.id)).size, CONNECT_STORIES.length);
  const labels = CONNECT_EXPECTATIONS.map(x => x.label);
  assert.ok(labels.includes('same_occasion') && labels.includes('similar_experience') && labels.includes('no_match'));
  for (const x of CONNECT_EXPECTATIONS) {
    const e = CONNECT_EVENTS.find(e => e.id === x.event), s = CONNECT_STORIES.find(s => s.id === x.story);
    assert.ok(e && s, x.event + '/' + x.story);
    assert.ok(x.reason.length > 20, x.event + '/' + x.story);
    assert.ok(x.excerpts.length >= 2, x.event + '/' + x.story);
    for (const q of x.excerpts) assert.ok((e.excerpt + s.excerpt + s.story).includes(q), q);
    if (x.label === 'same_occasion') assert.equal(s.occasion, e.occasion);
    if (x.label === 'similar_experience') assert.ok(s.country !== e.country || s.year !== e.year);
  }
});

test('a demo interview starts empty while a completed example loads every answer', () => {
  const f = fixtureById(DEMO_STORY_ID);
  const starter = buildDemoStarter(f), other = buildDemoStarter(f);
  assert.equal(validProject(starter), true);
  assert.equal(starter.answers.length, 0);
  assert.equal(starter.interviewer.question, f.entries[0].q);
  assert.equal(starter.example, true);
  assert.equal(starter.demoFixtureId, f.id);
  assert.notEqual(starter.id, other.id);
  const completed = buildDemoProject(f);
  assert.equal(completed.answers.length, f.entries.length);
  assert.equal(completed.example, true);
  assert.equal(completed.demoFixtureId, f.id);
  assert.notEqual(starter.id, completed.id);
});

test('demo provenance stays visible in exports without changing model behaviour', async () => {
  const f = fixtureById(DEMO_STORY_ID);
  const demo = buildDemoProject(f);
  createStory(demo);
  assert.match(exportStory(demo), /Fictional example/);
  const plain = buildDemoProject(f);
  plain.example = false;
  delete plain.demoFixtureId;
  // Fresh identities differ, so compare content fields, not source IDs.
  const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));
  const qi = (await witnessAI.interview(projectInput(demo), {provider: 'mock'})).result;
  const qj = (await witnessAI.interview(projectInput(plain), {provider: 'mock'})).result;
  assert.deepEqual(pick(qi, ['question', 'intent', 'suggestedNextStep']), pick(qj, ['question', 'intent', 'suggestedNextStep']));
  const ga = (await witnessAI.archivist(projectInput(demo), {provider: 'mock'})).result;
  const gb = (await witnessAI.archivist(projectInput(plain), {provider: 'mock'})).result;
  assert.deepEqual(ga.groups.map(g => [g.label, g.answerRefs.length]), gb.groups.map(g => [g.label, g.answerRefs.length]));
  const ea = (await witnessAI.event(projectInput(demo), {provider: 'mock'})).result;
  const eb = (await witnessAI.event(projectInput(plain), {provider: 'mock'})).result;
  assert.deepEqual(pick(ea, ['title', 'summary', 'dateText', 'location', 'people', 'themes']), pick(eb, ['title', 'summary', 'dateText', 'location', 'people', 'themes']));
  const wa = (await witnessAI.editor({...projectInput(demo), passage: demo.answers[0].text}, {provider: 'mock'})).result;
  const wb = (await witnessAI.editor({...projectInput(plain), passage: plain.answers[0].text}, {provider: 'mock'})).result;
  assert.deepEqual(pick(wa, ['proposal', 'keptPhrases']), pick(wb, ['proposal', 'keptPhrases']));
});

test('house-building work matches house-building abroad, not a bakery job', () => {
  const strong = CONNECT_EXPECTATIONS.find(x => x.event === 'CE-2' && x.label === 'similar_experience' && x.story !== 'CS-4');
  assert.ok(strong, 'a construction similar_experience exists for CE-2');
  const story = CONNECT_STORIES.find(s => s.id === strong.story);
  assert.ok(story.country !== 'UK' || story.year !== '2019');
  assert.match(strong.reason, /labourer|carrying timber|mixing mortar|small houses|foreman/i);
  assert.ok(strong.excerpts.length >= 2);
  const bakery = CONNECT_EXPECTATIONS.find(x => x.event === 'CE-2' && x.story === 'CS-4');
  assert.equal(bakery.label, 'no_match');
  assert.match(bakery.reason, /different trade|bakery/i);
  assert.equal(CONNECT_EXPECTATIONS.some(x => x.event === 'CE-2' && x.story === 'CS-4' && x.label === 'similar_experience'), false);
});

test('mock roles stay within sources on non-holdout fixtures', async () => {
  const used = [];
  for (const f of INTERVIEW_FIXTURES.filter(f => !f.holdout)) {
    used.push(f.id);
    const p = buildDemoProject(f), input = projectInput(p), sources = p.answers.map(a => a.text).join('\n');
    const groups = (await witnessAI.archivist(input, {provider: 'mock'})).result.groups;
    const seen = groups.flatMap(g => g.answerRefs.map(r => r.answerId));
    assert.equal(new Set(seen).size, seen.length, f.id);
    const draft = (await witnessAI.event(input, {provider: 'mock'})).result;
    const next = (await witnessAI.interview(input, {provider: 'mock'})).result;
    const outputs = [draft.title, draft.summary, draft.location || '', next.question];
    for (const bad of f.prohibited) {
      for (const out of outputs) {
        if (out.toLowerCase().includes(bad.toLowerCase())) assert.ok(sources.toLowerCase().includes(bad.toLowerCase()), `${f.id}: invented ${bad}`);
      }
    }
  }
  assert.equal(used.length, 8);
  assert.deepEqual(used.some(id => HOLDOUT_IDS.includes(id)), false);
});
