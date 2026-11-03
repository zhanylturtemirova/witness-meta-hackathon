import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOKS_KEY,
  blankBook,
  finishedStories,
  buildChapter,
  addChapter,
  setBookTitle,
  setChapterHeading,
  moveChapter,
  excludeChapter,
  includeChapter,
  removeChapter,
  chapterStatus,
  refreshChapter,
  exportBookMarkdown,
  validateBook,
  loadBooks,
  storeBooks,
} from '../web/biography.js';

function fakeStorage(initial = {}, failures = {}) {
  const data = { ...initial };
  return {
    getItem(k) { if (failures.get) throw new Error('denied'); return k in data ? data[k] : null; },
    setItem(k, v) { if (failures.set) throw new Error('quota'); data[k] = String(v); },
    _data: data,
  };
}

function storyProject(overrides = {}) {
  return {
    id: 'story-1',
    title: 'The winter we moved',
    example: false,
    answers: [
      { id: 'a1', text: 'We left around 2019, I do not remember exactly.', revision: 1 },
      { id: 'a2', text: 'The train was late and it was snowing.', revision: 2 },
    ],
    story: {
      title: 'The winter we moved',
      passages: [
        { id: 'p1', text: 'We left around 2019, I do not remember exactly.', sourceId: 'a1', sourceRevision: 1, sourceText: 'We left around 2019, I do not remember exactly.', question: 'When?', edited: false },
        { id: 'p2', text: 'The train was late and it was snowing.', sourceId: 'a2', sourceRevision: 2, sourceText: 'The train was late.', question: 'What?', edited: true },
      ],
    },
    ...overrides,
  };
}

test('only finished own stories can become chapters', () => {
  const finished = storyProject();
  const list = finishedStories([
    finished,
    storyProject({ id: 'draft', story: null }),
    storyProject({ id: 'fiction', example: true }),
    null,
  ]);
  assert.deepEqual(list.map((p) => p.id), ['story-1']);
});

test('assembly copies wording, uncertainty, source ids, revisions, and story id', () => {
  const p = storyProject();
  const before = JSON.stringify(p);
  const { chapter, error } = buildChapter(p);
  assert.equal(error, undefined);
  assert.equal(chapter.storyId, 'story-1');
  assert.equal(chapter.sources.length, 2);
  assert.equal(chapter.sources[0].text, 'We left around 2019, I do not remember exactly.');
  assert.equal(chapter.sources[0].sourceId, 'a1');
  assert.equal(chapter.sources[0].sourceRevision, 1);
  assert.equal(chapter.sources[1].passageId, 'p2');
  // The original story is untouched by assembly.
  assert.equal(JSON.stringify(p), before);
});

test('adding chapters, ordering, excluding, and re-adding', () => {
  let book = blankBook('My life');
  const a = storyProject();
  const b = storyProject({ id: 'story-2', title: 'Second', story: { title: 'Second', passages: [{ id: 'q1', text: 'Hello.', sourceId: 'a1', sourceRevision: 1, question: '', edited: false }] } });
  book = addChapter(book, a).book;
  book = addChapter(book, b).book;
  assert.deepEqual(book.chapters.map((c) => c.storyId), ['story-1', 'story-2']);
  const dup = addChapter(book, a);
  assert.match(dup.error, /already a chapter/);
  assert.equal(dup.book.chapters.length, 2);

  book = moveChapter(book, 'story-2' && book.chapters[1].id, -1).book;
  assert.deepEqual(book.chapters.map((c) => c.storyId), ['story-2', 'story-1']);
  assert.match(moveChapter(book, book.chapters[0].id, -1).error, /already first/);
  assert.match(moveChapter(book, book.chapters[1].id, 1).error, /already last/);

  const firstId = book.chapters[0].id;
  book = excludeChapter(book, firstId).book;
  assert.equal(book.chapters[0].excluded, true);
  // Excluded chapters keep their place; re-adding restores order.
  book = includeChapter(book, firstId).book;
  assert.deepEqual(book.chapters.map((c) => c.storyId), ['story-2', 'story-1']);
  assert.equal(book.chapters[0].excluded, false);

  book = removeChapter(book, firstId).book;
  assert.deepEqual(book.chapters.map((c) => c.storyId), ['story-1']);
  assert.match(removeChapter(book, 'nope').error, /no longer here/);
});

test('title and heading validation', () => {
  const book = blankBook();
  assert.match(setBookTitle(book, '   ').error, /title first/);
  assert.match(setBookTitle(book, 'x'.repeat(121)).error, /under 120/);
  let b = setBookTitle(book, '  A good title  ').book;
  assert.equal(b.title, 'A good title');
  b = addChapter(b, storyProject()).book;
  const id = b.chapters[0].id;
  assert.match(setChapterHeading(b, id, '  ').error, /heading first/);
  assert.match(setChapterHeading(b, id, 'y'.repeat(121)).error, /under 120/);
  assert.match(setChapterHeading(b, 'missing', 'Hi').error, /no longer here/);
  b = setChapterHeading(b, id, '  Winter  ').book;
  assert.equal(b.chapters[0].heading, 'Winter');
});

