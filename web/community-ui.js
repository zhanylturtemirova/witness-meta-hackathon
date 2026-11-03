// Real community UI orchestration: DOM-free state and pure helpers for
// the three clickable flows (Share, Connect real mode, Saved cloud
// phrases). app.js owns every dialog and network call; this module owns
// the rules that keep those flows honest:
//
// - A share preview is captured as an exact binding before the second
//   click, and re-checked against the live story before anything is sent.
// - Real-mode matching always derives locally from the chosen private
//   event plus explicitly picked topics. The private event never leaves.
// - Cloud quotes are bounded in memory and load only on explicit action.
// - Epochs/tokens let stale async replies be dropped instead of repainting
//   an unrelated modal or view.
import {
  selectionForEvent,
  realMatchesFor,
  adaptRealMatch,
  adaptDiscoveryMatch,
  realGuidance,
  needsTopicPick,
  createRealStore,
  invalidateRealStore,
  ownStoryNotice,
} from './connect-real.js';
import { COMMUNITY_TOPICS } from './community.js';
import { CITY_OPTIONS } from './connect-events.js';
import {
  buildCandidateExcerpt,
  createDiscoveryState,
  invalidateDiscoveryState,
  dropStaleDiscoveryResults,
} from './discovery.js';

// Cloud phrases kept in memory only, never merged into the local shelf.
export const CLOUD_QUOTE_LIMIT = 50;

export function createCommunityUI() {
  return {
    connectMode: 'fiction', // 'fiction' | 'real'
    real: createRealStore(),
    realFetched: false, // public rows fetched at least once this session
    realLikesFor: null, // account uid the cached myLikes belong to
    share: null, // {projectId,draft,myRows,myError,setupNote,token}
    discovery: createDiscoveryState(), // semantic search session (filters, binding, ranked results)
    discoveryAbort: null, // in-flight search AbortController, cancelled on change/unmount
    cloudQuotes: { rows: [], error: '', loading: false, loadedFor: null, epoch: 0 },
    openRealCard: null, // {publishedId,revision,match,token}
    cardSeq: 0,
  };
}

// Deep comparison of two publish previews. Both come from the same
// builder, so JSON order is stable; anything that differs means the
// source story, event, or choices moved under the preview.
export function previewsEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// Freeze the exact preview plus the inputs that produced it, before the
// second (Publish) click. Structured clone via JSON keeps no reference
// to later form or story mutations.
export function capturePreviewBinding(preview, inputs) {
  return {
    preview: JSON.parse(JSON.stringify(preview ?? null)),
    inputs: JSON.parse(JSON.stringify(inputs ?? null)),
  };
}

// Rebuild the preview from the live project and the frozen inputs, then
// compare with the shown preview. Returns {ok,preview} only when the
// text is byte-identical; any drift (edited passage, revised answer,
// changed event) is an honest error and nothing may be sent.
export function checkPreviewBinding(project, binding, buildPreview) {
  if (!binding?.preview || !binding?.inputs)
    return { ok: false, error: 'Review the preview first. Nothing was shared.' };
  const fresh = buildPreview(project, binding.inputs);
  if (fresh?.error) return { ok: false, error: fresh.error };
  if (!fresh?.preview || !previewsEqual(fresh.preview, binding.preview))
    return {
      ok: false,
      error: 'Your story changed since the preview. Review the choices again — nothing was shared.',
    };
  return { ok: true, preview: fresh.preview };
}

// Toggle one explicitly picked topic id. Unknown ids never enter the
// selection; matching stays a local, explicit choice.
export function togglePickedTopic(picked, id, checked) {
  const set = new Set(Array.isArray(picked) ? picked : []);
  if (checked) set.add(id);
  else set.delete(id);
  const allowed = new Set(COMMUNITY_TOPICS.map((t) => t.id));
  return [...set].filter((t) => allowed.has(t));
}

