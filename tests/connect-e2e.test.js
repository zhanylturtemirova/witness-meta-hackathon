import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {newProject, addAnswer, createStory} from '../web/domain.js';
import {saveEvent, confirmEvent} from '../web/event-model.js';
import {answerRefs} from '../web/ai-contracts.js';
import {buildDiscoveryCandidates} from '../web/discovery.js';
import {clearAIStatusCache} from '../web/ai-client.js';
import {handleAI} from '../server/ai/routes.mjs';

// Headless end-to-end Connect verification. The real web/app.js runs against
// a minimal fake DOM; the real Supabase client talks to a canned REST router;
// /api/* routes through the real server handlers with a fake Meta transport.
// Only the network edges are faked — everything between is production code.
//
// The real Supabase Auth client opens a BroadcastChannel per client for
// cross-tab sync; in Node an open channel holds the event loop forever, so
// plain `node --test` would never exit. Track and close every channel after
// each test — the app instance under test is replaced on every load anyway,
// and browsers are unaffected (their page owns the channel lifetime).
const openChannels = new Set();
const RealBroadcastChannel = globalThis.BroadcastChannel;
if (RealBroadcastChannel) {
  globalThis.BroadcastChannel = function (...args) {
    const channel = new RealBroadcastChannel(...args);
    openChannels.add(channel);
    return channel;
  };
}
afterEach(() => {
  for (const channel of openChannels) {
    try { channel.close(); } catch { /* already closed */ }
  }
  openChannels.clear();
});
const elHandlers = new WeakMap();
function fakeElement() {
  const stored = {};
  const handlers = {};
  const kids = {};
  const noop = () => {};
  const el = new Proxy({}, {
    get(t, key) {
      if (typeof key === 'symbol') return undefined;
      if (key in stored) return stored[key];
      if (key === 'value' || key === 'checked') return undefined;
      if (key === 'classList') return {toggle: noop, add: noop, remove: noop};
      if (key === 'dataset') return {};
      if (key === 'style') return {};
      if (key === 'addEventListener') return (type, fn, opts) => {
        const entry = {type, fn, signal: opts?.signal};
        (handlers[type] ??= []).push(entry);
        opts?.signal?.addEventListener('abort', () => {
          handlers[type] = (handlers[type] || []).filter(e => e !== entry);
        }, {once: true});
      };
      if (key === 'removeEventListener') return (type, fn) => {
        handlers[type] = (handlers[type] || []).filter(e => e.fn !== fn);
      };
      if (key === 'querySelector') return sel => (kids[sel] ??= fakeElement());
      if (key === 'querySelectorAll') return () => [];
      return noop;
    },
    set(t, key, value) { stored[key] = value; return true; }
  });
  elHandlers.set(el, handlers);
  return el;
}
function listenersOf(el, type) {
  return (elHandlers.get(el)?.[type] || []).map(e => e.fn);
}

