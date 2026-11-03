import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLIC_COLUMNS,
  COMMUNITY_TOPICS,
  buildPublishPreview,
  publicCopyOf,
  matchRealStories,
  realMatchGuidance,
  validateRealQuote,
  fetchPublished,
  listMyPublications,
  publishCopy,
  unpublishCopy,
  toggleRealLike,
  loadMyLikes,
  saveCloudQuote,
  saveProfile,
  loadProfile,
  bookPayload,
  bookRevisionOf,
  saveBookDraft,
  loadBookDrafts,
} from '../web/community.js';

// Minimal fake of the Supabase query surface used by community.js.
// Each handler is programmed per test; unprogrammed calls fail loudly.
function fakeClient({ selectImpl, rpcImpl, deleteImpl, insertImpl, upsertImpl }) {
  const chainable = (result) => {
    const c = { ...result };
    c.order = () => chainable(result);
    c.limit = () => chainable(result);
    c.eq = () => chainable(result);
    c.maybeSingle = async () => result;
    return c;
  };
  return {
    from() {
      return {
        select: (...a) => chainable(selectImpl(...a)),
        delete: (...a) => (deleteImpl ? deleteImpl(...a) : { eq: () => ({ eq: async () => ({ error: null }) }) }),
        insert: (...a) => (insertImpl ? insertImpl(...a) : Promise.resolve({ error: null })),
        upsert: (...a) => (upsertImpl ? upsertImpl(...a) : Promise.resolve({ error: null })),
      };
    },
    rpc: (...a) => (rpcImpl ? rpcImpl(...a) : Promise.resolve({ data: null, error: null })),
  };
}

const missingErr = { message: 'relation "public.published_stories" does not exist' };

function projectFixture(overrides = {}) {
  return {
    id: 'story-1',
    title: 'The winter we moved',
    example: false,
    answers: [{ id: 'a1', text: 'We left around 2019.', revision: 1 }],
    story: {
      title: 'The winter we moved',
      passages: [
        { id: 'p1', text: 'We left around 2019, I do not remember exactly.', sourceId: 'a1', sourceRevision: 1, question: 'When?' },
        { id: 'p2', text: 'The train was late and it was snowing.', sourceId: 'a1', sourceRevision: 1, question: 'What?' },
      ],
    },
    ...overrides,
  };
}

function eventFixture(overrides = {}) {
  return {
    id: 'e1', title: 'Moving to Leeds', summary: 'First week in a new city.', dateText: 'around 2019',
    location: 'Leeds, UK', confirmed: true, sourceRefs: [{ answerId: 'a1', revision: 1 }],
    ...overrides,
  };
}

function previewFixture(overrides = {}) {
  const { preview, error } = buildPublishPreview({
    project: projectFixture(),
    penName: 'A. Winter',
    title: 'Winter move',
    passageIds: ['p1', 'p2'],
    eventEntry: eventFixture(),
    cityName: 'leeds',
    topics: ['moving-abroad'],
    occasionId: '',
    ...overrides,
  });
  assert.equal(error, undefined);
  return preview;
}

function publicRowFixture(overrides = {}) {
  return {
    id: 'pub-1', pen_name: 'A. Winter', title: 'Winter move',
    passages: [{ text: 'We left around 2019, I do not remember exactly.' }, { text: 'The train was late.' }],
    event_title: 'Moving to Leeds', event_summary: 'First week.', event_city: 'Leeds',
    city: 'Leeds', lon: -1.55, lat: 53.8, topics: ['moving-abroad'], occasion_id: null,
    revision: 1, like_count: 0, updated_at: '2026-11-02T00:00:00Z',
    ...overrides,
  };
}