// The real-mode view state for mountConnect: locally derived matches over
// the same globe, plus honest loading/error/guidance. No fetching here.
// The narrator's own publications are excluded via the owner-only id list;
// when that list is unknown the matches are unfiltered and the guidance
// says whose stories could not be checked.
export function buildRealViewState(ui, privateEvent, { liveDiscovery = false } = {}) {
  const picked = Array.isArray(ui?.real?.pickedTopics) ? ui.real.pickedTopics : [];
  const ownIds = Array.isArray(ui?.real?.ownIds) ? ui.real.ownIds : null;
  // The deterministic year/city filters narrow the local preview too, so
  // the globe and the preview count always reflect what is selected.
  const localMatches = realMatchesFor(ui?.real, privateEvent, picked, ownIds, ui?.discovery?.filters || null).map(adaptRealMatch);
  const error = ui?.real?.error || '';
  const ownNote = error ? '' : ownStoryNotice(ui?.real);
  const guidance = error ? '' : (realGuidance(privateEvent, picked) || ownNote);
  // The globe shows semantic results once a search completes, otherwise the
  // local topic preview. The two are labelled distinctly in the panel: the
  // preview is device-local and topic-based; the ranking came from Muse.
  // The ranking stays bound to the searched event AND the searched
  // filters: switching events or changing a filter invalidates the binding
  // and falls back to the local preview until the next search.
  const d = ui?.discovery;
  const eventMatches = !!d?.binding?.eventId && d.binding.eventId === (privateEvent?.id || '');
  const filtersMatch =
    !!d?.binding?.filters && JSON.stringify(d.binding.filters) === JSON.stringify(d?.filters || null);
  const bindingLive = eventMatches && filtersMatch;
  const semanticCards = d?.searched && !d?.loading && !d?.error && bindingLive && Array.isArray(d?.results)
    ? d.results.map(adaptDiscoveryMatch)
    : null;
  const searching = searchingExcerptsFor(ui);
  return {
    matches: semanticCards || localMatches,
    loading: !!ui?.real?.loading,
    error,
    guidance,
    needsTopics: needsTopicPick(privateEvent, picked),
    picked,
    topics: COMMUNITY_TOPICS,
    cities: CITY_OPTIONS,
    hasEvents: !!privateEvent,
    topicPreviewCount: localMatches.length,
    discovery: d
      ? {
          filters: { ...d.filters },
          query: discoveryQueryFor(ui, privateEvent),
          loading: !!d.loading,
          error: d.error || '',
          searched: !!d.searched,
          resultCount: Array.isArray(d.results) ? d.results.length : 0,
          showingSemantic: !!semanticCards,
          truncated: !!d.truncated,
          truncationNote: d.truncationNote || '',
          provider: d.provider || '',
          model: d.model || '',
          searching: searching.excerpts,
          searchingTotal: searching.total,
          simulated: !!d.simulated,
          // The animation preview is offered only when no live ranking is
          // available (mock mode): with live AI, real searches show the
          // real pending state instead.
          previewOffered: !liveDiscovery,
        }
      : null,
  };
}

// The search box text: what the narrator typed, or — when empty — the
// selected event's own summary as a starting point. Raw private answers
// are never used: only this visible text travels on Search, and only with
// the explicit Meta notice beside the button.
export function discoveryQueryFor(ui, privateEvent) {
  const typed = String(ui?.discovery?.query || '').trim();
  if (typed) return typed;
  const fallback = String(privateEvent?.excerpt || privateEvent?.title || '').trim();
  return fallback.slice(0, 500);
}

// Excerpts for the search-in-progress visualisation: the full ordered
// cycle list from the candidates bound to the LIVE search, in stable
// binding order — the overlay shows at most two at once (one on mobile)
// and crossfades through the rest. Only the already-public summary/passage
// text feeds them (the same allowlist the ranking request uses); private
// answers can never appear here. Withdrawn or revised rows are skipped,
// and anything but an in-flight search yields nothing — never a fake
// live-agent reading feed.
export const SEARCHING_EXCERPT_CHARS = 140;
export function searchingExcerptsFor(ui) {
  const d = ui?.discovery;
  if (!d?.loading || !d?.binding || !Array.isArray(d.binding.versions)) return { excerpts: [], total: 0 };
  const byId = new Map((Array.isArray(ui?.real?.rows) ? ui.real.rows : []).map((r) => [r?.id, r]));
  const excerpts = [];
  for (const v of d.binding.versions) {
    const row = byId.get(v?.id);
    if (!row || row.revision !== v?.revision) continue;
    const text = buildCandidateExcerpt(row).slice(0, SEARCHING_EXCERPT_CHARS).trim();
    if (!text) continue;
    excerpts.push({
      id: row.id,
      text,
      name: typeof row.pen_name === 'string' && row.pen_name ? row.pen_name : 'Shared story',
      title: typeof row.title === 'string' && row.title ? row.title : 'Shared story',
      // Origin highlight source: only finite published coordinates, never
      // invented — null lon/lat means the quote cycles without a marker.
      lon: Number.isFinite(row.lon) ? row.lon : null,
      lat: Number.isFinite(row.lat) ? row.lat : null,
      // Card origin label, same display preference as connect-real.js:
      // the published city name, never invented.
      city: row.event_city || row.city || null,
    });
  }
  return { excerpts, total: d.binding.versions.length };
}

