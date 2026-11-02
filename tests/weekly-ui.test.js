import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject, addAnswer, reviseAnswer, createStory} from '../web/domain.js';
import {clearAIStatusCache} from '../web/ai-client.js';
import {weekStartISO, weekRangeLabel} from '../web/weekly.js';

// Headless UI-wiring verification for the weekly flow. The real web/app.js
// runs against a minimal fake DOM with controlled fake network responses.
// This proves view rendering, action dispatch, selection invalidation,
// navigation cancellation, and persistence wiring — not real-browser
// behavior (layout, media, actual network), which still needs a browser.
function fakeElement() {
  const stored = {};
  const noop = () => {};
  return new Proxy({}, {
    get(t, key) {
      if (key in stored) return stored[key];
      if (typeof key === 'symbol') return undefined;
      if (key === 'classList') return {toggle: noop, add: noop, remove: noop};
      if (key === 'dataset') return {};
      if (key === 'style') return {};
      return noop;
    },
    set(t, key, value) { stored[key] = value; return true; }
  });
}

let loadId = 0;
async function loadApp(storageJSON, fetchImpl) {
  const els = {};
  const handlers = {};
  const store = new Map([['witness.stories.v1', storageJSON]]);
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); }
  };
  globalThis.window = {addEventListener() {}, scrollTo() {}};
  globalThis.document = {
    activeElement: null,
    querySelector: sel => (els[sel] ??= fakeElement()),
    querySelectorAll: () => [],
    addEventListener: (type, fn) => { (handlers[type] ??= []).push(fn); }
  };
  globalThis.fetch = fetchImpl;
  clearAIStatusCache();
  await import(`../web/app.js?weekly-ui=${++loadId}`);
  await new Promise(r => setTimeout(r, 20));
  return {
    els,
    html: () => els['#app'].innerHTML,
    saved: () => JSON.parse(store.get('witness.stories.v1')),
    snapshot: () => store.get('witness.stories.v1'),
    externalWrite: data => store.set('witness.stories.v1',JSON.stringify(data)),
    async click(action, id, extra) {
      const button = {disabled: false, dataset: {action, ...(id === undefined ? {} : {id}), ...(extra || {})}};
      await Promise.all(handlers.click.map(fn => fn({target: {closest: () => button}, preventDefault() {}})));
    },
    change(target) {
      for (const fn of handlers.change) fn({target});
    }
  };
}
async function waitFor(cond) {
  for (let i = 0; i < 1000 && !cond(); i++) await new Promise(r => setTimeout(r, 0));
  assert.equal(cond(), true);
}
const offlineFetch = async () => { throw Error('offline'); };
// Mid-week midday UTC stays in one Monday-start week in every timezone.
function weeklySeed(title = 'Four entries in a week') {
  const p = newProject('small-moment', title);
  const entries = [
    ['2026-11-03T12:00:00Z', 'Rain on the windows all morning. I stayed in and read.'],
    ['2026-11-04T12:00:00Z', 'Soup for dinner with my sister. She laughed at my burnt toast.'],
    ['2026-11-05T12:00:00Z', 'A morning walk to the bakery before eight. The street was empty.'],
    ['2026-11-06T12:00:00Z', 'My grandmother hummed an old lullaby while the kettle rattled.']
  ];
  for (const [iso, text] of entries) { const a = addAnswer(p, text); a.createdAt = Date.parse(iso); }
  createStory(p);
  return p;
}
function seedJSON(projects, active, view) {
  return JSON.stringify({version: 1, projects, active: active.id, view});
}
function liveStatus() {
  return Response.json({provider: 'meta', textLiveAvailable: true, liveTasks: ['interview', 'event', 'archivist', 'editor', 'period'], model: 'muse-spark-1.3'});
}
function periodEnvelope(p) {
  const refs = p.answers.map(a => ({answerId: a.id, revision: a.revision}));
  return Response.json({provider: 'meta', model: 'muse-spark-1.3',
    result: {title: 'A live week', rangeText: 'Nov 2 – Nov 8, 2026', narrative: p.answers.map(a => a.text).join('\n\n'),
      sourceRefs: refs, paragraphRefs: p.answers.map(a => ({paragraph: a.text, sourceRefs: [{answerId: a.id, revision: a.revision}]}))},
    rejected: null, verification: {status: 'verified', issues: [], attempts: 1, verifier: 'meta'}});
}