let loadId = 0;
async function loadApp(storageJSON, fetchImpl, hooks = {}) {
  const els = {};
  const handlers = {};
  const store = new Map([['witness.stories.v1', storageJSON]]);
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); }
  };
  globalThis.window = {
    addEventListener() {},
    scrollTo() {},
    location: {href: 'http://localhost/', hash: '', search: '', origin: 'http://localhost', pathname: '/', hostname: 'localhost', protocol: 'http:'}
  };
  globalThis.matchMedia = hooks.matchMedia || (() => ({matches: false}));
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.document = {
    activeElement: null,
    querySelector: sel => (els[sel] ??= fakeElement()),
    querySelectorAll: () => [],
    addEventListener: (type, fn) => { (handlers[type] ??= []).push(fn); }
  };
  globalThis.fetch = fetchImpl;
  clearAIStatusCache();
  await import(`../web/app.js?connect-e2e=${++loadId}`);
  await new Promise(r => setTimeout(r, 20));
  return {
    els,
    // The fake DOM has no tree: #connect-root renders into its own element,
    // so splice it into the #app markup the way the browser nests it. Every
    // app render re-mounts Connect synchronously, so the splice is current.
    html: () => els['#app'].innerHTML.replace('<div id="connect-root"></div>',
      `<div id="connect-root">${els['#connect-root'] ? els['#connect-root'].innerHTML || '' : ''}</div>`),
    async click(action, id, extra) {
      const button = {disabled: false, dataset: {action, ...(id === undefined ? {} : {id}), ...(extra || {})}};
      await Promise.all(handlers.click.map(fn => fn({target: {closest: () => button}, preventDefault() {}})));
    },
    async connectClick(selector, dataset = {}) {
      const root = els['#connect-root'];
      const evt = {target: {closest: s => (s === selector ? {dataset} : null)}, preventDefault() {}};
      await Promise.all(listenersOf(root, 'click').map(fn => fn(evt)));
    },
    change(target) {
      for (const fn of handlers.change) fn({target});
    }
  };
}
async function waitFor(cond, limit = 2000) {
  for (let i = 0; i < limit && !cond(); i++) await new Promise(r => setTimeout(r, 0));
  assert.equal(cond(), true);
}
function seedProject() {
  const p = newProject('small-moment', 'First loud summer');
  const a1 = addAnswer(p, 'My sister and I saw our first band play live in Leeds. The crowd sang every word until late.');
  const a2 = addAnswer(p, 'We missed the last train home and walked half the city laughing about the encore.');
  const a3 = addAnswer(p, 'I still keep the ticket stub in a book. Around 2019, I think, though I am not certain.');
  for (const a of [a1, a2, a3]) a.createdAt = Date.parse('2026-11-04T12:00:00Z');
  createStory(p);
  saveEvent(p, {
    title: 'First concert in Leeds', summary: 'My sister and I saw our first band play live in Leeds. The crowd sang every word until late.',
    dateText: '2019', location: 'Leeds', people: [], themes: [], detailsToConfirm: [], sourceRefs: answerRefs(p.answers)
  }, {provider: 'mock', model: null, verification: {status: 'verified', attempts: 1, verifier: 'mock'}});
  confirmEvent(p, {title: 'First concert in Leeds', summary: 'My sister and I saw our first band play live in Leeds. The crowd sang every word until late.', dateText: '2019', location: 'Leeds'});
  return p;
}
function seedJSON(projects, active, view) {
  return JSON.stringify({version: 1, projects, active: active.id, view});
}
// Fictional published copies served by the canned Supabase REST router.
function publicRows() {
  const base = {like_count: 0, updated_at: '2026-01-01T00:00:00Z', date_approx: false, occasion_id: ''};
  return [
    {id: 'pub-concert', pen_name: 'Mara', title: 'First loud night', passages: ['The band played until late and the crowd sang every word.'], event_title: 'First concert', event_summary: 'A first live show with a band.', event_city: 'Leeds', event_date_text: '2019', event_year: 2019, city: 'leeds', lon: -1.55, lat: 53.8, topics: ['first-concert'], revision: 2, ...base},
    {id: 'pub-site', pen_name: 'Jonas', title: 'The site by the river', passages: ['Hired as a labourer on a small-house site, carrying timber and mixing mortar.'], event_title: 'First job', event_summary: 'House-building work for a summer.', event_city: 'Gdansk', event_date_text: '2022', event_year: 2022, city: 'gdansk', lon: 18.65, lat: 54.35, topics: ['work'], revision: 1, ...base},
    {id: 'pub-bakery', pen_name: 'Sofia', title: 'Flour everywhere', passages: ['My first Saturday at the bakery ended with flour everywhere.'], event_title: 'Bakery job', event_summary: 'A first job baking bread.', event_city: 'Lisbon', event_date_text: '2020', event_year: 2020, city: 'lisbon', lon: -9.14, lat: 38.72, topics: ['work'], revision: 1, ...base},
  ];
}
function makeRouter({rows, env, rank, calls}) {
  const metaFetcher = async (url, init = {}) => {
    calls.meta.push(JSON.parse(init.body));
    if (init.signal?.aborted) { const e = Error('aborted'); e.name = 'AbortError'; throw e; }
    const name = JSON.parse(init.body).response_format.json_schema.name;
    const payload = name === 'witness_discovery' ? {results: rank()} : {};
    return Response.json({choices: [{message: {content: JSON.stringify(payload)}, finish_reason: 'stop'}]});
  };
  return {
    calls,
    fetch: async (url, init = {}) => {
      const u = String(url);
      if (u.startsWith('/api/')) {
        const req = new Request('http://localhost' + u, {
          method: init.method || 'GET', headers: init.headers || {},
          body: init.body ?? null, ...(init.signal ? {signal: init.signal} : {})
        });
        return handleAI(req, env, metaFetcher);
      }
      if (u.includes('/rest/v1/published_stories')) return Response.json(rows);
      if (u.includes('/auth/v1/')) return Response.json({message: 'no session'}, {status: 401});
      throw Error('unexpected network ' + u);
    }
  };
}
const LIVE_ENV = {META_AI_ENABLED: 'true', MODEL_API_KEY: 'fake-test-key'};