test('publish preview requires explicit choices and copies text exactly', () => {
  const base = {
    project: projectFixture(), penName: 'A. Winter', title: 'Winter move',
    passageIds: ['p1'], eventEntry: eventFixture(), cityName: 'leeds', topics: ['moving-abroad'], occasionId: '',
  };
  assert.equal(buildPublishPreview(base).error, undefined);
  assert.match(buildPublishPreview({ ...base, penName: '  ' }).error, /pen name/);
  assert.match(buildPublishPreview({ ...base, penName: 'x'.repeat(41) }).error, /under 40/);
  assert.match(buildPublishPreview({ ...base, title: '' }).error, /title/);
  assert.match(buildPublishPreview({ ...base, passageIds: [] }).error, /at least one passage/);
  assert.match(buildPublishPreview({ ...base, passageIds: ['gone'] }).error, /no longer/);
  assert.match(buildPublishPreview({ ...base, eventEntry: { ...eventFixture(), confirmed: false } }).error, /confirmed event/);
  assert.match(buildPublishPreview({ ...base, cityName: 'Somewhere' }).error, /Choose a city/);
  assert.match(buildPublishPreview({ ...base, cityName: '' }).error, /Choose a city/);
  assert.match(buildPublishPreview({ ...base, topics: [] }).error, /at least one topic/);
  assert.match(buildPublishPreview({ ...base, topics: ['nope'] }).error, /not on the list/);
  assert.match(buildPublishPreview({ ...base, occasionId: 'x'.repeat(81) }).error, /under 80/);
  assert.match(buildPublishPreview({ ...base, project: { ...projectFixture(), example: true } }).error, /Fictional examples/);
  assert.match(buildPublishPreview({ ...base, project: { ...projectFixture(), story: null } }).error, /no finished passages/);
  // Draft events (unconfirmed or stale) stay private.
  const staleEvent = { ...eventFixture(), sourceRefs: [{ answerId: 'a1', revision: 0 }] };
  assert.match(buildPublishPreview({ ...base, eventEntry: staleEvent }).error, /confirmed event/);
});

test('public copy allowlist excludes every private field', () => {
  const preview = previewFixture();
  const copy = publicCopyOf(preview);
  const raw = JSON.stringify({ copy, preview });
  // Allowlisted public fields are present with exact text.
  assert.equal(copy.pen_name, 'A. Winter');
  assert.equal(copy.passages[0].text, 'We left around 2019, I do not remember exactly.');
  assert.deepEqual(copy.topics, ['moving-abroad']);
  assert.equal(copy.city, 'Leeds');
  // Nothing private passes through the public copy.
  for (const key of Object.keys(copy)) assert.ok(PUBLIC_COLUMNS.includes(key), `unexpected public key ${key}`);
  assert.ok(!('storyId' in copy));
  const blob = JSON.stringify(copy);
  assert.doesNotMatch(blob, /story-1/);
  assert.doesNotMatch(blob, /a1/);
  assert.ok(!raw.match(/"answers"|"history"|email|audio|recordings|witness\.stories/));
});

test('matching keeps occasion and similarity distinct, never invents proof', () => {
  const rows = [
    publicRowFixture({ id: 'occ', occasion_id: 'leeds-site-first-day-2019', topics: ['work'], city: 'Leeds' }),
    publicRowFixture({ id: 'sim', topics: ['moving-abroad', 'family'], city: 'Toronto' }),
    publicRowFixture({ id: 'other', topics: ['first-concert'], city: 'Leeds' }),
  ];
  // Explicit occasion match wins even with different topics.
  let found = matchRealStories({ occasionId: 'leeds-site-first-day-2019', topics: ['moving-abroad'] }, rows);
  assert.equal(found.find((m) => m.row.id === 'occ').matchType, 'same_occasion');
  // Same city and year alone never prove the same occasion.
  found = matchRealStories({ occasionId: '', topics: ['moving-abroad'], cityName: 'Leeds' }, rows);
  assert.ok(found.every((m) => m.matchType === 'similar_experience'));
  assert.ok(found.some((m) => m.row.id === 'sim'));
  assert.ok(!found.some((m) => m.row.id === 'occ' && m.matchType === 'same_occasion'));
  // A different occasion id does not match.
  found = matchRealStories({ occasionId: 'other-occasion', topics: ['work'] }, rows);
  assert.ok(!found.some((m) => m.row.id === 'occ' && m.matchType === 'same_occasion'));
  // Similar experience carries evidence in copy.
  const sim = matchRealStories({ occasionId: '', topics: ['family'] }, rows).find((m) => m.row.id === 'sim');
  assert.ok(sim && sim.evidence.some((e) => /Shared topic/.test(e)));
  // Nothing matching reads as empty, with guidance when the selection cannot match.
  assert.deepEqual(matchRealStories({ occasionId: '', topics: ['celebration'] }, rows), []);
  assert.match(realMatchGuidance({ occasionId: '', topics: [] }), /city or date alone/);
  assert.equal(realMatchGuidance({ occasionId: 'x', topics: [] }), '');
  assert.equal(realMatchGuidance({ occasionId: '', topics: ['work'] }), '');
  // Damaged rows never match.
  assert.deepEqual(matchRealStories({ occasionId: 'leeds-site-first-day-2019', topics: ['work'] }, [null, { id: 'bad' }]), []);
});