test('weekly entry point opens selection and mock generation shows paragraph sources', async () => {
  const p = weeklySeed();
  const app = await loadApp(seedJSON([p], p, 'story'), offlineFetch);
  assert.ok(app.html().includes('weekly-open'));
  assert.ok(app.html().includes('Draft a weekly story'));
  await app.click('weekly-open');
  assert.ok(app.html().includes('GATHER A WEEK'));
  assert.ok(app.html().includes('4 entries'));
  await app.click('weekly-generate');
  assert.ok(app.html().includes('REVIEW YOUR WEEK'));
  assert.ok(app.html().includes('Rain on the windows'));
  assert.ok(app.html().includes('weekly-source'));
  assert.ok(app.html().includes('Accept this story'));
});

test('deselecting an entry drops the proposal; accept saves only the selection', async () => {
  const p = weeklySeed();
  const app = await loadApp(seedJSON([p], p, 'story'), offlineFetch);
  await app.click('weekly-open');
  await app.click('weekly-generate');
  assert.ok(app.html().includes('REVIEW YOUR WEEK'));
  const dropped = p.answers[0].id;
  app.change({id: '', value: dropped, checked: false, dataset: {}, matches: sel => sel === '.weekly-entry input'});
  assert.equal(app.html().includes('REVIEW YOUR WEEK'), false);
  assert.ok(app.html().includes('3 entries selected.'));
  await app.click('weekly-generate');
  await app.click('weekly-accept');
  const kept = app.saved().projects[0].weekly;
  assert.equal(kept.length, 1);
  assert.equal(kept[0].sourceRefs.length, 3);
  assert.equal(kept[0].paragraphRefs.length, 3);
  assert.equal(kept[0].sourceRefs.some(r => r.answerId === dropped), false);
  assert.equal(kept[0].weekStart, weekStartISO(Date.parse('2026-11-04T12:00:00Z'), kept[0].timeZone));
  assert.equal(kept[0].rangeText, weekRangeLabel(kept[0].weekStart));
});

test('changing week or timezone drops the proposal', async () => {
  const p = weeklySeed();
  const extra = addAnswer(p, 'A concert in Leeds. The ticket stub says 2019.');
  extra.createdAt = Date.parse('2026-11-10T12:00:00Z');
  const app = await loadApp(seedJSON([p], p, 'story'), offlineFetch);
  await app.click('weekly-open');
  const weekA = weekStartISO(Date.parse('2026-11-04T12:00:00Z'), 'UTC');
  app.change({id: 'weekly-week', value: weekA, dataset: {}, matches: () => false});
  await app.click('weekly-generate');
  assert.ok(app.html().includes('REVIEW YOUR WEEK'));
  app.change({id: 'weekly-tz', value: 'Pacific/Auckland', dataset: {}, matches: () => false});
  assert.equal(app.html().includes('REVIEW YOUR WEEK'), false);
  assert.ok(app.html().includes('Pacific/Auckland'));
});

test('navigating away mid-generation aborts it and late responses are never accepted', async () => {
  const p = weeklySeed();
  const signals = [];
  let release;
  const gate = new Promise(res => { release = res; });
  const fetchImpl = async url => {
    if (url === '/api/ai-status') return liveStatus();
    if (url === '/api/ai/period') return gate;
    throw Error('unexpected ' + url);
  };
  const app = await loadApp(seedJSON([p], p, 'story'), (url, init) => {
    if (url === '/api/ai/period') signals.push(init.signal);
    return Promise.race([fetchImpl(url, init), new Promise((_, rej) => setTimeout(() => rej(Error('test gate timeout')), 5000))]);
  });
  await app.click('weekly-open');
  const pending = app.click('weekly-generate');
  await waitFor(() => signals.length === 1);
  assert.ok(app.html().includes('Gathering'));
  assert.ok(app.html().includes('weekly-cancel'));
  await app.click('step', 'story');
  assert.equal(signals[0].aborted, true);
  release(periodEnvelope(p));
  await pending;
  assert.equal(app.html().includes('REVIEW YOUR WEEK'), false);
  assert.equal(app.saved().projects[0].weekly, undefined);
  assert.ok(app.html().includes('Draft a weekly story'));
});

test('switching projects mid-generation aborts it and late responses are never accepted', async () => {
  const a = weeklySeed('Project A week');
  const b = newProject('person', 'Project B memory');
  addAnswer(b, 'My uncle taught me to fish on quiet mornings.');
  createStory(b);
  let release;
  const gate = new Promise(res => { release = res; });
  const signals = [];
  const app = await loadApp(seedJSON([a, b], a, 'story'), (url, init) => {
    if (url === '/api/ai-status') return liveStatus();
    if (url === '/api/ai/period') { signals.push(init.signal); return Promise.race([gate, new Promise((_, rej) => setTimeout(() => rej(Error('test gate timeout')), 5000))]); }
    throw Error('unexpected ' + url);
  });
  await app.click('weekly-open');
  const pending = app.click('weekly-generate');
  await waitFor(() => signals.length === 1);
  await app.click('home');
  assert.ok(app.html().includes('Project B memory'));
  await app.click('read', b.id);
  assert.equal(signals[0].aborted, true);
  release(periodEnvelope(a));
  await pending;
  const saved = app.saved();
  assert.equal(saved.active, b.id);
  assert.equal(saved.projects.find(x => x.id === a.id).weekly, undefined);
});

