// Connect real-mode orchestration: derive a local matching selection
// from the chosen private event, adapt public rows to the globe's match
// shape, and guard lazy fetches with epochs so account switches and
// event switches ignore stale replies.
//
// Privacy: the private event is NEVER uploaded. fetchPublished pulls the
// public allowlisted columns; matching runs here, on the device.
import { matchRealStories, realMatchGuidance, validateRealQuote, COMMUNITY_TOPICS } from './community.js';

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const KNOWN_TOPICS = new Set(COMMUNITY_TOPICS.map((t) => t.id));

// A private event's inferred category doubles as a topic only when it is
// literally one of the shared topic ids; otherwise the narrator picks.
export function topicsForCategory(category) {
  return typeof category === 'string' && KNOWN_TOPICS.has(category) ? [category] : [];
}

// The local selection: an explicit occasion id plus topics. A city or a
// date alone never relates two stories.
export function selectionForEvent(privateEvent, pickedTopics = []) {
  const picked = (Array.isArray(pickedTopics) ? pickedTopics : []).filter((t) => KNOWN_TOPICS.has(t));
  const occasionId = String(privateEvent?.occasionId || '').trim();
  const topics = picked.length ? [...new Set(picked)] : topicsForCategory(privateEvent?.category);
  return { occasionId, topics };
}

export function needsTopicPick(privateEvent, pickedTopics = []) {
  const selection = selectionForEvent(privateEvent, pickedTopics);
  return !selection.occasionId && !selection.topics.length;
}

export function realGuidance(privateEvent, pickedTopics = []) {
  if (!privateEvent) return 'Choose one of your events to look for related shared stories. Selecting it is local; only an explicit search sends your search text to Meta.';
  return realMatchGuidance(selectionForEvent(privateEvent, pickedTopics));
}

// Epoch-guarded store for one Connect session. beginRealFetch marks a
// request; settleRealFetch drops replies from superseded requests;
// invalidateRealStore clears caches on account switch.
export function createRealStore() {
  return { rows: [], error: '', loading: false, epoch: 0, pickedTopics: [], myLikes: [], likesError: '', quotes: [], quotesError: '', quotesFor: null, ownIds: null, ownError: '' };
}

export function beginRealFetch(store) {
  store.epoch += 1;
  store.loading = true;
  store.error = '';
  return store.epoch;
}

export function settleRealFetch(store, token, result) {
  if (!store || token !== store.epoch) return false;
  store.loading = false;
  if (result?.ok) {
    store.rows = Array.isArray(result.rows) ? result.rows : [];
    store.error = '';
  } else {
    store.rows = [];
    store.error = result?.error || 'The shared stories could not be reached. Nothing on this device changed.';
  }
  return true;
}

export function invalidateRealStore(store) {
  if (!store) return;
  store.epoch += 1;
  store.loading = false;
  store.rows = [];
  store.error = '';
  store.myLikes = [];
  store.likesError = '';
  store.quotes = [];
  store.quotesError = '';
  store.quotesFor = null;
  store.ownIds = null;
  store.ownError = '';
}

// Own publications are excluded from "similar experience" points using the
// ids already fetched through the owner-only listMyPublications RPC — the
// public owner_id column is never widened to do this. ownIds === null means
// the owner list is unknown (signed out, or its fetch failed); matches are
// then unfiltered and the guidance says so honestly.
export function realMatchesFor(store, privateEvent, pickedTopics = [], excludeIds = null, filters = null) {
  const rows = Array.isArray(store?.rows) ? store.rows : [];
  const excluded = excludeIds instanceof Set ? excludeIds : new Set(Array.isArray(excludeIds) ? excludeIds : []);
  const visible = excluded.size ? rows.filter((r) => r && !excluded.has(r.id)) : rows;
  return matchRealStories(selectionForEvent(privateEvent, pickedTopics), visible, filters);
}

export function ownStoryNotice(store) {
  if (!store) return '';
  if (store.ownIds == null)
    return store.ownError || '';
  return '';
}

function initialsOf(penName) {
  const words = String(penName || '').trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]).join('');
  return (letters || '?').toUpperCase();
}

// Adapt a local real match to the shape the globe and the connection
// cards already render. Real cards carry real:true so the UI can mark
// them as shared copies, never as fictional profiles.
export function adaptRealMatch(match) {
  const row = match?.row || {};
  const passages = (row.passages || [])
    .map((p) => (typeof p === 'string' ? p : p?.text))
    .filter((t) => typeof t === 'string' && t.trim());
  const evidence = [...(match?.evidence || [])];
  while (evidence.length < 2) evidence.push(`Shared topic: ${(match?.sharedTopics || []).slice(evidence.length)[0] || 'a shared experience'}.`);
  return {
    id: `real:${row.id}`,
    real: true,
    publishedId: row.id,
    revision: row.revision,
    name: row.pen_name || 'Anonymous',
    title: row.title || 'Untitled shared story',
    place: row.event_city || row.city || 'Shared story',
    year: 'Shared story',
    excerpt: (passages[0] || '').slice(0, 220),
    story: passages.join('\n\n'),
    reason: (match?.evidence || []).join(' '),
    evidence: evidence.slice(0, 2),
    matchType: match?.matchType || 'similar_experience',
    lon: row.lon,
    lat: row.lat,
    topics: Array.isArray(row.topics) ? row.topics : [],
    color: '#3f5a52',
    initials: initialsOf(row.pen_name),
    row,
  };
}

