// Share (publish) product UI: DOM-free markup and pure flow helpers for
// sharing an explicit, allowlisted copy of one finished story.
//
// Two deliberate steps: a form (what to share) and a preview (the exact
// public text plus what stays out) with a second Publish click. Nothing
// uploads until that second click, and only through community.js, which
// copies solely the chosen fields. Answers, email, audio, images, and the
// whole project JSON can never pass through this flow.
import { buildPublishPreview, COMMUNITY_TOPICS, topicLabel } from './community.js';
import { CITY_OPTIONS } from './connect-events.js';
import { entryStatus } from './event-model.js';
import { isStale } from './domain.js';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only reviewed, confirmed events may represent a shared copy.
export function confirmedEvents(project) {
  return (project?.events || []).filter((e) => entryStatus(e, project.answers || []) === 'Confirmed');
}

// A fresh submission draft. penName is never prefilled from an email:
// the only name readers see must be typed deliberately.
export function createShareDraft(project, { penName = '', publishedId = null, expectedRevision = 0 } = {}) {
  const passages = project?.story?.passages || [];
  const confirmed = confirmedEvents(project);
  return {
    phase: 'form',
    penName,
    title: project?.story?.title || project?.title || '',
    passageIds: passages.map((s) => s.id),
    eventId: confirmed[0]?.id || '',
    cityName: '',
    topics: [],
    occasionId: '',
    originalDateText: '',
    eventYear: '',
    dateApprox: 'auto',
    error: '',
    preview: null,
    previewInputs: null,
    publishedId,
    expectedRevision,
    busy: false,
  };
}

// Reopen a previous publication for editing: map the public row back
// onto the current story. Passages match by exact surviving text, the
// event by title; anything that no longer matches must be chosen again.
export function draftFromRow(project, row, penName = '') {
  const draft = createShareDraft(project, {
    penName: penName || row?.pen_name || '',
    publishedId: row?.id || null,
    expectedRevision: row?.revision || 0,
  });
  const sharedTexts = new Set(
    (row?.passages || []).map((p) => (typeof p === 'string' ? p : p?.text)).filter((t) => typeof t === 'string'),
  );
  draft.title = row?.title || draft.title;
  draft.passageIds = (project?.story?.passages || []).filter((s) => sharedTexts.has(s.text)).map((s) => s.id);
  const byTitle = confirmedEvents(project).find((e) => (e.title || '') === (row?.event_title || ''));
  if (byTitle) draft.eventId = byTitle.id;
  const city = CITY_OPTIONS.find((c) => c.label === (row?.city || row?.event_city || ''));
  if (city) draft.cityName = city.name;
  draft.topics = (row?.topics || []).filter((t) => COMMUNITY_TOPICS.some((c) => c.id === t));
  draft.occasionId = row?.occasion_id || '';
  draft.originalDateText = row?.event_date_text || '';
  draft.eventYear = Number.isInteger(row?.event_year) ? String(row.event_year) : '';
  draft.dateApprox = row?.date_approx ? 'approx' : 'auto';
  return draft;
}

// Passages whose source answer moved on since the story passage was
// written. Sharing them would detach the copy from its evidence, so the
// narrator reviews the story first.
export function staleSelectedPassages(project, passageIds) {
  const ids = new Set(Array.isArray(passageIds) ? passageIds : []);
  return (project?.story?.passages || []).filter((s) => ids.has(s.id) && isStale(project, s)).map((s) => s.id);
}

// Build the exact-copy preview, after the stale-source binding check.
export function buildSharePreview(project, inputs) {
  const stale = staleSelectedPassages(project, inputs?.passageIds);
  if (stale.length)
    return {
      error: 'Some selected passages changed at their source. Open the story, review the marked sources, then share again — nothing was shared.',
      stale,
    };
  const eventEntry = (project?.events || []).find((e) => e.id === inputs?.eventId) || null;
  const approxChoice = inputs?.dateApprox;
  const dateApprox = approxChoice === 'approx' ? true : approxChoice === 'exact' ? false : undefined;
  return buildPublishPreview({ project, penName: inputs?.penName, title: inputs?.title, passageIds: inputs?.passageIds, eventEntry, cityName: inputs?.cityName, topics: inputs?.topics, occasionId: inputs?.occasionId, eventDateText: inputs?.originalDateText, eventYear: inputs?.eventYear, dateApprox });
}

