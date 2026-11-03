// My book: gather finished local stories into a readable biography draft.
//
// Local-first and model-free: chapters are assembled by copying the
// narrator's current story passages verbatim — no AI rewriting, no
// network. Each chapter keeps the exact passage wording, the source
// answer IDs and revisions, and the story ID it came from, so the
// narrator can always trace a chapter back to what they said.
//
// The original stories are never mutated: every function below treats
// its inputs as read-only and returns fresh objects. When a source
// story changes (or is deleted), chapters go stale/missing and wait
// for an explicit refresh — a refresh never happens silently.
export const BOOKS_KEY = 'witness.books.v1';
export const MAX_BOOKS = 20;
export const MAX_BOOK_TITLE = 120;
export const MAX_CHAPTER_HEADING = 120;
export const MAX_CHAPTERS_PER_BOOK = 200;
export const MAX_SOURCES_PER_CHAPTER = 500;
export const MAX_SOURCE_TEXT = 20000;

function uuid() {
  try {
    return crypto.randomUUID();
  } catch {
    return 'book-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
  }
}

// A story counts as finished when it holds at least one story passage.
// Drafts, answer-only conversations, and fictional previews used without
// a story draft are left out of the picker.
export function finishedStories(projects) {
  return (Array.isArray(projects) ? projects : []).filter(
    (p) => p && !p.example && Array.isArray(p.story?.passages) && p.story.passages.length > 0,
  );
}

export function blankBook(title = '') {
  const now = Date.now();
  return {
    id: uuid(),
    title: String(title ?? '').trim().slice(0, MAX_BOOK_TITLE),
    createdAt: now,
    updatedAt: now,
    cloudRevision: 0,
    cloudOwnerId: null,
    chapters: [],
  };
}

// Snapshot one finished story into a chapter. The snapshot keeps the
// narrator's current passage wording exactly (including uncertain
// phrasing such as "around that time"), plus the passage ID, the
// source answer ID and revision, and the story ID.
export function buildChapter(project) {
  if (!project || !Array.isArray(project.story?.passages) || !project.story.passages.length)
    return { error: 'That story has no finished passages yet. Nothing was added.' };
  return {
    chapter: {
      id: uuid(),
      storyId: project.id,
      storyTitle: project.story.title || project.title || 'Untitled story',
      heading: project.story.title || project.title || 'Untitled story',
      excluded: false,
      updatedAt: Date.now(),
      sources: project.story.passages.map((s) => ({
        passageId: s.id,
        sourceId: s.sourceId,
        sourceRevision: s.sourceRevision,
        question: s.question || '',
        text: s.text,
      })),
    },
  };
}

export function addChapter(book, project) {
  if (!book || !Array.isArray(book.chapters)) return { book, error: 'This book could not be opened.' };
  if (!project) return { book, error: 'Choose a finished story first.' };
  if ((book.chapters || []).some((c) => c.storyId === project.id && !c.excluded))
    return { book, error: 'That story is already a chapter. Nothing was added.' };
  const { chapter, error } = buildChapter(project);
  if (error) return { book, error };
  return { book: { ...book, chapters: [...book.chapters, chapter], updatedAt: Date.now() } };
}

export function setBookTitle(book, title) {
  const clean = String(title ?? '').trim();
  if (!clean) return { book, error: 'Give your book a title first.' };
  if (clean.length > MAX_BOOK_TITLE)
    return { book, error: `Keep the title under ${MAX_BOOK_TITLE} characters.` };
  return { book: { ...book, title: clean, updatedAt: Date.now() } };
}

export function setChapterHeading(book, chapterId, heading) {
  const clean = String(heading ?? '').trim();
  if (!clean) return { book, error: 'Give the chapter a heading first.' };
  if (clean.length > MAX_CHAPTER_HEADING)
    return { book, error: `Keep chapter headings under ${MAX_CHAPTER_HEADING} characters.` };
  const chapters = book.chapters.map((c) =>
    c.id === chapterId ? { ...c, heading: clean, updatedAt: Date.now() } : c,
  );
  if (!book.chapters.some((c) => c.id === chapterId)) return { book, error: 'That chapter is no longer here.' };
  return { book: { ...book, chapters, updatedAt: Date.now() } };
}

// Keyboard-accessible ordering: native move up/down buttons call this
// with -1/+1. Excluded chapters keep their place so re-adding a
// chapter restores it where the narrator left it.
export function moveChapter(book, chapterId, direction) {
  const index = book.chapters.findIndex((c) => c.id === chapterId);
  if (index < 0) return { book, error: 'That chapter is no longer here.' };
  const target = index + (direction < 0 ? -1 : 1);
  if (target < 0 || target >= book.chapters.length)
    return { book, error: direction < 0 ? 'That chapter is already first.' : 'That chapter is already last.' };
  const chapters = [...book.chapters];
  [chapters[index], chapters[target]] = [chapters[target], chapters[index]];
  return { book: { ...book, chapters, updatedAt: Date.now() } };
}