// A semantic (Muse-ranked) public match becomes a globe card through the
// same adapter, so pins, cards, likes, and exact-word saving behave
// identically. The model's reason becomes the card reason and the two
// EXACT evidence spans become the card evidence: 'Why it relates' always
// shows both source snippets verbatim. matchType is always
// similar_experience here — the same occasion is proven only by the
// structured occasion-id check in community.js, never by a model claim.
export function adaptDiscoveryMatch(mapped) {
  const base = adaptRealMatch({
    row: mapped?.row || {},
    matchType: 'similar_experience',
    sharedTopics: [],
    evidence: [mapped?.queryEvidence, mapped?.candidateEvidence].filter(
      (t) => typeof t === 'string' && t.trim(),
    ),
  });
  return {
    ...base,
    semantic: true,
    score: typeof mapped?.score === 'number' ? mapped.score : null,
    reason: String(mapped?.reason || ''),
    queryEvidence: mapped?.queryEvidence || '',
    candidateEvidence: mapped?.candidateEvidence || '',
    provider: mapped?.provider || 'meta',
    model: mapped?.model || 'muse-spark-1.3',
  };
}

// A public story reading card: same globe, clearly marked as a real
// shared copy by pen name. Exact-word saving and likes need sign-in and
// go through the community RPCs; guests get that honestly.
export function realStoryDialogHtml(match, { liked = false, signedIn = false } = {}) {
  const paras = String(match.story || '').split('\n\n').filter((t) => t.trim());
  return `<button class="modal-close" data-action="close" aria-label="Close story">×</button>
    <p class="eyebrow">SHARED STORY · ${esc(match.place)}</p>
    <h2 id="modal-title">${esc(match.title)}</h2>
    <p class="muted">${esc(match.name)} · shared copy · revision ${esc(match.revision)}</p>
    ${paras.map((para) => `<p class="shared-story-paragraph">${esc(para)}</p>`).join('') || '<p class="muted">This copy has no readable passages.</p>'}
    <div class="shared-story-reason"><span>${match.matchType === 'same_occasion' ? 'SAME OCCASION' : 'SIMILAR EXPERIENCE'}</span><p>${esc(match.reason)}</p></div>
    <div class="connect-keep-row">
      <button class="button outline small" data-action="real-like" data-id="${esc(match.publishedId)}" aria-pressed="${liked}">${liked ? 'Unlike ♥' : 'Like ♡'}</button>
      <button class="button outline small" data-action="real-save" data-id="${esc(match.publishedId)}">Save selected words</button>
    </div>
    ${signedIn
      ? '<p class="muted">Likes and saved phrases are kept under your account, with the pen name attached. Exact words only.</p>'
      : '<p class="muted">Sign in to like this story or save its exact words. Reading needs no account.</p>'}
    <p class="connect-save-note" role="status"></p>
    <p class="shared-story-note">Shared by pen name. No private interviews were used to find it.</p>
    <button class="button outline" data-action="close">Back to Earth</button>`;
}

// Exact-quotation check against the opened public row and revision.
export function quoteFromSelection(text, match) {
  return validateRealQuote(text, match?.row || null, match?.revision);
}

// Reading card for a semantic match: identical story, like, and save
// controls (same data-actions, same revision binding), plus an explicit
// 'Why it relates' block with the model's reason and the two EXACT source
// snippets — one from the narrator's search text, one from the shared
// story — alongside the ranking score and the provider/model that ranked
// it. Same-occasion badges never appear here: the model cannot claim them.
export function discoveryStoryDialogHtml(match, { liked = false, signedIn = false } = {}) {
  const paras = String(match.story || '').split('\n\n').filter((t) => t.trim());
  const score = typeof match.score === 'number' ? ` · relevance ${match.score.toFixed(2)}` : '';
  return `<button class="modal-close" data-action="close" aria-label="Close story">×</button>
    <p class="eyebrow">SHARED STORY · ${esc(match.place)} · FOUND BY SEMANTIC SEARCH</p>
    <h2 id="modal-title">${esc(match.title)}</h2>
    <p class="muted">${esc(match.name)} · shared copy · revision ${esc(match.revision)}</p>
    ${paras.map((para) => `<p class="shared-story-paragraph">${esc(para)}</p>`).join('') || '<p class="muted">This copy has no readable passages.</p>'}
    <div class="shared-story-reason"><span>SIMILAR EXPERIENCE</span><p>${esc(match.reason)}</p></div>
    <div class="shared-story-why"><p><strong>Why it relates</strong> — exact words from both sides:</p>
      <blockquote class="shared-story-paragraph">“${esc(match.queryEvidence)}”<footer>Your search text</footer></blockquote>
      <blockquote class="shared-story-paragraph">“${esc(match.candidateEvidence)}”<footer>${esc(match.title)}</footer></blockquote>
      <p class="muted">Ranked by ${esc(match.provider)} · ${esc(match.model)}${esc(score)}. Same-occasion badges come only from matching occasion codes, never from this ranking.</p></div>
    <div class="connect-keep-row">
      <button class="button outline small" data-action="real-like" data-id="${esc(match.publishedId)}" aria-pressed="${liked}">${liked ? 'Unlike ♥' : 'Like ♡'}</button>
      <button class="button outline small" data-action="real-save" data-id="${esc(match.publishedId)}">Save selected words</button>
    </div>
    ${signedIn
      ? '<p class="muted">Likes and saved phrases are kept under your account, with the pen name attached. Exact words only.</p>'
      : '<p class="muted">Sign in to like this story or save its exact words. Reading needs no account.</p>'}
    <p class="connect-save-note" role="status"></p>
    <p class="shared-story-note">Shared by pen name. No private interviews were used to find it.</p>
    <button class="button outline" data-action="close">Back to Earth</button>`;
}