function passagePickerHtml(project, draft) {
  const passages = project?.story?.passages || [];
  const stale = new Set(staleSelectedPassages(project, draft.passageIds));
  return `<fieldset><legend>Passages to share (exact words)</legend>
    ${passages.map((s, i) => `<label class="check-row"><input type="checkbox" name="passage" value="${esc(s.id)}" ${draft.passageIds.includes(s.id) ? 'checked' : ''}>
      <span>Passage ${i + 1}${stale.has(s.id) ? ' · source changed' : ''} — “${esc(s.text.length > 90 ? `${s.text.slice(0, 90)}…` : s.text)}”</span></label>`).join('')}
  </fieldset>`;
}

function eventPickerHtml(project, draft) {
  const confirmed = confirmedEvents(project);
  if (!confirmed.length)
    return '<p class="muted">No confirmed events yet. Review an event in your collection first — drafts stay private until reviewed.</p>';
  return `<fieldset><legend>One confirmed event</legend>
    ${confirmed.map((e) => `<label class="check-row"><input type="radio" name="eventId" value="${esc(e.id)}" ${(draft.eventId || confirmed[0].id) === e.id ? 'checked' : ''}>
      <span>${esc(e.title || 'Untitled event')}${e.dateText ? ` · ${esc(e.dateText)}` : ''}${e.location ? ` · ${esc(e.location)}` : ''}</span></label>`).join('')}
  </fieldset>`;
}