test('real quotes must match the shared version exactly and cite its revision', () => {
  const row = publicRowFixture();
  const ok = validateRealQuote('around 2019, I do not remember', row, 1);
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.attribution, { author: 'A. Winter', title: 'Winter move', publishedId: 'pub-1', revision: 1 });
  assert.match(validateRealQuote('', row, 1).error, /Select/);
  assert.match(validateRealQuote('invented words', row, 1).error, /exactly/);
  assert.match(validateRealQuote('Around 2019', row, 1).error, /exactly/);
  assert.match(validateRealQuote('x'.repeat(2001), row, 1).error, /too long/);
  // Quotes spanning two passages are not exact.
  assert.match(validateRealQuote('exactly. The train', row, 1).error, /exactly/);
  // A replaced version refuses old quotes until reopened.
  const stale = validateRealQuote('around 2019, I do not remember', { ...row, revision: 2 }, 1);
  assert.match(stale.error, /changed since you opened/);
  assert.equal(stale.stale, true);
  // Withdrawn stories refuse quotes.
  assert.match(validateRealQuote('around 2019', null, 1).error, /no longer shared/);
});

test('public reads request allowlisted columns and report a missing migration honestly', () => {
  let selected = '';
  const client = fakeClient({ selectImpl: (...a) => { selected = String(a[0] || ''); return { data: [], error: null }; } });
  return fetchPublished(client).then((r) => {
    assert.equal(r.ok, true);
    for (const col of selected.split(',')) assert.ok(PUBLIC_COLUMNS.includes(col), `leaked column ${col}`);
    assert.ok(!/owner_id|story_id|email/.test(selected));
  }).then(() => fetchPublished(fakeClient({ selectImpl: () => ({ data: null, error: missingErr }) }))).then((r) => {
    assert.equal(r.ok, false);
    assert.match(r.error, /not been created/);
  });
});

test('publishing needs login, sends no private fields, and surfaces conflicts', async () => {
  const preview = previewFixture();
  const signedOut = await publishCopy(fakeClient({}), { userId: null }, preview, 0);
  assert.equal(signedOut.ok, false);
  assert.match(signedOut.error, /Sign in to publish/);

  let sentArgs = null;
  const client = fakeClient({ rpcImpl: (name, args) => { sentArgs = { name, args }; return { data: { revision: 1, id: 'pub-9' }, error: null }; } });
  const res = await publishCopy(client, { userId: 'u1' }, preview, 0);
  assert.equal(res.ok, true);
  assert.equal(res.revision, 1);
  assert.equal(sentArgs.name, 'witness_publish_story');
  const blob = JSON.stringify(sentArgs.args);
  assert.ok(!/answers|history|email|audio|recordings/.test(blob));
  assert.equal(sentArgs.args.p_expected_revision, 0);

  const conflict = await publishCopy(
    fakeClient({ rpcImpl: () => ({ data: null, error: { message: 'conflict: a newer copy exists' } }) }),
    { userId: 'u1' }, preview, 1,
  );
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflict, true);
  assert.match(conflict.error, /changed since you opened/);
});

test('unpublish, likes, and quotes are owner-scoped and login-gated', async () => {
  const anon = { userId: null };
  assert.match((await unpublishCopy(fakeClient({}), anon, 'pub-1')).error, /Sign in/);
  assert.match((await toggleRealLike(fakeClient({}), anon, 'pub-1', false)).error, /Sign in/);
  assert.match((await saveCloudQuote(fakeClient({}), anon, publicRowFixture(), 'around 2019')).error, /Sign in/);

  // Id-only DELETE: ownership is enforced by the owner-delete RLS policy,
  // since the authenticated role has no SELECT grant on owner_id.
  let deleted = null;
  const delClient = fakeClient({});
  delClient.from = () => ({ delete: () => ({ eq: (k, v) => { deleted = { k, v }; return { error: null }; } }) });
  assert.equal((await unpublishCopy(delClient, { userId: 'u1' }, 'pub-1')).ok, true);
  assert.deepEqual(deleted, { k: 'id', v: 'pub-1' });

  const likeClient = fakeClient({ selectImpl: () => ({}) });
  let inserted = null;
  likeClient.from = () => ({
    select: () => ({ data: [{ published_id: 'pub-1' }], error: null }),
    insert: (row) => { inserted = row; return { error: null }; },
    delete: () => ({ eq: () => ({ eq: () => ({ error: null }) }) }),
  });
  const liked = await toggleRealLike(likeClient, { userId: 'u1' }, 'pub-1', false);
  assert.deepEqual(liked, { ok: true, liked: true });
  assert.equal(inserted.user_id, 'u1');
  assert.equal((await loadMyLikes(likeClient, { userId: 'u1' })).liked.length, 1);
  assert.match((await loadMyLikes(likeClient, anon)).error, /Sign in/);

  // Fabricated quotes never reach the server; stale ones surface first.
  let rpcCalled = false;
  const quoteClient = fakeClient({ rpcImpl: () => { rpcCalled = true; return { error: null }; } });
  const row = publicRowFixture();
  assert.match((await saveCloudQuote(quoteClient, { userId: 'u1' }, row, 'made up')).error, /exactly/);
  assert.equal(rpcCalled, false);
  assert.match((await saveCloudQuote(quoteClient, { userId: 'u1' }, { ...row, revision: 2 }, 'around 2019', 1)).error, /changed since/);
  const saved = await saveCloudQuote(quoteClient, { userId: 'u1' }, row, 'around 2019, I do not remember');
  assert.equal(saved.ok, true);
  assert.equal(saved.attribution.author, 'A. Winter');
});

