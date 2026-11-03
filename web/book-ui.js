// My book product UI: DOM-free markup and pure orchestration helpers for
// gathering finished local stories into readable biography drafts.
//
// The narrator's stories are never mutated here: chapters are verbatim
// snapshots managed by biography.js. Persistence (localStorage) and
// navigation stay in app.js; this module only describes what to show.
import { finishedStories, chapterStatus, exportBookMarkdown } from './biography.js';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Pick the book to show: the requested one, otherwise the first kept
// draft. A dangling id reads as an honest notice, never a silent switch.
export function resolveBookView(books, activeId) {
  const list = Array.isArray(books) ? books : [];
  const active = list.find((b) => b && b.id === activeId) || null;
  if (active) return { active, notice: '' };
  if (activeId && list.length) return { active: list[0], notice: 'That book is no longer here. Showing your first book instead.' };
  return { active: list[0] || null, notice: '' };
}

// Finished own stories that are not already a chapter of this book.
// Excluded chapters keep their place, so their stories stay out of the
// picker: restoring happens on the chapter, not by adding a duplicate.
export function pickerStories(book, projects) {
  const taken = new Set((book?.chapters || []).map((c) => c && c.storyId).filter(Boolean));
  return finishedStories(projects).filter((p) => !taken.has(p.id));
}

// One human-readable freshness row per chapter. Status is computed from
// the live stories on every render, never stored.
export function chapterRowState(chapter, projects) {
  const status = chapterStatus(chapter, projects);
  if (status === 'ok')
    return { status, label: 'Current', hint: 'Matches your story word for word.' };
  if (status === 'stale')
    return {
      status,
      label: 'Changed since gathered',
      hint: 'Its story changed. The chapter keeps the earlier wording until you refresh it.',
    };
  return {
    status: 'missing',
    label: 'Story not on this device',
    hint: 'Its story is gone from this browser. The gathered wording is kept.',
  };
}

export function bookFileName(book) {
  const slug = String(book?.title || 'my-book')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return `${slug || 'my-book'}.md`;
}

// Markdown export without throwing: the view renders the error honestly.
export function tryExportBook(book, projects) {
  try {
    return { markdown: exportBookMarkdown(book, projects) };
  } catch (err) {
    return { error: err?.message || 'This book could not be exported yet.' };
  }
}

function chapterHtml(chapter, projects) {
  const row = chapterRowState(chapter, projects);
  const preview = chapter.sources?.[0]?.text || '';
  const trimmed = preview.length > 160 ? `${preview.slice(0, 160)}…` : preview;
  return `<article class="memory-card${chapter.excluded ? ' excluded' : ''}" data-chapter="${esc(chapter.id)}">
    <div>
      <span class="tag">${row.status === 'ok' ? 'CURRENT' : row.status === 'stale' ? 'CHANGED' : 'KEPT WORDING'}</span>
      <h3>${esc(chapter.heading || 'Untitled chapter')}</h3>
      <p class="muted">${esc(chapter.storyTitle || '')} · ${(chapter.sources || []).length} ${(chapter.sources || []).length === 1 ? 'passage' : 'passages'} · ${esc(row.label)}</p>
      ${trimmed ? `<p>${esc(trimmed)}</p>` : ''}
      ${row.status !== 'ok' ? `<p class="muted">${esc(row.hint)}</p>` : ''}
    </div>
    <form class="chapter-heading-form" data-chapter-form="${esc(chapter.id)}">
      <label class="sr-only" for="heading-${esc(chapter.id)}">Chapter heading</label>
      <input id="heading-${esc(chapter.id)}" name="heading" maxlength="120" value="${esc(chapter.heading || '')}" required>
      <button class="text-button" type="submit">Save heading</button>
    </form>
    <div class="memory-card-actions">
      <button class="text-button" data-action="book-up" data-id="${esc(chapter.id)}">Move up</button>
      <button class="text-button" data-action="book-down" data-id="${esc(chapter.id)}">Move down</button>
      ${chapter.excluded
        ? `<button class="text-button" data-action="book-restore" data-id="${esc(chapter.id)}">Restore to book</button>`
        : `<button class="text-button" data-action="book-exclude" data-id="${esc(chapter.id)}">Exclude from book</button>`}
      ${row.status === 'stale' ? `<button class="text-button" data-action="book-refresh" data-id="${esc(chapter.id)}">Refresh wording</button>` : ''}
      <button class="text-button" data-action="book-source" data-id="${esc(chapter.storyId)}">Open source story →</button>
      <button class="text-button" data-action="book-remove" data-id="${esc(chapter.id)}">Remove chapter</button>
    </div>
  </article>`;
}

