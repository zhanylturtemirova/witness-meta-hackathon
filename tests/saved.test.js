import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addQuote, removeQuote, purgeProjectQuotes, toggleLike, isLiked,
  loadCollection, storeCollection, validateQuoteText, validateStorySelection,
  cleanSelectionText, quoteIdentity, dedupeQuotes,
  SAVED_KEY, LIKES_KEY, MAX_SAVED, MAX_QUOTE_LENGTH
} from '../web/saved.js';
import { STARTER_CHOICES, starterChoice } from '../web/domain.js';

function fakeStorage(initial = {}, failures = {}) {
  const data = { ...initial };
  return {
    getItem(k) { if (failures.get) throw new Error('denied'); return k in data ? data[k] : null; },
    setItem(k, v) { if (failures.set) throw new Error('quota'); data[k] = String(v); },
    _data: data
  };
}

const PARA_A = 'For the first month, I knew the city by the route between my flat and the supermarket.';
const PARA_B = 'One morning, the woman at the bakery remembered my order.';

test('quote validation keeps exact wording and rejects invented text', () => {
  assert.equal(validateQuoteText('flat and the supermarket', PARA_A), null);
  assert.equal(validateQuoteText('  flat and the supermarket  ', PARA_A), null);
  assert.match(validateQuoteText('', PARA_A), /Select/);
  assert.match(validateQuoteText('   ', PARA_A), /Select/);
  assert.match(validateQuoteText('a different sentence', PARA_A), /exactly/);
  // Case changes are not exact: the story text is kept verbatim.
  assert.match(validateQuoteText('Flat And The Supermarket', PARA_A), /exactly/);
  assert.match(validateQuoteText('x'.repeat(MAX_QUOTE_LENGTH + 1), 'x'.repeat(MAX_QUOTE_LENGTH + 1)), /too long/);
});

test('story selection validation restricts saves to visible paragraphs', () => {
  const paras = [PARA_A, PARA_B];
  assert.equal(validateStorySelection('remembered my order', paras), null);
  assert.match(validateStorySelection('', paras), /Select/);
  assert.match(validateStorySelection('words from the page heading', paras), /this story only/);
  assert.match(validateStorySelection('text from another story', paras), /this story only/);
  assert.equal(validateStorySelection('  remembered my order ', paras), null);
  assert.match(validateStorySelection('x'.repeat(MAX_QUOTE_LENGTH + 1), ['x'.repeat(MAX_QUOTE_LENGTH + 1)]), /too long/);
  assert.match(validateStorySelection('order', []), /no story text/);
});

test('identity and dedupe treat same source version and wording as one save', () => {
  const base = { text: PARA_B, author: 'Elena M.', sourceTitle: 'T', sourceKind: 'shared-fictional', sourceId: 'elena', sourceRevision: null };
  let list = [];
  let r = addQuote(list, base);
  assert.ok(r.saved && !r.error && !r.duplicate);
  list = r.list;
  r = addQuote(list, { ...base, text: '  ' + PARA_B + ' ' });
  assert.ok(r.duplicate && r.list.length === 1);
  // A different wording is a separate save.
  r = addQuote(list, { ...base, text: 'the woman at the bakery' });
  assert.ok(r.saved && !r.duplicate && r.list.length === 2);
  list = r.list;
  // Corrupt entries are dropped, order of valid ones kept.
  const mixed = [...list, null, { id: 'bad' }, { ...base, id: 'x', text: PARA_A, sourceId: 'elena' }];
  assert.equal(dedupeQuotes(mixed).length, 3);
  assert.equal(quoteIdentity(base), quoteIdentity({ ...base, id: 'other' }));
});

test('collection caps stay reasonable and report visibly', () => {
  const full = Array.from({ length: MAX_SAVED }, (_, i) => ({
    id: 'q' + i, text: 'phrase ' + i, author: 'A', sourceTitle: 'T',
    sourceKind: 'shared-fictional', sourceId: 's' + i, sourceRevision: null, createdAt: 1
  }));
  const r = addQuote(full, { text: 'one more', author: 'A', sourceTitle: 'T', sourceKind: 'shared-fictional', sourceId: 'extra', sourceRevision: null });
  assert.match(r.error, /full/);
  assert.equal(r.list.length, MAX_SAVED);
  const bad = addQuote([], { text: '', author: 'A', sourceTitle: 'T', sourceKind: 'shared-fictional', sourceId: 'x', sourceRevision: null });
  assert.match(bad.error, /Select/);
});

