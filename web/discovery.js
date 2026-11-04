// Semantic discovery (Connect real mode): pure candidate/state helpers for
// one explicit "Search with Muse" click over already-public story excerpts.
//
// Privacy shape, enforced here:
// - Filters narrow candidates FIRST, locally, with no model call. The
//   deterministic date/city filters compose with the topic preview; both
//   run on the device over public rows.
// - Candidate excerpts are an allowlist: the public event summary plus the
//   public selected passages only, capped at 2000 characters. Private
//   answers, history, emails, UIDs, audio, images, and project JSON can
//   never enter a candidate by construction.
// - The narrator's own publications are excluded by id before any request
//   is built. At most 40 candidates travel; truncation is explicit.
// - Candidate ordering before the 40-cut is lexical (by public id), never
//   by topic overlap: a candidate that shares no broad topic word but
//   describes the same lived experience in different words (synonyms) must
//   not be dropped simply because the broad topic is missing. Ranking for
//   meaning is the model's job; this module only narrows deterministically.
// - The search text is narrator-typed (prefilled from the selected event
//   summary, never from raw private answers) plus public excerpts. The
//   request object is built field-by-field: {query, candidates:[{id,
//   revision, text}]} — extra or private fields cannot pass through.
// - Results are validated fail-closed (unknown ids, revision mismatches,
//   non-exact evidence spans are rejected). A model result never claims
//   the same occasion: same_occasion comes only from the structured
//   occasion-id check in community.js, never from a ranking.
// - Every search binds the query, filters, selected event, account UID,
//   and public row versions; rows that are withdrawn or revised after the
//   search are dropped, and late replies from a superseded search are
//   discarded instead of painted.
import {
  applyDiscoveryFilters,
  defaultDiscoveryFilters,
  normalizeDiscoveryFilters,
} from './community.js';
import {
  DISCOVERY_LIMITS,
  validateDiscoveryInput,
  validateDiscoveryResult,
} from './ai-contracts.js';
import {apiAuthHeaders, ensureApiToken} from './api-auth.js';

export const DISCOVERY_MAX_CANDIDATES = DISCOVERY_LIMITS.MAX_CANDIDATES;
export const DISCOVERY_MAX_EXCERPT = DISCOVERY_LIMITS.MAX_CANDIDATE_TEXT;
export const DISCOVERY_MAX_QUERY = DISCOVERY_LIMITS.MAX_QUERY;

// The narrator-typed search text: 1-500 characters. Anything else is an
// honest error, never a silent trim or a guessed query.
export function buildDiscoveryQuery(searchText) {
  const query = String(searchText ?? '').trim();
  if (!query) return { error: 'Describe what to look for first — one sentence is enough.' };
  if (query.length > DISCOVERY_MAX_QUERY)
    return { error: `Keep the search under ${DISCOVERY_MAX_QUERY} characters.` };
  return { query };
}

// Candidate excerpt allowlist: the public event summary plus the public
// selected passages, joined and capped at 2000 characters. Only these two
// public sources feed the excerpt; titles, cities, and topics stay out so
// the model ranks lived-experience wording, not metadata labels.
export function buildCandidateExcerpt(row) {
  const parts = [];
  const summary = String(row?.event_summary ?? '').trim();
  if (summary) parts.push(summary);
  const passages = Array.isArray(row?.passages) ? row.passages : [];
  for (const p of passages) {
    const text = typeof p === 'string' ? p : p?.text;
    if (typeof text === 'string' && text.trim()) parts.push(text.trim());
  }
  return parts.join('\n\n').slice(0, DISCOVERY_MAX_EXCERPT);
}

function validCandidateRow(row) {
  return (
    !!row &&
    typeof row.id === 'string' &&
    !!row.id &&
    Number.isInteger(row.revision) &&
    row.revision >= 1 &&
    !!buildCandidateExcerpt(row).trim()
  );
}

// Narrow public rows to bounded request candidates. Date/city filters run
// FIRST (no model involved), then own ids are excluded, then rows without
// usable public text are skipped. The survivors are ordered lexically by
// public id for a stable, topic-independent cut at 40: synonym-rich
// candidates survive the cut exactly like topic-matching ones. Truncation
// is reported explicitly, never silently.
export function buildDiscoveryCandidates(rows, { filters = null, excludeIds = null } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const narrowed = filters ? applyDiscoveryFilters(list, filters) : [...list];
  const excluded = new Set(
    excludeIds instanceof Set
      ? [...excludeIds]
      : Array.isArray(excludeIds)
        ? excludeIds
        : [],
  );
  const usable = narrowed
    .filter((row) => row && !excluded.has(row.id))
    .filter(validCandidateRow)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const truncated = usable.length > DISCOVERY_MAX_CANDIDATES;
  const candidates = usable.slice(0, DISCOVERY_MAX_CANDIDATES).map((row) => ({
    id: row.id,
    revision: row.revision,
    text: buildCandidateExcerpt(row),
  }));
  return {
    candidates,
    truncated,
    truncationNote: truncated
      ? `Showing the first ${DISCOVERY_MAX_CANDIDATES} of ${usable.length} matching shared stories (ordered by story id). Narrow the filters to see the rest — nothing was hidden by topic.`
      : '',
    considered: usable.length,
  };
}