test('real mode loads public rows and previews local topic matches without any model call', async () => {
  const p = seedProject();
  const calls = {meta: []};
  const app = await loadApp(seedJSON([p], p, 'connect'), makeRouter({rows: publicRows(), env: LIVE_ENV, rank: () => [], calls}).fetch);
  assert.ok(app.html().includes('Fictional community preview'));
  await app.connectClick('[data-connect-mode]', {connectMode: 'real'});
  await waitFor(() => app.html().includes('First loud night'));
  assert.ok(app.html().includes('Mara'));
  assert.equal(app.html().includes('Flour everywhere'), false);
  assert.deepEqual(calls.meta, []);
  // Honest data-flow wording: selection is local, explicit search sends.
  const realHtml = app.html();
  assert.ok(realHtml.includes('only an explicit search sends your search text'));
  assert.equal(realHtml.includes('never leaves this device'), false);
  assert.equal(realHtml.includes('matching happens here'), false);
  // Narrow screens stack events, globe, then the filter form in DOM order.
  assert.ok(realHtml.indexOf('globe-panel') < realHtml.indexOf('real-side'));
});

test('a failed public-stories fetch ends loading with an honest error and retry', async () => {
  const p = seedProject();
  const app = await loadApp(seedJSON([p], p, 'connect'), async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('/api/')) {
      return handleAI(new Request('http://localhost' + u, {method: init.method || 'GET', headers: init.headers || {}, body: init.body ?? null}), {}, async () => { throw Error('no live'); });
    }
    if (u.includes('/rest/v1/published_stories')) throw Error('network down');
    if (u.includes('/auth/v1/')) return Response.json({message: 'no session'}, {status: 401});
    throw Error('unexpected network ' + u);
  });
  await app.connectClick('[data-connect-mode]', {connectMode: 'real'});
  // The Supabase SDK retries a failed fetch 4x (~1s/2s/4s backoff, ~7s to
  // settle); the app then reports honestly. Budget for the real timing.
  await waitFor(() => app.html().includes('Witness could not reach the community service'), 9000);
  assert.equal(app.html().includes('Loading shared stories'), false);
  assert.ok(app.html().includes('data-real-retry'));
});

test('explicit semantic search ranks by meaning with validated verbatim evidence', async () => {
  const p = seedProject();
  const calls = {meta: []};
  const rows = publicRows();
  const built = buildDiscoveryCandidates(rows, {filters: {fromYear: null, toYear: null, city: '', includeUnknownDates: true}, excludeIds: new Set()});
  const concertText = built.candidates.find(c => c.id === 'pub-concert').text;
  const query = p.events[0].summary;
  const rank = () => [{
    id: 'pub-concert', revision: 2, score: 0.92,
    reason: 'Both describe a first live concert where a band played late and the crowd sang along.',
    queryEvidence: query.slice(0, 60), candidateEvidence: concertText.slice(0, 80)
  }];
  const app = await loadApp(seedJSON([p], p, 'connect'), makeRouter({rows, env: LIVE_ENV, rank, calls}).fetch);
  await app.connectClick('[data-connect-mode]', {connectMode: 'real'});
  await waitFor(() => app.html().includes('First loud night'));
  await app.connectClick('[data-discovery-search]', {});
  await waitFor(() => app.html().includes('ranked 1 story'));
  assert.equal(calls.meta.length, 1);
  const sent = calls.meta[0];
  assert.equal(sent.response_format.json_schema.name, 'witness_discovery');
  const ranked = app.html();
  assert.ok(ranked.includes('Both describe a first live concert'));
  assert.ok(ranked.includes(query.slice(0, 60)));
  assert.ok(ranked.includes(concertText.slice(0, 80)));
  assert.equal(ranked.includes('Same occasion'), false);
});

