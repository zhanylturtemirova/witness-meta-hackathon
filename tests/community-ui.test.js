import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOUD_QUOTE_LIMIT,
  buildRealViewState,
  cancelDiscovery,
  capturePreviewBinding,
  checkPreviewBinding,
  createCommunityUI,
  previewsEqual,
  resetCommunityUI,
  searchingExcerptsFor,
  shapeCloudQuotes,
  togglePickedTopic,
} from '../web/community-ui.js';
import { buildDiscoveryCandidates, beginDiscoverySearch, setDiscoveryFilters } from '../web/discovery.js';

// Behavioral checks for the community UI orchestration (web/community-ui.js).
// These exercise outcomes through the public helpers — preview bindings that
// reject drifted sources, cache/epoch resets on account switch, bounded
// cloud quotes, and topic allowlisting — never implementation strings.
function buildPreview(project, inputs) {
  return {
    preview: {
      title: project.title,
      passage: project.story.passages[0]?.text,
      topics: [...(inputs?.topics || [])].sort(),
    },
  };
}

function liveProject() {
  return {
    id: 'story-1',
    title: 'The winter we moved',
    story: { passages: [{ id: 'p1', text: 'We left around 2019.' }] },
  };
}

test('a preview binding accepts an unchanged story and rejects a drifted one', () => {
  const project = liveProject();
  const inputs = { topics: ['moving-abroad'] };
  const binding = capturePreviewBinding(buildPreview(project, inputs).preview, inputs);
  assert.equal(checkPreviewBinding(project, binding, buildPreview).ok, true);

  project.story.passages[0].text = 'We left around 2020, rewritten.';
  const stale = checkPreviewBinding(project, binding, buildPreview);
  assert.equal(stale.ok, false);
  assert.match(stale.error, /changed since the preview/i);
});

test('a binding built from different inputs does not verify', () => {
  const project = liveProject();
  const binding = capturePreviewBinding(
    buildPreview(project, { topics: ['family'] }).preview,
    { topics: ['family'] },
  );
  const other = checkPreviewBinding(
    project,
    { preview: binding.preview, inputs: { topics: ['work'] } },
    buildPreview,
  );
  assert.equal(other.ok, false);
});

test('freezing a binding keeps later form edits out of the frozen copy', () => {
  const project = liveProject();
  const inputs = { topics: ['family'] };
  const binding = capturePreviewBinding(buildPreview(project, inputs).preview, inputs);
  inputs.topics.push('work');
  assert.deepEqual(binding.inputs, { topics: ['family'] });
  assert.equal(previewsEqual(binding.preview, buildPreview(project, { topics: ['family'] }).preview), true);
});

test('account switch drops caches and retires pending replies via epochs', () => {
  const ui = createCommunityUI();
  ui.realFetched = true;
  ui.realLikesFor = 'uid-old';
  ui.real.myLikes = ['pub-1'];
  ui.share = { projectId: 'story-1' };
  ui.openRealCard = { publishedId: 'pub-1', token: 7 };
  ui.cloudQuotes = { rows: [{ id: 'q1' }], error: '', loading: true, loadedFor: 'uid-old', epoch: 4 };

  const pending = ui.cloudQuotes.epoch;
  resetCommunityUI(ui);

  assert.equal(ui.realFetched, false);
  assert.equal(ui.realLikesFor, null);
  assert.equal(ui.share, null);
  assert.equal(ui.openRealCard, null);
  assert.deepEqual(ui.cloudQuotes.rows, []);
  assert.equal(ui.cloudQuotes.loadedFor, null);
  assert.equal(ui.cloudQuotes.loading, false);
  assert.ok(ui.cloudQuotes.epoch > pending, 'epoch advances so a late reply resolves stale');
});

test('cloud quotes stay bounded, skip blank text, and return a fresh list', () => {
  const rows = Array.from({ length: CLOUD_QUOTE_LIMIT + 20 }, (_, i) => ({
    id: `q${i}`,
    text: i % 7 === 0 ? '   ' : `kept phrase ${i}`,
    author: 'A. Winter',
    source_title: 'Winter move',
    published_id: 'pub-1',
    published_revision: 2,
  }));
  const shaped = shapeCloudQuotes(rows);
  assert.ok(shaped.length <= CLOUD_QUOTE_LIMIT);
  assert.ok(shaped.every((q) => q.text.trim().length > 0));
  shaped.push({ id: 'intruder', text: 'intruder' });
  assert.equal(shapeCloudQuotes(rows).some((q) => q.id === 'intruder'), false);
});