// The exact request sent to POST /api/ai/discovery, constructed
// field-by-field from the query and the already-narrowed public
// candidates. Extra or private input fields cannot pass through: only
// {query, candidates:[{id, revision, text}]} is built. Empty candidate
// lists are an honest no-search — the caller must make NO model call.
export function buildDiscoveryRequest(query, candidates) {
  const q = String(query ?? '').trim();
  if (!q) return { error: 'Describe what to look for first — one sentence is enough.' };
  if (q.length > DISCOVERY_MAX_QUERY)
    return { error: `Keep the search under ${DISCOVERY_MAX_QUERY} characters.` };
  const list = Array.isArray(candidates) ? candidates : [];
  if (!list.length)
    return { error: 'No shared stories match those filters. Widen the years or city — no search was sent.' };
  if (list.length > DISCOVERY_MAX_CANDIDATES)
    return { error: `Too many candidates for one search (${list.length}). Narrow the filters first.` };
  const seen = new Set();
  const clean = [];
  for (const c of list) {
    if (!c || typeof c.id !== 'string' || !c.id || !Number.isInteger(c.revision) || c.revision < 1)
      return { error: 'A candidate story is incomplete. Search again.' };
    if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > DISCOVERY_MAX_EXCERPT)
      return { error: 'A candidate excerpt is incomplete. Search again.' };
    if (seen.has(c.id)) return { error: 'A candidate story appears twice. Search again.' };
    seen.add(c.id);
    clean.push({ id: c.id, revision: c.revision, text: c.text });
  }
  return { request: { query: q, candidates: clean } };
}

// Validate a raw model ranking fail-closed and map each entry onto its
// ACTUAL public row. Unknown ids, revision mismatches, out-of-range
// scores, and evidence spans that are not exact substrings of the cited
// side are all rejected — fabricated content never reaches the UI. The
// mapped entries carry the real row, the model's reason and exact
// evidence, and the provider/model that ranked them. matchType is always
// similar_experience here: the same occasion is proven only by the
// structured occasion-id check, never by a model claim.
export function mapDiscoveryResults(rawResult, context, rowsById, providerInfo = {}) {
  const ranked = validateDiscoveryResult(rawResult, context);
  const byId = rowsById instanceof Map ? rowsById : new Map();
  const mapped = [];
  for (const r of ranked.results) {
    const row = byId.get(r.id);
    if (!row || row.revision !== r.revision)
      throw Error('A ranked story changed since the search began. Search again.');
    mapped.push({
      row,
      matchType: 'similar_experience',
      score: r.score,
      reason: r.reason,
      queryEvidence: r.queryEvidence,
      candidateEvidence: r.candidateEvidence,
      provider: providerInfo.provider || 'meta',
      model: providerInfo.model || 'muse-spark-1.3',
    });
  }
  return mapped;
}

// Map raw ranked entries onto the CURRENT public rows, dropping entries
// whose row was withdrawn or revised after the search began instead of
// failing the whole ranking. Each survivor still passes the strict
// fail-closed validation (exact ids, revisions, and evidence spans), so
// fabricated content never reaches the UI.
export function mapFreshDiscoveryResults(rawResults, request, currentRows, providerInfo = {}) {
  const rows = Array.isArray(currentRows) ? currentRows : [];
  const byId = new Map(rows.map((r) => [r?.id, r]));
  const raws = Array.isArray(rawResults) ? rawResults : [];
  const fresh = raws.filter((r) => {
    const row = byId.get(r?.id);
    return !!row && row.revision === r?.revision;
  });
  const dropped = raws.length - fresh.length;
  const freshIds = new Set(fresh.map((r) => r.id));
  const context = {
    query: request?.query,
    candidates: (Array.isArray(request?.candidates) ? request.candidates : []).filter((c) => freshIds.has(c?.id)),
  };
  const mapped = mapDiscoveryResults({ results: fresh }, context, byId, providerInfo);
  return { mapped, dropped };
}