test('source edits mark chapters stale, deletion marks them missing, refresh is explicit', () => {
  let book = addChapter(blankBook('B'), storyProject()).book;
  const id = book.chapters[0].id;
  const projects = [storyProject()];
  assert.equal(chapterStatus(book.chapters[0], projects), 'ok');

  // Editing a passage makes the chapter stale, but the wording is kept.
  projects[0].story.passages[0].text = 'We left in 2019 exactly.';
  assert.equal(chapterStatus(book.chapters[0], projects), 'stale');
  assert.equal(book.chapters[0].sources[0].text, 'We left around 2019, I do not remember exactly.');

  // A moved source answer revision is stale even when the passage matches.
  projects[0].story.passages[0].text = book.chapters[0].sources[0].text;
  projects[0].answers[0].revision = 2;
  assert.equal(chapterStatus(book.chapters[0], projects), 'stale');

  // Removing a passage is stale, not silent deletion.
  projects[0].answers[0].revision = 1;
  projects[0].story.passages = projects[0].story.passages.slice(1);
  assert.equal(chapterStatus(book.chapters[0], projects), 'stale');

  // Explicit refresh picks up the current wording and keeps the heading.
  book = setChapterHeading(book, id, 'My heading').book;
  book = refreshChapter(book, id, projects).book;
  assert.equal(book.chapters[0].sources.length, 1);
  assert.equal(book.chapters[0].heading, 'My heading');
  assert.equal(chapterStatus(book.chapters[0], projects), 'ok');

  // A deleted story (or a story without a draft) reads as missing.
  assert.equal(chapterStatus(book.chapters[0], []), 'missing');
  assert.equal(chapterStatus(book.chapters[0], [{ ...projects[0], story: null }]), 'missing');
  const kept = refreshChapter(book, id, []);
  assert.match(kept.error, /kept/);
  assert.equal(kept.book.chapters[0].sources.length, 1);
});