test('the search request carries only the allowlisted public fields', async () => {
  const p = seedProject();
  const calls = {meta: []};
  const app = await loadApp(seedJSON([p], p, 'connect'), makeRouter({rows: publicRows(), env: LIVE_ENV, rank: () => [], calls}).fetch);
  await app.connectClick('[data-connect-mode]', {connectMode: 'real'});
  await waitFor(() => app.html().includes('First loud night'));
  await app.connectClick('[data-discovery-search]', {});
  await waitFor(() => calls.meta.length === 1);
  const userPayload = JSON.parse(calls.meta[0].messages.find(m => m.role === 'user').content);
  assert.deepEqual(Object.keys(userPayload).sort(), ['candidates', 'query']);
  for (const c of userPayload.candidates) assert.deepEqual(Object.keys(c).sort(), ['id', 'revision', 'text']);
  assert.equal(JSON.stringify(userPayload).includes(p.answers[0].id), false);
});

test('filters narrow locally and empty filters send no model call', async () => {
  const p = seedProject();
  const calls = {meta: []};
  const app = await loadApp(seedJSON([p], p, 'connect'), makeRouter({rows: publicRows(), env: LIVE_ENV, rank: () => [], calls}).fetch);
  await app.connectClick('[data-connect-mode]', {connectMode: 'real'});
  await waitFor(() => app.html().includes('First loud night'));
  const root = app.els['#connect-root'];
  // Any other selector (canvas, stage, controls) resolves to a blank
  // element, like a real querySelector over the rendered markup — never
  // null, which no real browser produces for markup that is present.
  root.querySelector = sel => {
    if (sel === '[data-discovery-filter="city"]') return {value: 'lisbon'};
    if (sel === '[data-discovery-filter="fromYear"]') return {value: ''};
    if (sel === '[data-discovery-filter="toYear"]') return {value: ''};
    if (sel === '[data-discovery-filter="includeUnknownDates"]') return {checked: true};
    if (sel === '[data-discovery-query]') return {value: undefined};
    return fakeElement();
  };
  // Changing a filter repaints the visible preview immediately, not just
  // the next search request: the Leeds concert preview leaves the globe
  // (the Lisbon bakery shares no topic, so the preview reads honestly empty).
  app.change({matches: s => s === '[data-discovery-filter]'});
  await waitFor(() => app.html().includes('0 stories share your topics'));
  assert.equal(app.html().includes('First loud night'), false);
  await app.connectClick('[data-discovery-search]', {});
  await waitFor(() => app.html().includes('ranked 0 stories') || calls.meta.length === 1);
  assert.equal(calls.meta.length, 1);
  assert.deepEqual(JSON.parse(calls.meta[0].messages.find(m => m.role === 'user').content).candidates.map(c => c.id), ['pub-bakery']);
  root.querySelector = sel => {
    if (sel === '[data-discovery-filter="city"]') return {value: 'tokyo'};
    if (sel === '[data-discovery-filter="fromYear"]') return {value: ''};
    if (sel === '[data-discovery-filter="toYear"]') return {value: ''};
    if (sel === '[data-discovery-filter="includeUnknownDates"]') return {checked: true};
    if (sel === '[data-discovery-query]') return {value: undefined};
    return fakeElement();
  };
  await app.connectClick('[data-discovery-search]', {});
  await waitFor(() => app.html().includes('No shared stories match those filters'));
  assert.equal(calls.meta.length, 1);
});

test('unavailable AI reports honestly and the preview keeps working', async () => {
  const p = seedProject();
  const calls = {meta: []};
  const app = await loadApp(seedJSON([p], p, 'connect'), makeRouter({rows: publicRows(), env: {}, rank: () => [], calls}).fetch);
  await app.connectClick('[data-connect-mode]', {connectMode: 'real'});
  await waitFor(() => app.html().includes('First loud night'));
  await app.connectClick('[data-discovery-search]', {});
  await waitFor(() => app.html().includes('Semantic search is not set up on this server'));
  assert.ok(app.html().includes('First loud night'));
  assert.equal(app.html().includes('Searching…'), false);
});