test('topic picks keep only community ids', () => {
  assert.deepEqual(togglePickedTopic([], 'moving-abroad', true), ['moving-abroad']);
  assert.deepEqual(togglePickedTopic(['moving-abroad'], 'not-a-topic', true), ['moving-abroad']);
  assert.deepEqual(togglePickedTopic(['moving-abroad', 'family'], 'moving-abroad', false), ['family']);
});

test('real view state derives matches locally without fetching', () => {
  const ui = createCommunityUI();
  const state = buildRealViewState(ui, null);
  assert.equal(state.hasEvents, false);
  assert.ok(Array.isArray(state.matches));
  assert.ok(Array.isArray(state.topics) && state.topics.length > 0);
});

test('year/city filters narrow the local preview and globe, not just the search request', () => {
  const ui = createCommunityUI();
  const row = (id, city, label, year) => ({
    id, pen_name: 'Fictional', title: `Shared ${id}`, passages: ['A shared day of site work.'],
    topics: ['work'], revision: 1, city, event_city: label,
    event_year: year, event_date_text: String(year), lon: 0, lat: 0,
  });
  ui.real.rows = [row('pub-a', 'leeds', 'Leeds', 2019), row('pub-b', 'lisbon', 'Lisbon', 2020)];
  const event = { id: 'e1', category: 'work' };
  assert.equal(buildRealViewState(ui, event).matches.length, 2);
  setDiscoveryFilters(ui.discovery, { city: 'lisbon' });
  const narrowed = buildRealViewState(ui, event);
  assert.deepEqual(narrowed.matches.map((m) => m.publishedId), ['pub-b']);
  assert.equal(narrowed.topicPreviewCount, 1);
  setDiscoveryFilters(ui.discovery, { city: '', fromYear: '2020', toYear: '2020' });
  assert.deepEqual(buildRealViewState(ui, event).matches.map((m) => m.publishedId), ['pub-b']);
});

test('searching excerpts cycle the full bound list in stable order', () => {
  const ui = createCommunityUI();
  const row = (id, summary, revision = 1, coords = {}) => ({
    id, pen_name: 'Fictional', title: `Shared ${id}`, passages: [summary],
    topics: ['work'], revision, city: 'leeds', event_city: 'Leeds',
    event_year: 2019, event_date_text: '2019', lon: 0, lat: 0, ...coords,
    event_summary: `Public summary ${id}.`,
  });
  ui.real.rows = [row('pub-a', 'Carried timber on a small-house site.', 1, {lon: -1.55, lat: 53.8}), row('pub-b', 'Mixed mortar all summer.'), row('pub-c', 'Learned to read a level.', 1, {lon: null})];
  const built = buildDiscoveryCandidates(ui.real.rows, {});
  const began = beginDiscoverySearch(ui.discovery, { query: 'house-building work', candidates: built.candidates, eventId: 'e1', uid: '' });
  assert.equal(began.error, undefined);
  const live = searchingExcerptsFor(ui);
  assert.equal(live.total, 3);
  assert.deepEqual(live.excerpts.map((e) => e.text), [
    'Public summary pub-a.\n\nCarried timber on a small-house site.',
    'Public summary pub-b.\n\nMixed mortar all summer.',
    'Public summary pub-c.\n\nLearned to read a level.',
  ]);
  assert.ok(live.excerpts.every((e) => e.text.length <= 140));
  // Each quote binds its public story id and published coordinates for
  // the origin highlight; missing coordinates stay null, never invented.
  assert.deepEqual(live.excerpts.map((e) => [e.id, e.lon, e.lat]), [
    ['pub-a', -1.55, 53.8],
    ['pub-b', 0, 0],
    ['pub-c', null, 0],
  ]);
  // The card origin label prefers the published city name.
  assert.deepEqual(live.excerpts.map((e) => e.city), ['Leeds', 'Leeds', 'Leeds']);
  // A revised row is skipped, never shown against a stale revision.
  ui.real.rows[0] = { ...ui.real.rows[0], revision: 2 };
  const skipped = searchingExcerptsFor(ui);
  assert.equal(skipped.excerpts.length, 2);
  assert.ok(skipped.excerpts[0].text.includes('pub-b'));
  // A cancelled search shows nothing.
  cancelDiscovery(ui);
  assert.deepEqual(searchingExcerptsFor(ui), { excerpts: [], total: 0 });
});