test('profiles remember a pen name without exposing it publicly', async () => {
  assert.match((await saveProfile(fakeClient({}), { userId: null }, 'A. Winter')).error, /Sign in/);
  assert.match((await saveProfile(fakeClient({}), { userId: 'u1' }, '  ')).error, /pen name first/);
  assert.match((await saveProfile(fakeClient({}), { userId: 'u1' }, 'x'.repeat(41))).error, /under 40/);
  let upserted = null;
  const client = fakeClient({});
  client.from = () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { display_name: 'A. Winter' }, error: null }) }) }),
    upsert: (row) => { upserted = row; return { error: null }; },
  });
  assert.deepEqual(await loadProfile(client, { userId: 'u1' }), { ok: true, displayName: 'A. Winter' });
  assert.equal((await saveProfile(client, { userId: 'u1' }, 'A. Winter')).ok, true);
  assert.equal(upserted.user_id, 'u1');
  assert.ok(!('email' in upserted));
});

test('book cloud copies stay text-only, owner-scoped, and conflict-safe', async () => {
  const book = { id: 'book-1', title: 'Mine', chapters: [], cloudRevision: 2, cloudOwnerId: 'u2' };
  assert.equal(bookRevisionOf(book, 'u1'), 0);
  assert.equal(bookRevisionOf(book, 'u2'), 2);
  const payload = bookPayload(book);
  assert.ok(!('cloudRevision' in payload || 'cloudOwnerId' in payload));

  assert.match((await saveBookDraft(fakeClient({}), { userId: null }, book)).error, /Sign in/);
  let sent = null;
  const client = fakeClient({ rpcImpl: (name, args) => { sent = { name, args }; return { data: { revision: 3 }, error: null }; } });
  assert.deepEqual(await saveBookDraft(client, { userId: 'u1' }, book), { ok: true, revision: 3 });
  assert.equal(sent.name, 'witness_save_book');
  assert.equal(sent.args.p_expected_revision, 0);
  const conflict = await saveBookDraft(
    fakeClient({ rpcImpl: () => ({ data: null, error: { message: 'conflict: newer copy' } }) }),
    { userId: 'u1' }, book,
  );
  assert.equal(conflict.conflict, true);

  const rows = fakeClient({ selectImpl: () => ({ data: [{ id: 'book-1', owner_id: 'u1' }, { id: 'x', owner_id: 'u2' }], error: null }) });
  rows.from = () => ({ select: () => ({ order: async () => ({ data: [{ id: 'book-1', owner_id: 'u1' }, { id: 'x', owner_id: 'u2' }], error: null }) }) });
  assert.deepEqual((await loadBookDrafts(rows, { userId: 'u1' })).rows.map((r) => r.id), ['book-1']);
  assert.match((await listMyPublications(fakeClient({ rpcImpl: () => ({ data: null, error: missingErr }) }), { userId: 'u1' })).error, /not been created/);
});

test('owner publication list comes from the owner RPC and stays owner-scoped', async () => {
  let rpcName = '';
  const client = fakeClient({
    rpcImpl: (name) => {
      rpcName = name;
      return { data: [{ id: 'a', owner_id: 'u1' }, { id: 'b', owner_id: 'u2' }], error: null };
    },
  });
  const res = await listMyPublications(client, { userId: 'u1' });
  assert.equal(rpcName, 'witness_my_publications');
  assert.deepEqual(res.rows.map((r) => r.id), ['a']);
  assert.match((await listMyPublications(client, { userId: null })).error, /Sign in/);
});

test('community topics stay a small explicit list', () => {
  assert.ok(COMMUNITY_TOPICS.length <= 8);
  assert.ok(COMMUNITY_TOPICS.every((t) => /^[a-z][a-z0-9-]{0,39}$/.test(t.id) && t.label));
});
