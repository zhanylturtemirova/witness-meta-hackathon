// Saved passages and on-device likes. Local-only: no accounts, no network,
// no shared totals. Storage keys are versioned and separate from the stories
// schema (witness.stories.v1), which this module never mutates.
export const SAVED_KEY = 'witness.saved.v1';
export const LIKES_KEY = 'witness.liked.v1';
export const MAX_SAVED = 200;
export const MAX_QUOTE_LENGTH = 2000;
export const MAX_LIKES = 500;

// A saved quote keeps its identity (who wrote it, which source version it
// came from) so the narrator can revisit the exact words with attribution.
export function blankQuote() {
  return { id: '', text: '', author: '', sourceTitle: '', sourceKind: '', sourceId: '', sourceRevision: null, projectId: null, createdAt: 0 };
}

export function quoteIdentity(q) {
  return JSON.stringify([q.sourceKind || '', q.sourceId || '', q.sourceRevision ?? null, (q.text || '').trim()]);
}

function validShape(q) {
  return !!q && typeof q.id === 'string' && !!q.id && typeof q.text === 'string'
    && q.text.length > 0 && q.text.length <= MAX_QUOTE_LENGTH && typeof q.sourceId === 'string' && !!q.sourceId && typeof q.author === 'string' && typeof q.sourceTitle === 'string'
    && (q.sourceKind === 'shared-fictional' || q.sourceKind === 'own');
}

// The exact wording is preserved: interior characters are never normalised,
// only surrounding whitespace from a selection is trimmed.
export function cleanSelectionText(text) {
  return String(text ?? '').replace(/^\s+|\s+$/g, '');
}

// Pure validation shared by the Connect dialog and the own-story saver.
// sourceText is the full paragraph the selection must come from verbatim.
export function validateQuoteText(text, sourceText) {
  const cleaned = cleanSelectionText(text);
  if (!cleaned) return 'Select the words you want to keep first.';
  if (cleaned.length > MAX_QUOTE_LENGTH) return 'That passage is too long to save. Choose a shorter phrase.';
  if (typeof sourceText !== 'string' || !sourceText.includes(cleaned))
    return 'The saved words must match the story text exactly.';
  return null;
}

// Selection must come from the visible story paragraphs, not from headings,
// evidence notes, or another story. paragraphs are the text contents of the
// visible `.shared-story-paragraph` elements in the open card.
export function validateStorySelection(selectionText, paragraphs) {
  const cleaned = cleanSelectionText(selectionText);
  if (!cleaned) return 'Select a few words from the story text first.';
  if (!Array.isArray(paragraphs) || !paragraphs.length) return 'There is no story text to save from here.';
  if (cleaned.length > MAX_QUOTE_LENGTH) return 'That passage is too long to save. Choose a shorter phrase.';
  const found = paragraphs.some(p => typeof p === 'string' && p.includes(cleaned));
  if (!found) return 'Save words from this story only. Selections from outside the story text are not kept.';
  return null;
}

export function dedupeQuotes(list) {
  const seen = new Set(), out = [];
  for (const q of Array.isArray(list) ? list : []) {
    if (!validShape(q)) continue;
    const id = quoteIdentity(q);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(q);
  }
  return out;
}

// Returns {list, saved} where saved is the stored quote, or {list, error}
// with a message safe to show. Never throws for bad input.
export function addQuote(list, quote) {
  const current = dedupeQuotes(list);
  const candidate = { ...blankQuote(), ...quote };
  if (typeof candidate.text === 'string') candidate.text = cleanSelectionText(candidate.text);
  if (!candidate.id || typeof candidate.id !== 'string') {
    try { candidate.id = crypto.randomUUID(); } catch { candidate.id = 'q-' + Date.now() + '-' + Math.floor(Math.random() * 1e9); }
  }
  if (!candidate.text) return { list: current, error: 'Select the words you want to keep first.' };
  if (candidate.text.length > MAX_QUOTE_LENGTH) return { list: current, error: 'That passage is too long to save. Choose a shorter phrase.' };
  if (!validShape(candidate)) return { list: current, error: 'That passage is missing its source. Nothing was saved.' };
  if (current.some(q => quoteIdentity(q) === quoteIdentity(candidate)))
    return { list: current, saved: current.find(q => quoteIdentity(q) === quoteIdentity(candidate)), duplicate: true };
  if (current.length >= MAX_SAVED)
    return { list: current, error: 'Your saved phrases shelf is full (' + MAX_SAVED + '). Remove one first.' };
  if (!Number.isFinite(candidate.createdAt) || !candidate.createdAt) candidate.createdAt = Date.now();
  return { list: [...current, candidate], saved: candidate };
}

export function removeQuote(list, id) {
  const current = dedupeQuotes(list);
  return current.filter(q => q.id !== id);
}

// Deleting a private own story must not leave a hidden duplicate of its
// words behind: purge saved quotations owned by that project.
export function purgeProjectQuotes(list, projectId) {
  if (!projectId) return dedupeQuotes(list);
  return dedupeQuotes(list).filter(q => !(q.sourceKind === 'own' && q.projectId === projectId));
}

// Likes are explicitly on-device: a plain list of story ids, never a global
// total and never tied to an account.
export function toggleLike(likes, storyId) {
  const current = Array.isArray(likes) ? [...new Set(likes.filter(x => typeof x === 'string'))] : [];
  if (current.includes(storyId)) return { likes: current.filter(x => x !== storyId), liked: false };
  if (current.length >= MAX_LIKES) return { likes: current, liked: true, error: 'You have liked many stories on this device. Unlike one first.' };
  return { likes: [...current, storyId], liked: true };
}

export function isLiked(likes, storyId) {
  return Array.isArray(likes) && likes.includes(storyId);
}

// Defensive storage: a corrupt value reads as empty, a quota failure writes
// nothing and returns a visible message. Storage is injected so tests can
// pass a fake; in the browser pass globalThis.localStorage.
export function loadCollection(storage, key) {
  try {
    const raw = storage?.getItem?.(key);
    if (raw == null || raw === '') return { list: [], error: '' };
    const data = JSON.parse(raw);
    if(!Array.isArray(data)&&data?.version!==1)throw Error('Unsupported saved collection');
    const list = Array.isArray(data) ? data : data?.items;
    if (!Array.isArray(list)) throw Error('Invalid saved collection');
    if (key === LIKES_KEY) return { list: [...new Set(list.filter(x => typeof x === 'string'))].slice(0, MAX_LIKES), error: '' };
    if(list.some(q=>!validShape(q)))throw Error('Invalid saved quotation');
    return { list: dedupeQuotes(list).slice(0,MAX_SAVED), error: '' };
  } catch {
    return { list: [], error: 'Your saved phrases could not be opened. Nothing was lost from your stories.' };
  }
}

export function storeCollection(storage, key, list) {
  try {
    storage?.setItem?.(key, JSON.stringify({version:1,items:list}));
    return '';
  } catch {
    return 'This browser could not keep the change. Free some space and try again.';
  }
}