function activeBookHtml(book, projects) {
  const options = pickerStories(book, projects);
  const chapters = [...(book.chapters || [])];
  const included = chapters.filter((c) => !c.excluded);
  const excluded = chapters.filter((c) => c.excluded);
  return `<section aria-label="Open book">
    <form id="book-title-form">
      <label class="sr-only" for="book-title-input">Book title</label>
      <input id="book-title-input" name="title" maxlength="120" value="${esc(book.title || '')}" required>
      <button class="button outline small" type="submit">Save title</button>
    </form>
    <div class="section-heading"><h2>Chapters</h2><span>${included.length} in the book${excluded.length ? ` · ${excluded.length} excluded` : ''}</span></div>
    ${chapters.length
      ? `<div class="saved-list">${chapters.map((c) => chapterHtml(c, projects)).join('')}</div>`
      : '<p class="muted">No chapters yet. Choose a finished story below — its words are copied exactly, and your story stays as it is.</p>'}
    ${options.length
      ? `<form id="book-add-form">
          <label for="book-add-select">Add a finished story as a chapter</label>
          <select id="book-add-select" name="storyId" required>
            ${options.map((p) => `<option value="${esc(p.id)}">${esc(p.story?.title || p.title || 'Untitled story')}</option>`).join('')}
          </select>
          <button class="button primary small" type="submit">Add chapter</button>
        </form>`
      : finishedStories(projects).length
        ? '<p class="muted">Every finished story is already a chapter of this book.</p>'
        : '<p class="muted">No finished stories yet. Conversations become stories in Review — then they can join this book.</p>'}
    <div class="event-actions">
      <button class="button outline small" data-action="book-export">Export as Markdown</button>
      <button class="text-button" data-action="book-delete">Delete this book</button>
    </div>
    <p class="muted">Exported Markdown keeps your uncertain phrasing as written and links every passage to its source answer.</p>
  </section>`;
}

export function bookViewHtml({ books, activeId, projects, notice = '', storageError = '' }) {
  const list = Array.isArray(books) ? books : [];
  const resolved = resolveBookView(list, activeId);
  const active = resolved.active;
  const notes = [notice, resolved.notice].filter(Boolean);
  return `<div class="page-heading"><p class="eyebrow">MY BOOK</p><h1>Gather your <em>stories.</em></h1>
    <p>Finished stories become chapters, word for word. Your stories stay exactly as they are.</p></div>
    ${storageError ? `<div class="stale-banner" role="alert">${esc(storageError)}</div>` : ''}
    ${notes.map((n) => `<div class="gentle-note" role="status"><p>${esc(n)}</p></div>`).join('')}
    <section aria-label="Your books">
      <div class="section-heading"><h2>Books</h2><span>${list.length}</span></div>
      ${list.length
        ? `<div class="saved-list">${list.map((b) => `<article class="memory-card${active && b.id === active.id ? ' first' : ''}"><div><h3>${esc(b.title || 'Untitled book')}</h3><p class="muted">${(b.chapters || []).filter((c) => !c.excluded).length} chapters</p></div><div class="memory-card-actions"><button class="text-button" data-action="book-open" data-id="${esc(b.id)}">${active && b.id === active.id ? 'Open ✓' : 'Open →'}</button></div></article>`).join('')}</div>`
        : '<p class="muted">No books yet. Name your first one — you can keep several.</p>'}
      <form id="book-new-form">
        <label class="sr-only" for="book-new-title">New book title</label>
        <input id="book-new-title" name="title" maxlength="120" placeholder="A title for this book…" required>
        <button class="button primary small" type="submit">Start a book</button>
      </form>
    </section>
    ${active ? activeBookHtml(active, projects) : ''}`;
}