test('export writes headings, wording, and source references; excluded chapters stay out', () => {
  let book = setBookTitle(blankBook(), 'A life').book;
  const a = storyProject();
  book = addChapter(book, a).book;
  const b = storyProject({ id: 'story-2', title: 'Second', story: { title: 'Second', passages: [{ id: 'q1', text: 'Hello.', sourceId: 'a9', sourceRevision: 3, question: 'Q?', edited: false }] } });
  book = addChapter(book, b).book;
  book = excludeChapter(book, book.chapters[1].id).book;
  const md = exportBookMarkdown(book, [a, b]);
  assert.match(md, /^# A life/m);
  assert.match(md, /## 1\. The winter we moved/);
  assert.match(md, /around 2019, I do not remember exactly/);
  assert.match(md, /passage p1 \(answer a1, revision 1\)/);
  assert.match(md, /Story story-1/);
  assert.doesNotMatch(md, /Hello\./);
  assert.throws(() => exportBookMarkdown({ ...book, chapters: book.chapters.map((c) => ({ ...c, excluded: true })) }), /at least one chapter/);
});

test('export marks stale chapters honestly', () => {
  let book = setBookTitle(blankBook(), 'A life').book;
  const p = storyProject();
  book = addChapter(book, p).book;
  p.story.passages[0].text = 'Changed later.';
  const md = exportBookMarkdown(book, [p]);
  assert.match(md, /sources changed since this chapter was gathered/);
});

test('book storage round-trips, rejects damage, and reports failures', () => {
  const storage = fakeStorage();
  let book = setBookTitle(blankBook('Mine'), 'Mine').book;
  book = addChapter(book, storyProject()).book;
  assert.equal(storeBooks(storage, [book]), '');
  const loaded = loadBooks(storage);
  assert.equal(loaded.error, '');
  assert.deepEqual(loaded.books, [book]);
  assert.equal(JSON.parse(storage._data[BOOKS_KEY]).version, 1);

  assert.deepEqual(loadBooks(fakeStorage()).books, []);
  const damaged = fakeStorage({ [BOOKS_KEY]: JSON.stringify({ version: 1, items: [{ id: 1 }] }) });
  const bad = loadBooks(damaged);
  assert.deepEqual(bad.books, []);
  assert.match(bad.error, /could not be opened/);
  assert.match(loadBooks(fakeStorage({}, { get: true })).error, /could not be opened/);
  assert.match(storeBooks(fakeStorage({}, { set: true }), [book]), /could not keep/);
  assert.match(validateBook({}), /could not be opened/);
  assert.match(validateBook({ ...book, chapters: [{ ...book.chapters[0], heading: '  ' }] }), /heading/);
});

test('chapters go stale on added passages, reordered passages, and changed source binding', () => {
  let book = addChapter(blankBook('B'), storyProject()).book;
  const chapter = () => book.chapters[0];

  // A newly added passage is stale even though every old passage matches.
  const added = storyProject();
  added.story.passages = [...added.story.passages, { id: 'p3', text: 'A new memory surfaced.', sourceId: 'a2', sourceRevision: 2, question: 'More?', edited: false }];
  assert.equal(chapterStatus(chapter(), [added]), 'stale');

  // Reordering with identical wording is stale.
  const reordered = storyProject();
  reordered.story.passages = [reordered.story.passages[1], reordered.story.passages[0]];
  assert.equal(chapterStatus(chapter(), [reordered]), 'stale');

  // Rebinding a passage to another answer is stale even when text matches.
  const rebound = storyProject();
  rebound.story.passages = rebound.story.passages.map((s) => ({ ...s }));
  rebound.story.passages[0] = { ...rebound.story.passages[0], sourceId: 'a2' };
  assert.equal(chapterStatus(chapter(), [rebound]), 'stale');

  // A changed sourceRevision on the passage is stale even when text matches.
  const revised = storyProject();
  revised.story.passages = revised.story.passages.map((s) => ({ ...s }));
  revised.story.passages[1] = { ...revised.story.passages[1], sourceRevision: 99 };
  assert.equal(chapterStatus(chapter(), [revised]), 'stale');

  // Untouched stories stay fresh.
  assert.equal(chapterStatus(chapter(), [storyProject()]), 'ok');
});

test('validateBook bounds chapters, sources, text lengths, and revisions', () => {
  const good = addChapter(setBookTitle(blankBook(), 'Mine').book, storyProject()).book;
  assert.equal(validateBook(good), null);
  const manyChapters = { ...good, chapters: Array.from({ length: 201 }, (_, i) => ({ ...good.chapters[0], id: `c-${i}` })) };
  assert.match(validateBook(manyChapters), /too many chapters/);
  const manySources = {
    ...good,
    chapters: [{ ...good.chapters[0], sources: Array.from({ length: 501 }, (_, i) => ({ ...good.chapters[0].sources[0], passageId: `p-${i}` })) }],
  };
  assert.match(validateBook(manySources), /too many passages/);
  const longText = {
    ...good,
    chapters: [{ ...good.chapters[0], sources: [{ ...good.chapters[0].sources[0], text: 'x'.repeat(20001) }] }],
  };
  assert.match(validateBook(longText), /too long/);
  const badRevision = {
    ...good,
    chapters: [{ ...good.chapters[0], sources: [{ ...good.chapters[0].sources[0], sourceRevision: '1' }] }],
  };
  assert.match(validateBook(badRevision), /damaged/);
  const missingRevision = {
    ...good,
    chapters: [{ ...good.chapters[0], sources: [{ ...good.chapters[0].sources[0], sourceRevision: undefined }] }],
  };
  assert.match(validateBook(missingRevision), /damaged/);
});

test('book storage keeps corrupt collections, reports missing storage, and blocks stale tabs', () => {
  const storage = fakeStorage();
  let book = setBookTitle(blankBook('Mine'), 'Mine').book;
  book = addChapter(book, storyProject()).book;
  assert.equal(storeBooks(storage, [book]), '');
  const first = loadBooks(storage);
  assert.equal(first.error, '');

  // A second tab reading now, then saving after this tab saved again, is refused.
  const staleRead = first.raw;
  const renamed = setBookTitle(book, 'Mine, revised').book;
  assert.equal(storeBooks(storage, [renamed], first.raw), '');
  const newer = loadBooks(storage);
  assert.deepEqual(newer.books, [renamed]);
  assert.equal(storeBooks(storage, [], staleRead), 'Your books changed in another tab. Reload them before saving — nothing was overwritten.');
  assert.deepEqual(loadBooks(storage).books, [renamed]);

  // Corrupt data is preserved, never overwritten by a blind save.
  const corrupt = fakeStorage({ [BOOKS_KEY]: '{not json' });
  const bad = loadBooks(corrupt);
  assert.match(bad.error, /could not be opened/);
  assert.equal(bad.corruptRaw, '{not json');
  const backupKeys = Object.keys(corrupt._data).filter((k) => k.startsWith(`${BOOKS_KEY}.corrupt-`));
  assert.equal(backupKeys.length, 1);
  assert.equal(corrupt._data[backupKeys[0]], '{not json');
  assert.equal(corrupt._data[BOOKS_KEY], '{not json');

  // Storage without setItem reports failure instead of silent success.
  const noSet = { getItem: () => null };
  assert.match(storeBooks(noSet, [book]), /could not keep/);
  const noGet = { setItem: () => {} };
  assert.match(storeBooks(noGet, [book]), /could not keep/);
});