test('reading a ranked story opens it over the globe with Why-it-relates evidence', async () => {
  const p = seedProject();
  const calls = {meta: []};
  const rows = publicRows();
  const built = buildDiscoveryCandidates(rows, {filters: {fromYear: null, toYear: null, city: '', includeUnknownDates: true}, excludeIds: new Set()});
  const concertText = built.candidates.find(c => c.id === 'pub-concert').text;
  const query = p.events[0].summary;
  const rank = () => [{
    id: 'pub-concert', revision: 2, score: 0.92,
    reason: 'Both describe a first live concert where a band played late.',
    queryEvidence: query.slice(0, 60), candidateEvidence: concertText.slice(0, 80)
  }];
  const app = await loadApp(seedJSON([p], p, 'connect'), makeRouter({rows, env: LIVE_ENV, rank, calls}).fetch);
  await app.connectClick('[data-connect-mode]', {connectMode: 'real'});
  await waitFor(() => app.html().includes('First loud night'));
  await app.connectClick('[data-discovery-search]', {});
  await waitFor(() => app.html().includes('ranked 1 story'));
  await app.connectClick('[data-map-story],[data-read-story],[data-locate]', {readStory: 'real:pub-concert'});
  const modal = app.els['#modal-content'].innerHTML;
  assert.ok(modal.includes('FOUND BY SEMANTIC SEARCH'));
  assert.ok(modal.includes('Why it relates'));
  assert.ok(modal.includes(query.slice(0, 60)));
  assert.ok(modal.includes(concertText.slice(0, 80)));
  assert.ok(modal.includes('muse-spark-1.3'));
  assert.ok(app.html().includes('connect-globe'));
});

test('a pending search shows public excerpts as in-progress work, then clears into results', async () => {
  const p = seedProject();
  const calls = {meta: []};
  const rows = publicRows();
  const built = buildDiscoveryCandidates(rows, {filters: {fromYear: null, toYear: null, city: '', includeUnknownDates: true}, excludeIds: new Set()});
  const excerptOf = (id) => built.candidates.find(c => c.id === id).text.slice(0, 60);
  const query = p.events[0].summary;
  const rank = () => [{
    id: 'pub-concert', revision: 2, score: 0.9,
    reason: 'Both describe a first live concert.',
    queryEvidence: query.slice(0, 60), candidateEvidence: built.candidates.find(c => c.id === 'pub-concert').text.slice(0, 80)
  }];
  let releaseMeta;
  const gate = new Promise(res => { releaseMeta = res; });
  const router = makeRouter({rows, env: LIVE_ENV, rank, calls});
  const gated = router.fetch;
  router.fetch = async (url, init = {}) => {
    if (String(url) === '/api/ai/discovery') { await gate; return gated(url, init); }
    return gated(url, init);
  };
  try {
    const app = await loadApp(seedJSON([p], p, 'connect'), router.fetch);
    await app.connectClick('[data-connect-mode]', {connectMode: 'real'});
    await waitFor(() => app.html().includes('First loud night'));
    await app.connectClick('[data-discovery-search]', {});
    await waitFor(() => app.html().includes('Search in progress'));
    const pending = app.html();
    // Overlay shows bound public candidates in stable order (bakery, concert),
    // labelled as in-progress — never private answer wording.
    assert.ok(pending.includes(excerptOf('pub-bakery')));
    assert.ok(pending.includes(excerptOf('pub-concert')));
    assert.ok(pending.includes('show search candidates; ranked connections appear only for validated matches'));
    assert.equal(pending.includes('missed the last train'), false);
    releaseMeta();
    await waitFor(() => app.html().includes('ranked 1 story'));
    assert.equal(app.html().includes('Search in progress'), false);
    assert.equal(app.html().includes('searching-excerpts'), true, 'displayed results retain decorative letters');
    assert.equal(app.html().includes('Search in progress'), false);
    assert.equal(app.html().includes(excerptOf('pub-bakery')), false, 'unranked candidate leaves the letter source');
    assert.ok(app.html().includes(excerptOf('pub-concert')));
  } finally {
    releaseMeta();
  }
});