export function shareFormHtml(project, draft) {
  return `<form id="share-form">
    <label for="share-pen">Pen name (the only name readers see — never your email)</label>
    <input id="share-pen" name="penName" maxlength="40" value="${esc(draft.penName)}" required autocomplete="off">
    <label for="share-title">Shared title</label>
    <input id="share-title" name="title" maxlength="120" value="${esc(draft.title)}" required>
    ${passagePickerHtml(project, draft)}
    ${eventPickerHtml(project, draft)}
    <label for="share-city">City (from the list — never guessed)</label>
    <select id="share-city" name="cityName" required>
      <option value="">Choose a city…</option>
      ${CITY_OPTIONS.map((c) => `<option value="${esc(c.name)}" ${draft.cityName === c.name ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
    </select>
    <fieldset><legend>Topics (at least one)</legend>
      ${COMMUNITY_TOPICS.map((t) => `<label class="check-row"><input type="checkbox" name="topic" value="${esc(t.id)}" ${draft.topics.includes(t.id) ? 'checked' : ''}><span>${esc(t.label)}</span></label>`).join('')}
    </fieldset>
    <label for="share-occasion">Occasion identifier (optional, e.g. a shared event code)</label>
    <input id="share-occasion" name="occasionId" maxlength="80" value="${esc(draft.occasionId)}" autocomplete="off">
    <fieldset><legend>When it happened (optional — shown exactly as written)</legend>
      <label for="share-date-text">Original date wording (empty keeps the event's own wording${(() => { const ev = (project?.events || []).find((e) => e.id === draft.eventId); return ev?.dateText ? `: “${esc(ev.dateText)}”` : ''; })()})</label>
      <input id="share-date-text" name="originalDateText" maxlength="120" value="${esc(draft.originalDateText || '')}" placeholder="e.g. around 2019" autocomplete="off">
      <label for="share-year">Year (empty stays unknown — never guessed)</label>
      <input id="share-year" name="eventYear" inputmode="numeric" maxlength="4" value="${esc(draft.eventYear || '')}" placeholder="e.g. 2019" autocomplete="off">
      <label for="share-approx">Is the date approximate?</label>
      <select id="share-approx" name="dateApprox">
        <option value="auto" ${draft.dateApprox !== 'approx' && draft.dateApprox !== 'exact' ? 'selected' : ''}>As written</option>
        <option value="approx" ${draft.dateApprox === 'approx' ? 'selected' : ''}>Approximate date</option>
        <option value="exact" ${draft.dateApprox === 'exact' ? 'selected' : ''}>Exact date</option>
      </select>
    </fieldset>
    ${draft.error ? `<div class="stale-banner" role="alert">${esc(draft.error)}</div>` : ''}
    <div class="event-actions"><button class="button primary" type="submit">Preview public copy →</button></div>
  </form>`;
}

// The exact public text, plus an explicit list of what stays out.
function previewDateLine(preview) {
  const wording = String(preview?.event?.dateText || '').trim();
  const year = Number.isInteger(preview?.event?.year) ? preview.event.year : null;
  const approx = !!preview?.event?.approx;
  if (wording) return `${wording}${approx ? ' (approximate)' : ''}`;
  if (year != null) return `${year}${approx ? ' (approximate)' : ''}`;
  return 'Date unknown';
}

export function sharePreviewHtml(preview) {
  const excluded = [
    'Your interview answers and conversation history',
    'Your email address and account details',
    'Recordings, images, and the full story file',
    'Passages you did not select',
  ];
  return `<div class="share-preview">
    <p class="eyebrow">EXACT PUBLIC COPY</p>
    <h3>${esc(preview.title)}</h3>
    <p class="muted">By ${esc(preview.penName)} · ${esc(preview.event.city)} · ${(preview.topics || []).map(topicLabel).map(esc).join(' · ')}</p>
    <p><strong>${esc(preview.event.title)}</strong>${preview.event.summary ? ` — ${esc(preview.event.summary)}` : ''}</p>
    <p class="muted">When: ${esc(previewDateLine(preview))}</p>
    ${preview.passages.map((p) => `<blockquote class="shared-story-paragraph">${esc(p.text)}</blockquote>`).join('')}
    <p class="eyebrow">STAYS ON YOUR DEVICE</p>
    <ul>${excluded.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
  </div>`;
}

export function mySharesHtml(rows) {
  if (!rows?.length) return '<p class="muted">No shared copies yet. Your first preview is one step away.</p>';
  return `<div class="saved-list">${rows.map((r) => `<article class="memory-card"><div><h3>${esc(r.title || 'Untitled')}</h3>
    <p class="muted">By ${esc(r.pen_name || '')} · revision ${esc(r.revision)} · ${esc((r.like_count ?? 0))} likes</p></div>
    <div class="memory-card-actions">
      <button class="text-button" data-action="share-update" data-id="${esc(r.id)}">Update</button>
      <button class="text-button" data-action="share-unpublish" data-id="${esc(r.id)}">Unpublish</button>
    </div></article>`).join('')}</div>`;
}

// Read the share form without trusting the DOM: every value is
// re-validated by buildSharePreview before anything is shown or sent.
export function readShareForm(form) {
  const data = new FormData(form);
  return {
    penName: String(data.get('penName') ?? ''),
    title: String(data.get('title') ?? ''),
    passageIds: data.getAll('passage').map(String),
    eventId: String(data.get('eventId') ?? ''),
    cityName: String(data.get('cityName') ?? ''),
    topics: data.getAll('topic').map(String),
    occasionId: String(data.get('occasionId') ?? ''),
    originalDateText: String(data.get('originalDateText') ?? ''),
    eventYear: String(data.get('eventYear') ?? ''),
    dateApprox: String(data.get('dateApprox') ?? 'auto'),
  };
}

export function shareDialogHtml({ project, draft, signedIn, resolving = false, myRows = [], myError = '', setupNote = '' }) {
  const head = '<button class="modal-close" data-action="close" aria-label="Close sharing">×</button><p class="eyebrow">SHARE</p>';
  if (!project?.story?.passages?.length)
    return `${head}<h2 id="modal-title">Nothing to share <em>yet.</em></h2><p>Finish this story first — sharing copies only finished passages, word for word.</p>`;
  if (resolving)
    return `${head}<h2 id="modal-title">Opening <em>sharing…</em></h2><p class="muted" role="status">Checking your sign-in. Anything you type next is kept.</p>
      <section aria-label="Your shared copies"><div class="section-heading"><h2>Shared copies</h2></div><p class="muted" role="status">Loading…</p></section>`;
  if (!signedIn)
    return `${head}<h2 id="modal-title">Sign in to <em>share.</em></h2><p>Sharing needs a signed-in account so your copies stay yours and can be withdrawn. Your story on this device is unchanged.</p>
      <div class="event-actions"><button class="button primary" data-action="account">Sign in →</button></div>
      <section aria-label="Your shared copies"><div class="section-heading"><h2>Shared copies</h2></div><p class="muted">Sign in to see the copies you shared from your stories.</p></section>`;
  const body =
    draft.phase === 'preview' && draft.preview
      ? `${sharePreviewHtml(draft.preview)}
        <form id="share-publish-form"><div class="event-actions">
          <button class="button outline" data-action="share-back" type="button">← Back to choices</button>
          <button class="button primary" type="submit" ${draft.busy ? 'disabled' : ''}>${draft.busy ? 'Sharing…' : draft.publishedId ? 'Publish update' : 'Publish this copy'}</button>
        </div></form>`
      : shareFormHtml(project, draft);
  return `${head}<h2 id="modal-title">${draft.publishedId ? 'Update your <em>shared copy.</em>' : 'Share <em>this story.</em>'}</h2>
    <p class="muted">Only what you choose below becomes public, under your pen name. Review the exact text before the second click.</p>
    ${setupNote ? `<div class="stale-banner" role="alert">${esc(setupNote)}</div>` : ''}
    ${body}
    <section aria-label="Your shared copies"><div class="section-heading"><h2>Your shared copies</h2><span>${myRows.length}</span></div>
    ${myError ? `<div class="stale-banner" role="alert">${esc(myError)}</div>` : mySharesHtml(myRows)}</section>`;
}