// Rows refreshed (or a publication withdrawn): drop ranked results whose
// public row vanished or moved to a newer revision. Returns how many were
// dropped so the panel can say so honestly.
export function rebaseDiscoveryResults(ui, rows) {
  const d = ui?.discovery;
  if (!d || !Array.isArray(d.results) || !d.results.length) return { dropped: 0 };
  const { kept, dropped } = dropStaleDiscoveryResults(d.results, rows);
  d.results = kept;
  if (dropped > 0) d.error = '';
  return { dropped };
}

// Cancel an in-flight semantic search: abort the network call, clear the
// loading state, keep earlier results and filters untouched.
export function cancelDiscovery(ui) {
  try {
    ui?.discoveryAbort?.abort();
  } catch { /* already settled */ }
  ui.discoveryAbort = null;
  const d = ui?.discovery;
  if (!d) return;
  d.epoch += 1;
  d.loading = false;
  d.binding = null;
  d.simulated = false;
}

// The selected private event for matching, or null when the narrator has
// no confirmed events yet (honest empty state, never a guessed event).
export function privateEventFor(connectEvents, selectedId) {
  if (!Array.isArray(connectEvents) || !connectEvents.length) return null;
  return connectEvents.find((e) => e.id === selectedId) || connectEvents[0] || null;
}

export function isRealLiked(ui, publishedId) {
  return Array.isArray(ui?.real?.myLikes) && ui.real.myLikes.includes(publishedId);
}

export function applyLikeResult(ui, publishedId, liked) {
  const set = new Set(Array.isArray(ui?.real?.myLikes) ? ui.real.myLikes : []);
  if (liked) set.add(publishedId);
  else set.delete(publishedId);
  ui.real.myLikes = [...set];
}

// Shape server cloud-quote rows for display, bounded in memory. The list
// is a fresh array every time: callers can never grow it by pushing.
export function shapeCloudQuotes(rows, limit = CLOUD_QUOTE_LIMIT) {
  const list = Array.isArray(rows) ? rows.slice(0, limit) : [];
  return list
    .filter((q) => q && typeof q.text === 'string' && q.text.trim())
    .map((q) => ({
      id: typeof q.id === 'string' ? q.id : '',
      text: q.text,
      author: typeof q.author === 'string' && q.author ? q.author : 'Shared story',
      title: typeof q.source_title === 'string' && q.source_title ? q.source_title : 'Shared story',
      publishedId: typeof q.published_id === 'string' ? q.published_id : '',
      revision: Number.isInteger(q.published_revision) ? q.published_revision : null,
    }));
}

// Auth account change or sign-out: drop every community cache, the open
// real card, and the share session, and bump epochs so pending replies
// resolve stale and repaint nothing. Local stories, drafts, likes, and
// saved phrases are untouched.
export function resetCommunityUI(ui) {
  if (!ui) return ui;
  invalidateRealStore(ui.real);
  try {
    ui.discoveryAbort?.abort();
  } catch { /* already settled */ }
  ui.discoveryAbort = null;
  invalidateDiscoveryState(ui.discovery);
  ui.realFetched = false;
  ui.realLikesFor = null;
  ui.share = null;
  ui.openRealCard = null;
  ui.cloudQuotes = { rows: [], error: '', loading: false, loadedFor: null, epoch: (ui.cloudQuotes?.epoch || 0) + 1 };
  return ui;
}

// Explicit occasion-plus-topics selection, re-exported beside the
// matcher so topic checkboxes and the globe share one derivation.
export { selectionForEvent };

// Remove withdrawn public data immediately and invalidate late replies.
// A new Saved visit will load the current server collection.
export function withdrawPublicationCache(ui, publishedId) {
  if (!ui || !publishedId) return;
  if (ui.real) {
    ui.real.epoch += 1;
    ui.real.rows = (ui.real.rows || []).filter(r => r.id !== publishedId);
    ui.real.myLikes = (ui.real.myLikes || []).filter(id => id !== publishedId);
    ui.real.loading = false;
  }
  ui.realFetched = false;
  ui.realLikesFor = null;
  ui.cardSeq += 1;
  if (ui.openRealCard?.publishedId === publishedId) ui.openRealCard = null;
  if (ui.discovery && Array.isArray(ui.discovery.results) && ui.discovery.results.length) {
    const { kept } = dropStaleDiscoveryResults(ui.discovery.results, ui.real.rows);
    ui.discovery.results = kept;
  }
  const old = ui.cloudQuotes;
  ui.cloudQuotes = { rows: (old?.rows || []).filter(q => q.publishedId !== publishedId),
    loading: false, error: '', loadedFor: null, epoch: (old?.epoch || 0) + 1 };
}