test('persistence failures surface a useful message and never throw', () => {
  const store = fakeStorage();
  assert.equal(storeCollection(store, SAVED_KEY, [{ id: 'a' }]), '');
  assert.deepEqual(JSON.parse(store._data[SAVED_KEY]), { version: 1, items: [{ id: 'a' }] });
  assert.match(storeCollection(fakeStorage({}, { set: true }), SAVED_KEY, []), /could not keep/);
  assert.deepEqual(loadCollection(fakeStorage({ [SAVED_KEY]: 'not json{{' }), SAVED_KEY).list, []);
  assert.match(loadCollection(fakeStorage({ [SAVED_KEY]: 'not json{{' }), SAVED_KEY).error, /could not be opened/);
  assert.deepEqual(loadCollection(fakeStorage({ [SAVED_KEY]: '{"version":1}' }), SAVED_KEY).list, []);
  assert.match(storeCollection(fakeStorage({}, { set: true }), LIKES_KEY, ['a']), /could not keep/);
  // Likes read back as plain ids only.
  const liked = loadCollection(fakeStorage({ [LIKES_KEY]: JSON.stringify(['a', 'b', 42, null]) }), LIKES_KEY);
  assert.deepEqual(liked.list, ['a', 'b']);
});

test('unknown storage versions never silently overwrite existing storage', () => {
  const raw = JSON.stringify({ version: 2, items: [{ id: 'a' }] });
  const store = fakeStorage({ [SAVED_KEY]: raw });
  const r = loadCollection(store, SAVED_KEY);
  assert.deepEqual(r.list, []);
  assert.match(r.error, /could not be opened/);
  assert.equal(store._data[SAVED_KEY], raw);
});

test('invalid saved source shapes never silently overwrite existing storage', () => {
  const raw = JSON.stringify({ version: 1, items: [{ id: 'bad' }] });
  const store = fakeStorage({ [SAVED_KEY]: raw });
  const r = loadCollection(store, SAVED_KEY);
  assert.deepEqual(r.list, []);
  assert.match(r.error, /could not be opened/);
  assert.equal(store._data[SAVED_KEY], raw);
});

test('addQuote reports empty and oversize text before source validation', () => {
  const noSource = { author: 'A', sourceTitle: 'T', sourceKind: 'bogus', sourceId: '' };
  assert.match(addQuote([], { ...noSource, text: '   ' }).error, /Select/);
  assert.match(addQuote([], { ...noSource, text: 'x'.repeat(MAX_QUOTE_LENGTH + 1) }).error, /too long/);
});

test('deleting a private own story purges its saved private quotations', () => {
  const own = { text: 'my own words here', author: 'You', sourceTitle: 'My story', sourceKind: 'own', sourceId: 'pass-1', sourceRevision: 1, projectId: 'proj-1' };
  const other = { text: PARA_B, author: 'Elena M.', sourceTitle: 'T', sourceKind: 'shared-fictional', sourceId: 'elena', sourceRevision: null, projectId: null };
  const otherProject = { ...own, id: 'q3', sourceId: 'pass-9', projectId: 'proj-2', text: 'other project words' };
  let list = [];
  for (const q of [own, other, otherProject]) list = addQuote(list, q).list;
  assert.equal(list.length, 3);
  const kept = purgeProjectQuotes(list, 'proj-1');
  assert.equal(kept.length, 2);
  assert.ok(kept.every(q => q.projectId !== 'proj-1' || q.sourceKind !== 'own'));
  // Shared fictional saves survive; other projects survive.
  assert.ok(kept.some(q => q.sourceKind === 'shared-fictional'));
  assert.ok(kept.some(q => q.projectId === 'proj-2'));
  assert.equal(removeQuote(kept, kept[0].id).length, 1);
});

test('likes are on-device ids with no totals or accounts', () => {
  let likes = [];
  let r = toggleLike(likes, 'elena');
  assert.ok(r.liked && isLiked(r.likes, 'elena'));
  likes = r.likes;
  r = toggleLike(likes, 'elena');
  assert.ok(!r.liked && !isLiked(r.likes, 'elena') && r.likes.length === 0);
});

test('starter choices bind one exact prompt with no network', () => {
  assert.ok(STARTER_CHOICES.length === 5);
  for (const c of STARTER_CHOICES) {
    assert.ok(c.question.length > 20);
    assert.ok(['turning-point', 'person', 'small-moment'].includes(c.topic));
    assert.equal(starterChoice(c.id), c);
  }
  assert.equal(starterChoice('nope'), null);
  assert.equal(cleanSelectionText(null), '');
});