test('switching events discards the stale ranking and cancels the search', async () => {
  const a = seedProject();
  const b = newProject('small-moment', 'A move abroad');
  addAnswer(b, 'We packed two suitcases and moved to a new country in autumn.');
  addAnswer(b, 'The first weeks were a blur of new streets and unfamiliar food.');
  addAnswer(b, 'I still miss the old flat, but the harbour here is beautiful.');
  createStory(b);
  saveEvent(b, {
    title: 'Moving abroad', summary: 'We packed two suitcases and moved to a new country in autumn.',
    dateText: '2021', location: 'Lisbon', people: [], themes: [], detailsToConfirm: [], sourceRefs: answerRefs(b.answers)
  }, {provider: 'mock', model: null, verification: {status: 'verified', attempts: 1, verifier: 'mock'}});
  confirmEvent(b, {title: 'Moving abroad', summary: 'We packed two suitcases and moved to a new country in autumn.', dateText: '2021', location: 'Lisbon'});
  const calls = {meta: []};
  let releaseMeta;
  const gate = new Promise(res => { releaseMeta = res; });
  const router = makeRouter({rows: publicRows(), env: LIVE_ENV, rank: () => [], calls});
  const gated = router.fetch;
  router.fetch = async (url, init = {}) => {
    if (String(url) === '/api/ai/discovery') {
      await Promise.race([gate,
        new Promise((_, rej) => {
          const err = () => { const e = Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (init.signal?.aborted) return err();
          init.signal?.addEventListener('abort', err, {once: true});
        }),
        new Promise((_, rej) => setTimeout(() => rej(Error('gate timeout')), 5000))]);
      return gated(url, init);
    }
    return gated(url, init);
  };
  try {
    const app = await loadApp(seedJSON([a, b], a, 'connect'), router.fetch);
    await app.connectClick('[data-connect-mode]', {connectMode: 'real'});
    await waitFor(() => app.html().includes('First loud night'));
    await app.connectClick('[data-connect-event]', {connectEvent: `private:${a.id}:${a.events[0].id}`});
    const pending = app.connectClick('[data-discovery-search]', {});
    await waitFor(() => app.html().includes('Searching…'));
    await app.connectClick('[data-connect-event]', {connectEvent: `private:${b.id}:${b.events[0].id}`});
    assert.equal(app.html().includes('Searching…'), false);
    releaseMeta();
    await pending;
    assert.equal(calls.meta.length, 0);
    assert.equal(app.html().includes('ranked 0 stories'), false);
  } finally {
    releaseMeta();
  }
});

function candidateSlice(rows, id, len = 60) {
  const built = buildDiscoveryCandidates(rows, {filters: {fromYear: null, toYear: null, city: '', includeUnknownDates: true}, excludeIds: new Set()});
  return built.candidates.find(c => c.id === id).text.slice(0, len);
}

test('simulated preview cycles bound excerpts with no model call and cancels cleanly', async () => {
  const p = seedProject();
  const calls = {meta: []};
  const rows = publicRows();
  const siteSlice = candidateSlice(rows, 'pub-site');
  const app = await loadApp(seedJSON([p], p, 'connect'), makeRouter({rows, env: {}, rank: () => [], calls}).fetch);
  await app.connectClick('[data-connect-mode]', {connectMode: 'real'});
  await waitFor(() => app.html().includes('First loud night'));
  assert.ok(app.html().includes('data-discovery-preview'));
  await app.connectClick('[data-discovery-preview]', {});
  await waitFor(() => app.html().includes('Simulated preview'));
  const pending = app.html();
  assert.ok(pending.includes('Simulated preview — cycling 3 bound excerpts'));
  assert.equal(pending.includes('Asking Muse'), false);
  // Slot B joins at t=3s with the third bound excerpt (site) — cycling
  // past the two initially painted quotes, with no model call.
  const root = app.els['#connect-root'];
  const slotText = (i) => String(root.querySelector(`[data-quote-slot="${i}"]`).querySelector('p').textContent);
  await waitFor(() => slotText(1).includes(siteSlice), 6000);
  // One card per slot on a single tray above the canvas: no duplicated
  // copy, no behind layer, so the animation cannot jump between layers.
  assert.ok(app.html().includes('class="searching-excerpts"'));
  assert.equal(app.html().includes('searching-excerpts-behind'), false);
  assert.equal(app.html().includes('data-quote-behind'), false);
  // Each card names its origin city from the published story (live card
  // nodes — the fake DOM has no tree, so JS text updates bypass html()).
  const slotSmall = (i) => String(root.querySelector(`[data-quote-slot="${i}"]`).querySelector('small').textContent);
  assert.ok(slotSmall(0).includes('Shared from Lisbon'));
  assert.ok(slotSmall(1).includes('Shared from Gdansk'));
  assert.deepEqual(calls.meta, []);
  assert.equal(app.html().includes('ranked '), false);
  await app.connectClick('[data-discovery-cancel]', {});
  assert.equal(app.html().includes('searching-excerpts'), true, 'local topic matches retain decorative letters');
  assert.equal(app.html().includes('Search in progress'), false);
  // Cancellation kills the 12s timer: the sleep runs past its deadline
  // and no completion toast or refresh may follow.
  await new Promise(r => setTimeout(r, 10000));
  assert.equal(String(app.els['#toast']?.textContent).includes('Simulated preview finished'), false);
  assert.deepEqual(calls.meta, []);
});

test('simulated preview completes with clean state and no ranked results', async () => {
  const p = seedProject();
  const calls = {meta: []};
  const app = await loadApp(seedJSON([p], p, 'connect'), makeRouter({rows: publicRows(), env: {}, rank: () => [], calls}).fetch);
  await app.connectClick('[data-connect-mode]', {connectMode: 'real'});
  await waitFor(() => app.html().includes('First loud night'));
  await app.connectClick('[data-discovery-preview]', {});
  await waitFor(() => app.html().includes('Simulated preview'));
  await waitFor(() => String(app.els['#toast']?.textContent).includes('Simulated preview finished'), 14000);
  assert.equal(app.html().includes('searching-excerpts'), true, 'local topic matches retain decorative letters');
  assert.equal(app.html().includes('Search in progress'), false);
  assert.equal(app.html().includes('ranked '), false);
  assert.deepEqual(calls.meta, []);
});

test('live AI hides the simulated preview offer', async () => {
  const p = seedProject();
  const calls = {meta: []};
  const app = await loadApp(seedJSON([p], p, 'connect'), makeRouter({rows: publicRows(), env: LIVE_ENV, rank: () => [], calls}).fetch);
  await app.connectClick('[data-connect-mode]', {connectMode: 'real'});
  await waitFor(() => app.html().includes('First loud night'));
  assert.equal(app.html().includes('data-discovery-preview'), false);
});

test('mobile shows one quote slot and cycles it', async () => {
  const p = seedProject();
  const calls = {meta: []};
  const rows = publicRows();
  const concertSlice = candidateSlice(rows, 'pub-concert');
  const app = await loadApp(seedJSON([p], p, 'connect'), makeRouter({rows, env: {}, rank: () => [], calls}).fetch,
    {matchMedia: (q) => ({matches: String(q).includes('max-width')})});
  await app.connectClick('[data-connect-mode]', {connectMode: 'real'});
  await waitFor(() => app.html().includes('First loud night'));
  await app.connectClick('[data-discovery-preview]', {});
  await waitFor(() => app.html().includes('Simulated preview'));
  assert.ok(app.html().includes('data-quote-slot="0"'));
  assert.equal(app.html().includes('data-quote-slot="1"'), false);
  // The lone slot rotates to the next bound excerpt on its 6s restart.
  const root = app.els['#connect-root'];
  await waitFor(() => String(root.querySelector('[data-quote-slot="0"]').querySelector('p').textContent).includes(concertSlice), 8000);
  await app.connectClick('[data-discovery-cancel]', {});
  assert.deepEqual(calls.meta, []);
});

test('reduced motion shows quotes statically without cycling', async () => {
  const p = seedProject();
  const calls = {meta: []};
  const rows = publicRows();
  const siteSlice = candidateSlice(rows, 'pub-site');
  const app = await loadApp(seedJSON([p], p, 'connect'), makeRouter({rows, env: {}, rank: () => [], calls}).fetch,
    {matchMedia: (q) => ({matches: String(q).includes('prefers-reduced-motion')})});
  await app.connectClick('[data-connect-mode]', {connectMode: 'real'});
  await waitFor(() => app.html().includes('First loud night'));
  await app.connectClick('[data-discovery-preview]', {});
  await waitFor(() => app.html().includes('Simulated preview'));
  // Both desktop quotes render statically; past the 3s join deadline no
  // assignment may have happened — no timers run under reduced motion.
  assert.ok(app.html().includes(candidateSlice(rows, 'pub-bakery')));
  await new Promise(r => setTimeout(r, 4500));
  const root = app.els['#connect-root'];
  assert.equal(String(root.querySelector('[data-quote-slot="1"]').querySelector('p').textContent).includes(siteSlice), false);
  await app.connectClick('[data-discovery-cancel]', {});
  assert.deepEqual(calls.meta, []);
});