test('accepted weekly stories persist across reload', async () => {
  const p = weeklySeed();
  const app = await loadApp(seedJSON([p], p, 'story'), offlineFetch);
  await app.click('weekly-open');
  await app.click('weekly-generate');
  await app.click('weekly-accept');
  assert.equal(app.saved().projects[0].weekly.length, 1);
  const reloaded = await loadApp(app.snapshot(), offlineFetch);
  assert.ok(reloaded.html().includes('Kept weeks'));
  assert.ok(reloaded.html().includes('Four entries in a week'));
  assert.ok(reloaded.html().includes('4 entries'));
});

test('source controls open the exact cited revision, current or superseded', async () => {
  const p = newProject('small-moment', 'A corrected entry');
  const a = addAnswer(p, 'Rain on the windows all morning. I stayed in and read.');
  a.createdAt = Date.parse('2026-11-04T12:00:00Z');
  reviseAnswer(p, a.id, 'Rain all morning. I stayed in and wrote letters instead.');
  createStory(p);
  p.weekly = [
    {id: 'w-old', weekStart: '2026-11-02', timeZone: 'UTC', title: 'Old wording week', rangeText: 'Nov 2 – Nov 8, 2026',
      narrative: 'Rain and reading.', sourceRefs: [{answerId: a.id, revision: 1}],
      paragraphRefs: [{paragraph: 'Rain and reading.', sourceRefs: [{answerId: a.id, revision: 1}]}]},
    {id: 'w-new', weekStart: '2026-11-02', timeZone: 'UTC', title: 'New wording week', rangeText: 'Nov 2 – Nov 8, 2026',
      narrative: 'Rain and letters.', sourceRefs: [{answerId: a.id, revision: 2}],
      paragraphRefs: [{paragraph: 'Rain and letters.', sourceRefs: [{answerId: a.id, revision: 2}]}]}
  ];
  const app = await loadApp(seedJSON([p], p, 'weekly'), offlineFetch);
  assert.ok(app.html().includes('sources changed since accepted'));
  await app.click('weekly-read', 'w-old');
  await app.click('weekly-source', a.id, {rev: '1'});
  const modal = app.els['#modal-content'].innerHTML;
  assert.ok(modal.includes('I stayed in and read.'));
  assert.ok(modal.includes('SUPERSEDED'));
  assert.equal(modal.includes('wrote letters'), false);
  await app.click('weekly-source', a.id, {rev: '2'});
  const modal2 = app.els['#modal-content'].innerHTML;
  assert.ok(modal2.includes('wrote letters'));
  assert.ok(modal2.includes('current wording'));
});

test('editor button produces an actionable verified suggestion and acceptance keeps the source answer',async()=>{
 const p=newProject('small-moment','A quiet morning');addAnswer(p,'I remember the kettle rattling.');createStory(p);
 const passage=p.story.passages[0],original=p.answers[0].text;
 const app=await loadApp(seedJSON([p],p,'story'),offlineFetch);
 await app.click('editor-suggest',passage.id);
 assert.ok(app.html().includes('Use this wording'),'a fresh proposal must not be discarded as stale');
 await app.click('editor-accept',passage.id);
 const saved=app.saved().projects[0];assert.equal(saved.story.passages[0].edited,true);assert.equal(saved.answers[0].text,original);
 assert.equal(saved.story.passages[0].sourceRevision,1);
});

test('a stale tab cannot overwrite a newer story saved by another tab',async()=>{
 const p=weeklySeed('Original tab');const app=await loadApp(seedJSON([p],p,'story'),offlineFetch);
 const newer=app.saved();newer.projects[0].title='Newer work from another tab';app.externalWrite(newer);
 await app.click('editor-suggest',p.story.passages[0].id);
 assert.equal(app.saved().projects[0].title,'Newer work from another tab');
 assert.ok(app.els['#storage-warning'].innerHTML.includes('will not overwrite'));
 assert.ok(app.els['#storage-warning'].innerHTML.includes('Download this tab'));
 assert.equal(app.html().includes('Use this wording'),false);
});