export function excludeChapter(book, chapterId) {
  return setExcluded(book, chapterId, true);
}

export function includeChapter(book, chapterId) {
  return setExcluded(book, chapterId, false);
}

function setExcluded(book, chapterId, excluded) {
  if (!book.chapters.some((c) => c.id === chapterId))
    return { book, error: 'That chapter is no longer here.' };
  const chapters = book.chapters.map((c) =>
    c.id === chapterId ? { ...c, excluded, updatedAt: Date.now() } : c,
  );
  return { book: { ...book, chapters, updatedAt: Date.now() } };
}

export function removeChapter(book, chapterId) {
  if (!book.chapters.some((c) => c.id === chapterId))
    return { book, error: 'That chapter is no longer here.' };
  return {
    book: { ...book, chapters: book.chapters.filter((c) => c.id !== chapterId), updatedAt: Date.now() },
  };
}

// Freshness is computed, never stored: 'ok' when the chapter still holds
// the story's passages in the same order with the same wording and the
// same source binding (passage id, source answer id, source revision);
// 'stale' when a passage was added, removed, reordered, edited, rebound
// to another answer, or its source answer moved on (the chapter keeps
// its earlier wording until the narrator explicitly refreshes);
// 'missing' when the story or its story draft is gone.
export function chapterStatus(chapter, projects) {
  const project = (Array.isArray(projects) ? projects : []).find((p) => p && p.id === chapter?.storyId);
  if (!project || !Array.isArray(project.story?.passages)) return 'missing';
  const live = project.story.passages;
  const snap = Array.isArray(chapter?.sources) ? chapter.sources : null;
  if (!snap) return 'stale';
  if (snap.length !== live.length) return 'stale';
  for (let i = 0; i < snap.length; i++) {
    const s = snap[i];
    const l = live[i];
    if (!s || !l) return 'stale';
    if (s.passageId !== l.id) return 'stale';
    if (l.text !== s.text) return 'stale';
    if ((l.sourceId ?? null) !== (s.sourceId ?? null)) return 'stale';
    if ((l.sourceRevision ?? null) !== (s.sourceRevision ?? null)) return 'stale';
    const answer = (project.answers || []).find((a) => a.id === s.sourceId);
    if (answer && answer.revision !== s.sourceRevision) return 'stale';
  }
  return 'ok';
}

// Explicit refresh only: re-snapshot the chapter from the story's
// current passages. The narrator's chapter heading and place in the
// order are kept; only the passage wording and source revisions move.
export function refreshChapter(book, chapterId, projects) {
  const chapter = book.chapters.find((c) => c.id === chapterId);
  if (!chapter) return { book, error: 'That chapter is no longer here.' };
  const project = (Array.isArray(projects) ? projects : []).find((p) => p && p.id === chapter.storyId);
  if (!project) return { book, error: 'Its story is gone from this browser. The chapter wording was kept.' };
  const { chapter: fresh, error } = buildChapter(project);
  if (error) return { book, error: 'Its story has no passages right now. The chapter wording was kept.' };
  const chapters = book.chapters.map((c) =>
    c.id === chapterId
      ? { ...c, storyTitle: fresh.storyTitle, sources: fresh.sources, updatedAt: Date.now() }
      : c,
  );
  return { book: { ...book, chapters, updatedAt: Date.now() } };
}

// Readable Markdown export: title, chapter headings in order, passage
// text with source references (story, answer ID, revision). Excluded
// chapters are left out; stale chapters say so honestly.
export function exportBookMarkdown(book, projects = []) {
  if (!book) throw new Error('There is no book to export yet.');
  const included = (book.chapters || []).filter((c) => !c.excluded);
  if (!included.length) throw new Error('Add at least one chapter first.');
  const lines = [`# ${book.title || 'Untitled book'}`, ''];
  lines.push('Gathered in Witness from the narrator\u2019s own stories. Wording is the narrator\u2019s own; uncertain dates and phrasing are kept as written.', '');
  included.forEach((chapter, index) => {
    const status = chapterStatus(chapter, projects);
    lines.push(`## ${index + 1}. ${chapter.heading || 'Untitled chapter'}`, '');
    for (const snap of chapter.sources || []) lines.push(snap.text, '');
    const refs = (chapter.sources || []).map(
      (s) => `- Story ${chapter.storyId}, passage ${s.passageId} (answer ${s.sourceId}, revision ${s.sourceRevision})`,
    );
    const sourceLine =
      status === 'ok'
        ? `Sources: ${chapter.storyTitle} —`
        : status === 'stale'
          ? `Sources: ${chapter.storyTitle} — some sources changed since this chapter was gathered; refresh the chapter to use the current wording —`
          : `Sources: ${chapter.storyTitle} — its story is no longer on this device; the wording above is what was gathered —`;
    lines.push(sourceLine);
    lines.push(...refs, '');
  });
  return lines.join('\n');
}