// Drop mapped results whose public row has since been withdrawn or
// revised: revision equality against the CURRENT rows is the binding.
// Returns the kept entries plus an honest count of dropped ones.
export function dropStaleDiscoveryResults(mapped, currentRows) {
  const byId = new Map((Array.isArray(currentRows) ? currentRows : []).map((r) => [r?.id, r]));
  const kept = [];
  let dropped = 0;
  for (const m of Array.isArray(mapped) ? mapped : []) {
    const row = byId.get(m?.row?.id);
    if (row && row.revision === m?.row?.revision) kept.push({ ...m, row });
    else dropped += 1;
  }
  return { kept, dropped };
}

// One discovery session: filters, search text, binding, and results.
// The binding snapshots the query, normalized filters, selected event,
// account UID, and every candidate's (id, revision) at search time; any
// change invalidates it, and late replies from a superseded search are
// discarded by epoch.
export function createDiscoveryState() {
  return {
    filters: defaultDiscoveryFilters(),
    query: '',
    binding: null,
    results: [],
    error: '',
    loading: false,
    epoch: 0,
    searched: false,
    truncated: false,
    truncationNote: '',
    provider: '',
    model: '',
    simulated: false, // labelled preview: cycles bound excerpts with no model call
  };
}

export function setDiscoveryFilters(state, input) {
  const r = normalizeDiscoveryFilters(input);
  if (r.error) return { error: r.error };
  state.filters = r.filters;
  state.binding = null;
  return { filters: r.filters };
}

// Freeze the search binding before the single allowed model call: the
// query text, normalized filters, selected event id, account UID, and the
// exact candidate (id, revision) pairs the model will rank.
export function beginDiscoverySearch(state, { query, candidates, eventId = '', uid = '' }) {
  state.epoch += 1;
  const q = buildDiscoveryQuery(query);
  if (q.error) return { error: q.error };
  const built = buildDiscoveryRequest(q.query, candidates);
  if (built.error) return { error: built.error };
  state.query = q.query;
  state.loading = true;
  state.error = '';
  state.binding = {
    query: q.query,
    filters: { ...state.filters },
    eventId: String(eventId || ''),
    uid: String(uid || ''),
    versions: built.request.candidates.map((c) => ({ id: c.id, revision: c.revision })),
    epoch: state.epoch,
  };
  return { request: built.request, token: state.epoch };
}

// True only when this reply still belongs to the live search: same epoch,
// same query, same filters, same event, same account. Anything else is a
// stale async reply and must be discarded, never painted.
export function isDiscoveryBindingFresh(state, token, { eventId = '', uid = '' } = {}) {
  if (!state || token !== state.epoch || !state.binding) return false;
  return state.binding.eventId === String(eventId || '') && state.binding.uid === String(uid || '');
}

export function settleDiscoverySearch(state, token, outcome) {
  if (!state || token !== state.epoch) return false;
  state.loading = false;
  if (outcome?.ok) {
    state.results = Array.isArray(outcome.results) ? outcome.results : [];
    state.provider = outcome.provider || 'meta';
    state.model = outcome.model || 'muse-spark-1.3';
    state.truncated = !!outcome.truncated;
    state.truncationNote = outcome.truncationNote || '';
    state.error = '';
    state.searched = true;
  } else {
    state.results = [];
    state.error = outcome?.error || 'The search could not be completed. Nothing was changed.';
  }
  return true;
}

export function invalidateDiscoveryState(state) {
  if (!state) return;
  state.epoch += 1;
  state.loading = false;
  state.binding = null;
  state.results = [];
  state.error = '';
  state.searched = false;
  state.simulated = false;
}

// POST the allowlisted request on the narrator's explicit Search click
// only. The caller guarantees the request came from buildDiscoveryRequest;
// an empty candidate list never reaches the network. Throws on HTTP and
// validation failures so the UI can report honestly (including 503 model-
// not-configured, which must read as unavailable, never as a fake local
// semantic fallback).
export async function fetchDiscoveryResults(request, { fetcher = globalThis.fetch, signal } = {}) {
  validateDiscoveryInput(request);
  await ensureApiToken();
  let res;
  try {
    res = await fetcher('/api/ai/discovery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...apiAuthHeaders() },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw Error('The search was cancelled. Nothing was changed.');
    throw Error('The search could not reach the server. Nothing was changed.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    throw Error('The search returned an unreadable answer. Nothing was changed.');
  }
  if (!res.ok) {
    if (res.status === 503)
      throw Error('Semantic search is not set up on this server. The local topic preview below still works — no fake ranking was used.');
    throw Error(data?.error || 'The search could not be completed. Nothing was changed.');
  }
  // Validated here against the exact request candidates; the caller maps
  // the raw entries onto the ACTUAL public rows with mapDiscoveryResults,
  // so withdrawn or revised rows are dropped before anything is painted.
  const ranked = validateDiscoveryResult({ results: data?.results }, request);
  return { results: ranked.results, provider: data?.provider || 'meta', model: data?.model || 'muse-spark-1.3' };
}