export function validateBook(book) {
  if (!book || typeof book !== 'object') return 'This book could not be opened.';
  if (typeof book.id !== 'string' || !book.id) return 'This book could not be opened.';
  if (typeof book.title !== 'string' || !book.title.trim()) return 'Give your book a title first.';
  if (book.title.trim().length > MAX_BOOK_TITLE)
    return `Keep the title under ${MAX_BOOK_TITLE} characters.`;
  if (!Array.isArray(book.chapters)) return 'This book could not be opened.';
  if (book.chapters.length > MAX_CHAPTERS_PER_BOOK)
    return 'This book holds too many chapters to open safely.';
  for (const c of book.chapters) {
    if (!c || typeof c.id !== 'string' || !c.id || typeof c.storyId !== 'string' || !c.storyId || !Array.isArray(c.sources))
      return 'One chapter is damaged. Remove it and add the story again.';
    if (typeof c.heading !== 'string' || !c.heading.trim()) return 'Give every chapter a heading.';
    if (c.heading.trim().length > MAX_CHAPTER_HEADING)
      return `Keep chapter headings under ${MAX_CHAPTER_HEADING} characters.`;
    if (c.sources.length > MAX_SOURCES_PER_CHAPTER)
      return 'One chapter holds too many passages to open safely.';
    for (const s of c.sources) {
      if (!s || typeof s.text !== 'string' || !s.text || typeof s.passageId !== 'string' || !s.passageId || typeof s.sourceId !== 'string' || !s.sourceId)
        return 'One chapter is damaged. Remove it and add the story again.';
      if (s.text.length > MAX_SOURCE_TEXT)
        return 'One chapter passage is too long to open safely.';
      if (!Number.isInteger(s.sourceRevision))
        return 'One chapter is damaged. Remove it and add the story again.';
    }
  }
  return null;
}

// Versioned local persistence, separate from the stories schema
// (witness.stories.v1), which book drafts never mutate. Storage is
// injected so tests can pass a fake; in the browser pass localStorage.
//
// loadBooks returns the exact `raw` string it read so callers can pass
// it back to storeBooks: a tab whose read is older than what is stored
// is refused instead of clobbering a newer book. A collection that
// cannot be parsed or validated is never overwritten: the raw text is
// kept aside under a timestamped backup key (best effort) and returned
// as `corruptRaw`, so the narrator's earlier drafts survive the failure.
export function loadBooks(storage) {
  let raw = null;
  try {
    if (typeof storage?.getItem !== 'function') return { books: [], error: '', raw: null };
    raw = storage.getItem(BOOKS_KEY);
    if (raw == null || raw === '') return { books: [], error: '', raw };
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !Array.isArray(data?.items)) throw Error('Invalid book collection');
    const books = [];
    for (const b of data.items) {
      const problem = validateBook(b);
      if (problem) throw Error('Invalid book draft');
      books.push(b);
    }
    return { books: books.slice(0, MAX_BOOKS), error: '', raw };
  } catch {
    try {
      if (typeof storage?.setItem === 'function' && typeof raw === 'string' && raw !== '')
        storage.setItem(`${BOOKS_KEY}.corrupt-${Date.now()}`, raw);
    } catch {
      // The backup is best effort; the error below is what matters.
    }
    return { books: [], error: 'Your book drafts could not be opened. Your stories are unchanged.', raw, corruptRaw: typeof raw === 'string' ? raw : null };
  }
}

export function storeBooks(storage, books, expectedRaw) {
  try {
    if (typeof storage?.setItem !== 'function' || typeof storage?.getItem !== 'function')
      return 'This browser could not keep the book change. Free some space and try again.';
    if (expectedRaw !== undefined && storage.getItem(BOOKS_KEY) !== expectedRaw)
      return 'Your books changed in another tab. Reload them before saving — nothing was overwritten.';
    storage.setItem(BOOKS_KEY, JSON.stringify({ version: 1, items: books }));
    return '';
  } catch {
    return 'This browser could not keep the book change. Free some space and try again.';
  }
}
