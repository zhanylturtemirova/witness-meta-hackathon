// Real opt-in community: publishing allowlisted story copies, private
// local matching against public metadata, per-user likes, and exact
// saved quotes with attribution.
//
// Privacy shape, enforced here and in the migration:
// - Publishing copies ONLY the fields the narrator explicitly chose
//   (pen name, title, selected passages verbatim, one confirmed event,
//   an explicitly chosen city, topics, optional occasion id). Interview
//   answers and history, auth email/UID, raw audio, images, and the
//   whole project JSON never leave the device through this module.
// - Matching compares the SELECTED PRIVATE EVENT LOCALLY with public
//   story metadata. The private event is never uploaded for matching.
// - Public readers see pen names, never personal emails; owner UUIDs
//   and private story IDs stay out of every public select below.
// - Public story copies are held in memory only and never written into
//   the private stories store.
//
// Every Supabase call takes an injected `client` (the official client
// or a test fake) and never touches the network when the tables are
// missing: a missing migration reads as an honest setup message.
import { entryStatus } from './event-model.js';
import { CITY_OPTIONS } from './connect-events.js';

export const PUBLISHED_TABLE = 'published_stories';
export const LIKES_TABLE = 'story_likes';
export const QUOTES_TABLE = 'witness_quotes';
export const BOOKS_TABLE = 'witness_books';
export const PROFILES_TABLE = 'witness_profiles';
export const PUBLISH_RPC = 'witness_publish_story';
export const PUBLISH_RPC_V2 = 'witness_publish_story_v2';
export const MY_PUBLICATIONS_RPC = 'witness_my_publications';
export const QUOTE_RPC = 'witness_save_quote';
export const BOOK_RPC = 'witness_save_book';

// The only columns a public read may request. Owner UUIDs and the
// private story reference are deliberately absent.
export const PUBLIC_COLUMNS = [
  'id', 'pen_name', 'title', 'passages',
  'event_title', 'event_summary', 'event_city',
  'event_date_text', 'event_year', 'date_approx',
  'city', 'lon', 'lat', 'topics', 'occasion_id',
  'revision', 'like_count', 'updated_at',
];

export const MAX_PEN_NAME = 40;
export const MAX_PUBLISH_TITLE = 120;
export const MAX_PASSAGES = 20;
export const MAX_PASSAGE_CHARS = 5000;
export const MAX_EVENT_SUMMARY = 500;
export const MAX_TOPICS = 5;
export const MAX_OCCASION = 80;
export const MAX_REAL_QUOTE = 2000;
export const MAX_EVENT_DATE_TEXT = 120;
export const MIN_EVENT_YEAR = 1800;
export const MAX_EVENT_YEAR = 2100;

export const COMMUNITY_TOPICS = [
  { id: 'moving-abroad', label: 'Starting over somewhere new' },
  { id: 'first-concert', label: 'A first live concert' },
  { id: 'first-project', label: 'Making something of your own' },
  { id: 'turning-point', label: 'A turning point' },
  { id: 'family', label: 'Family and the people who stayed' },
  { id: 'everyday', label: 'An ordinary, unforgettable day' },
  { id: 'work', label: 'Work and learning a trade' },
  { id: 'celebration', label: 'A celebration worth keeping' },
];

const topicIds = () => COMMUNITY_TOPICS.map((t) => t.id);
export function topicLabel(id) {
  return COMMUNITY_TOPICS.find((t) => t.id === id)?.label || id;
}

function clean(v) {
  return String(v ?? '').trim();
}

// Event-date metadata: deterministic, never guessed. The narrator's own
// wording (e.g. 'around 2019') is preserved verbatim; only an explicit
// four-digit year is ever extracted, and a missing or unrecognised date
// stays unknown (null) rather than invented.
export function parseEventYear(text) {
  const m = String(text ?? '').match(/(\d{4})/);
  if (!m) return null;
  const year = Number(m[1]);
  if (!Number.isInteger(year) || year < MIN_EVENT_YEAR || year > MAX_EVENT_YEAR) return null;
  return year;
}

export function isApproxDateText(text) {
  return /~|\b(around|about|circa|approx|approximately|roughly|early|late|mid|spring|summer|autumn|fall|winter|unsure|maybe|not sure|do not remember|don't remember)\b/i
    .test(String(text ?? ''));
}

// An optional explicit year: empty stays unknown, otherwise a bounded
// integer. Anything else is an honest error, never a silent guess.
export function validateEventYear(value) {
  if (value === null || value === undefined || String(value).trim() === '')
    return { year: null };
  const year = Number(String(value).trim());
  if (!Number.isInteger(year) || year < MIN_EVENT_YEAR || year > MAX_EVENT_YEAR)
    return { error: `The year must be between ${MIN_EVENT_YEAR} and ${MAX_EVENT_YEAR}, or left empty when unknown.` };
  return { year };
}

// Deterministic discovery filters: bounded 'From year'/'To year', one
// explicit city (or all cities), and an explicit unknown-dates toggle.
// AI-independent: these narrow candidates before any model call.
export function normalizeDiscoveryFilters(input) {
  const from = validateEventYear(input?.fromYear);
  if (from.error) return { error: from.error };
  const to = validateEventYear(input?.toYear);
  if (to.error) return { error: to.error };
  if (from.year != null && to.year != null && from.year > to.year)
    return { error: 'The “from” year must not be after the “to” year.' };
  const cityName = clean(input?.city);
  if (cityName) {
    const known = CITY_OPTIONS.some((c) => c.name === cityName.toLowerCase());
    if (!known) return { error: 'Choose a city from the list, or all cities.' };
  }
  return {
    filters: {
      fromYear: from.year,
      toYear: to.year,
      city: cityName ? cityName.toLowerCase() : '',
      includeUnknownDates: input?.includeUnknownDates !== false,
    },
  };
}

export function defaultDiscoveryFilters() {
  return { fromYear: null, toYear: null, city: '', includeUnknownDates: true };
}

// The comparable year of a public row: the stored explicit year first,
// otherwise a year parsed from the stored wording, otherwise unknown.
// Parsing never runs on private data — only on already-public metadata.
export function rowEventYear(row) {
  const stored = Number(row?.event_year);
  if (Number.isInteger(stored) && stored >= MIN_EVENT_YEAR && stored <= MAX_EVENT_YEAR) return stored;
  return parseEventYear(row?.event_date_text);
}

function rowCityKey(row) {
  return clean(row?.city || row?.event_city).toLowerCase();
}

// Narrow public rows by the deterministic filters. Unknown dates pass
// only when the toggle says so; a city or a date alone never relates two
// stories — this only narrows, it never creates a match.
export function applyDiscoveryFilters(rows, filters) {
  const list = Array.isArray(rows) ? rows : [];
  const f = filters || {};
  const city = clean(f.city).toLowerCase();
  return list.filter((row) => {
    if (!row) return false;
    if (city) {
      const key = rowCityKey(row);
      const option = CITY_OPTIONS.find((c) => c.name === city);
      const label = (option ? option.label : city).toLowerCase();
      if (key !== city && key !== label) return false;
    }
    const year = rowEventYear(row);
    if (year == null) return f.includeUnknownDates !== false;
    if (f.fromYear != null && year < f.fromYear) return false;
    if (f.toYear != null && year > f.toYear) return false;
    return true;
  });
}

// Honest one-line summary of the active filters for the UI.
export function filterSummary(filters) {
  const parts = [];
  const f = filters || {};
  if (f.city) {
    const option = CITY_OPTIONS.find((c) => c.name === clean(f.city).toLowerCase());
    parts.push(option ? option.label : clean(f.city));
  }
  if (f.fromYear != null || f.toYear != null)
    parts.push(`${f.fromYear != null ? f.fromYear : '…'}–${f.toYear != null ? f.toYear : '…'}`);
  parts.push(f.includeUnknownDates !== false ? 'including unknown dates' : 'known dates only');
  return parts.join(' · ');
}

function validShape(row) {
  return (
    !!row && typeof row.id === 'string' && !!row.id &&
    typeof row.pen_name === 'string' && typeof row.title === 'string' &&
    Array.isArray(row.passages) && row.passages.length > 0 &&
    Array.isArray(row.topics) && Number.isInteger(row.revision) && row.revision >= 1
  );
}

// Builds the publish preview from explicit narrator choices only.
// Nothing is sent anywhere; the caller renders the preview and only
// publishes on a second explicit action.
export function buildPublishPreview({
  project, penName, title, passageIds,
  eventEntry, cityName, topics, occasionId,
  eventDateText, eventYear, dateApprox,
}) {
  if (!project || project.example)
    return { error: 'Fictional examples stay in the demo. Publish one of your own finished stories.' };
  if (!project.story || !Array.isArray(project.story.passages) || !project.story.passages.length)
    return { error: 'That story has no finished passages yet. Nothing was shared.' };
  const pen = clean(penName);
  if (!pen) return { error: 'Choose a pen name first. It is the only name readers will see.' };
  if (pen.length > MAX_PEN_NAME) return { error: `Keep the pen name under ${MAX_PEN_NAME} characters.` };
  const name = clean(title);
  if (!name) return { error: 'Give the shared copy a title first.' };
  if (name.length > MAX_PUBLISH_TITLE) return { error: `Keep the shared title under ${MAX_PUBLISH_TITLE} characters.` };
  const ids = Array.isArray(passageIds) ? passageIds : [];
  if (!ids.length) return { error: 'Select at least one passage to share.' };
  if (ids.length > MAX_PASSAGES) return { error: `Share at most ${MAX_PASSAGES} passages.` };
  const passages = [];
  for (const pid of ids) {
    const live = project.story.passages.find((s) => s.id === pid);
    if (!live || typeof live.text !== 'string' || !live.text.trim())
      return { error: 'One selected passage is no longer in the story. Review the selection.' };
    if (live.text.length > MAX_PASSAGE_CHARS)
      return { error: 'One passage is too long to share. Shorten it in your story first.' };
    passages.push({ passageId: live.id, text: live.text });
  }
  if (!eventEntry || entryStatus(eventEntry, project.answers || []) !== 'Confirmed')
    return { error: 'Choose one confirmed event to share. Drafts stay private until reviewed.' };
  const city = CITY_OPTIONS.find((c) => c.name === clean(cityName).toLowerCase());
  if (!city) return { error: 'Choose a city from the list. Locations are never guessed.' };
  const picked = Array.isArray(topics) ? [...new Set(topics)] : [];
  if (!picked.length) return { error: 'Choose at least one topic so readers can find it.' };
  if (picked.length > MAX_TOPICS) return { error: `Choose at most ${MAX_TOPICS} topics.` };
  for (const t of picked) {
    if (!topicIds().includes(t)) return { error: 'One topic is not on the list. Choose from the list.' };
  }
  const occasion = clean(occasionId);
  if (occasion.length > MAX_OCCASION) return { error: `Keep the occasion identifier under ${MAX_OCCASION} characters.` };
  // Original event date wording: the confirmed event's dateText by
  // default, preserved verbatim (e.g. 'around 2019') — never sharpened
  // into an exact day. An optional explicit year plus an approximate
  // flag travel alongside; both stay unknown unless stated.
  const confirmedDateText = clean(eventEntry.dateText).slice(0, MAX_EVENT_DATE_TEXT);
  const rawWording = (eventDateText === undefined || eventDateText === null || String(eventDateText).trim() === '')
    ? confirmedDateText
    : clean(eventDateText);
  if (rawWording.length > MAX_EVENT_DATE_TEXT)
    return { error: `Keep the event date wording under ${MAX_EVENT_DATE_TEXT} characters.` };
  const dateWording = rawWording;
  const explicitYear = validateEventYear(eventYear);
  if (explicitYear.error) return { error: explicitYear.error };
  const approx = typeof dateApprox === 'boolean' ? dateApprox : isApproxDateText(dateWording || confirmedDateText);
  const year = explicitYear.year != null ? explicitYear.year : parseEventYear(dateWording);
  return {
    preview: {
      storyId: project.id, // private reference: used for owner updates, never published
      penName: pen,
      title: name,
      passages,
      event: {
        title: clean(eventEntry.title).slice(0, MAX_PUBLISH_TITLE) || 'Untitled event',
        summary: clean(eventEntry.summary).slice(0, MAX_EVENT_SUMMARY),
        city: city.label,
        dateText: dateWording,
        year,
        approx,
      },
      city: city.label,
      lon: city.lon,
      lat: city.lat,
      topics: picked,
      occasionId: occasion || null,
    },
  };
}

// The allowlisted public copy: everything a stranger may read, and
// nothing else. Private story IDs, answers, history, emails, media,
// and project JSON cannot pass through this function by construction.
export function publicCopyOf(preview) {
  return {
    pen_name: preview.penName,
    title: preview.title,
    passages: preview.passages.map((p) => ({ text: p.text })),
    event_title: preview.event.title,
    event_summary: preview.event.summary,
    event_city: preview.event.city,
    event_date_text: preview.event?.dateText || null,
    event_year: Number.isInteger(preview.event?.year) ? preview.event.year : null,
    date_approx: !!preview.event?.approx,
    city: preview.city,
    lon: preview.lon,
    lat: preview.lat,
    topics: [...preview.topics],
    occasion_id: preview.occasionId,
  };
}

// Local matching of one selected private event against public rows.
// Same occasion needs an explicit shared occasion ID on BOTH sides —
// a shared city or date alone is never proof. Similar experience needs
// at least one shared topic. Rows and selections without topics or an
// occasion cannot match, and read as an honest empty state.
export function matchRealStories(selection, rows, filters = null) {
  const occasion = clean(selection?.occasionId);
  const topics = Array.isArray(selection?.topics) ? [...new Set(selection.topics)] : [];
  const shaped = Array.isArray(rows) ? rows.filter(validShape) : [];
  // Deterministic date/place filters narrow the pool first, independent
  // of topics and of any AI. They never create a match on their own.
  const list = filters ? applyDiscoveryFilters(shaped, filters) : shaped;
  const matches = [];
  for (const row of list) {
    const rowOccasion = clean(row.occasion_id);
    if (occasion && rowOccasion && occasion === rowOccasion) {
      matches.push({
        row,
        matchType: 'same_occasion',
        sharedTopics: topics.filter((t) => (row.topics || []).includes(t)),
        evidence: [`Same occasion: ${occasion}.`, `${row.event_city || row.city} · ${row.event_title}`],
      });
      continue;
    }
    const shared = topics.filter((t) => (row.topics || []).includes(t));
    if (shared.length) {
      matches.push({
        row,
        matchType: 'similar_experience',
        sharedTopics: shared,
        evidence: shared.map((t) => `Shared topic: ${topicLabel(t)}.`),
      });
    }
  }
  return matches;
}

export function realMatchGuidance(selection) {
  const occasion = clean(selection?.occasionId);
  const topics = Array.isArray(selection?.topics) ? selection.topics.filter((t) => topicIds().includes(t)) : [];
  if (!occasion && !topics.length)
    return 'Choose at least one topic or an occasion identifier to look for related stories. A city or date alone is not enough to relate two stories.';
  return '';
}

// Exact quote validation against a public row. Attribution always comes
// from the row itself — never from browser input — and the revision
// must still match, so quotes cannot be attached to a version the
// narrator has already replaced.
export function validateRealQuote(text, row, expectedRevision) {
  const quote = String(text ?? '').replace(/^\s+|\s+$/g, '');
  if (!quote) return { error: 'Select the words you want to keep first.' };
  if (quote.length > MAX_REAL_QUOTE) return { error: 'That passage is too long to save. Choose a shorter phrase.' };
  if (!row || !validShape(row)) return { error: 'That story is no longer shared. Nothing was saved.' };
  if (Number(expectedRevision) !== Number(row.revision))
    return { error: 'That story changed since you opened it. Open it again before saving words from it.', stale: true };
  const passages = row.passages
    .map((p) => (typeof p === 'string' ? p : p?.text))
    .filter((t) => typeof t === 'string');
  const found = passages.some((para) => para.includes(quote));
  if (!found) return { error: 'The saved words must match the shared story exactly.' };
  return {
    ok: true,
    attribution: {
      author: row.pen_name,
      title: row.title,
      publishedId: row.id,
      revision: row.revision,
    },
  };
}

function networkLike(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return err instanceof TypeError || /network|fetch|offline|load failed|failed to fetch|econn|enotfound|timeout/i.test(msg);
}

function missingTable(err) {
  return /relation .* does not exist|table .* does not exist|PGRST|schema cache|Could not find the table|mcp|column .* does not exist|Could not find the .* column|function .* does not exist/i.test(String(err?.message || err || ''));
}

function missingRpc(err) {
  return /function .* does not exist|could not find the function|schema cache|PGRST205|42883/i.test(String(err?.message || err || ''));
}

function authLike(err) {
  return /expired|jwt|auth|permission|policy|rls|unauthorized|401|403/i.test(String(err?.message || err || ''));
}

export function communityError(err, fallback) {
  if (!err || networkLike(err))
    return 'Witness could not reach the community service. You may be offline — your stories on this device are unchanged.';
  if (missingTable(err))
    return 'Community sharing is not set up yet: the new tables have not been created. Your stories on this device are unchanged.';
  if (authLike(err))
    return 'Your sign-in expired. Sign in again — your stories on this device are unchanged.';
  if (/revision|conflict|newer|stale/i.test(String(err?.message || err || '')))
    return 'That shared copy changed since you opened it (another tab or device, or a newer publish). Open it again before changing anything — nothing was overwritten.';
  return fallback || 'Something did not work. Nothing was changed.';
}

// Reads the allowlisted public columns only. Guests may read; a missing
// migration reads as setup guidance, never as an empty community.
export async function fetchPublished(client, limit = 100) {
  try {
    const { data, error } = await client
      .from(PUBLISHED_TABLE)
      .select(PUBLIC_COLUMNS.join(','))
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) return { ok: false, error: communityError(error) };
    return { ok: true, rows: (Array.isArray(data) ? data : []).filter(validShape) };
  } catch (err) {
    return { ok: false, error: communityError(err) };
  }
}

// The owner's own rows (full fields, owner-scoped inside the RPC) for
// the update/unpublish step. Never shown to anyone else: public grants
// exclude the owner columns, so this goes through the RPC, not a select.
export async function listMyPublications(client, acc) {
  if (!acc?.userId) return { ok: false, error: 'Sign in to see your shared copies.' };
  try {
    const { data, error } = await client.rpc(MY_PUBLICATIONS_RPC, {});
    if (error) return { ok: false, error: communityError(error) };
    return { ok: true, rows: (Array.isArray(data) ? data : []).filter((r) => r && r.owner_id === acc.userId) };
  } catch (err) {
    return { ok: false, error: communityError(err) };
  }
}

export async function publishCopy(client, acc, preview, expectedRevision) {
  if (!acc?.userId) return { ok: false, error: 'Sign in to publish. Your story on this device is unchanged.' };
  if (!preview || !preview.storyId) return { ok: false, error: 'Review the preview first. Nothing was published.' };
  const copy = publicCopyOf(preview);
  try {
    const { data, error } = await client.rpc(PUBLISH_RPC, {
      p_id: preview.publishedId || null,
      p_story_id: preview.storyId,
      p_pen_name: copy.pen_name,
      p_title: copy.title,
      p_passages: copy.passages,
      p_event_title: copy.event_title,
      p_event_summary: copy.event_summary,
      p_event_city: copy.event_city,
      p_city: copy.city,
      p_lon: copy.lon,
      p_lat: copy.lat,
      p_topics: copy.topics,
      p_occasion_id: copy.occasion_id,
      p_expected_revision: expectedRevision ?? 0,
    });
    if (error) {
      const conflict = /revision|conflict|newer|stale/i.test(String(error?.message || ''));
      return { ok: false, conflict, error: communityError(error, 'That copy could not be published. Nothing was changed.') };
    }
    const revision = Number(data?.revision);
    if (!Number.isInteger(revision) || revision < 1)
      return { ok: false, error: 'The shared copy could not be confirmed. Nothing was changed.' };
    return { ok: true, revision, publishedId: data?.id || preview.publishedId || null };
  } catch (err) {
    return { ok: false, error: communityError(err, 'That copy could not be published. Nothing was changed.') };
  }
}

// Publishing WITH event-date metadata through the v2 RPC. When the v2
// function is not installed yet (migration pending), this fails closed
// with setupPending instead of silently storing a copy without the
// narrator's date wording — never a fallback that pretends otherwise.
export async function publishCopyV2(client, acc, preview, expectedRevision) {
  if (!acc?.userId) return { ok: false, error: 'Sign in to publish. Your story on this device is unchanged.' };
  if (!preview || !preview.storyId) return { ok: false, error: 'Review the preview first. Nothing was published.' };
  const copy = publicCopyOf(preview);
  try {
    const { data, error } = await client.rpc(PUBLISH_RPC_V2, {
      p_id: preview.publishedId || null,
      p_story_id: preview.storyId,
      p_pen_name: copy.pen_name,
      p_title: copy.title,
      p_passages: copy.passages,
      p_event_title: copy.event_title,
      p_event_summary: copy.event_summary,
      p_event_city: copy.event_city,
      p_event_date_text: copy.event_date_text,
      p_event_year: copy.event_year,
      p_date_approx: copy.date_approx,
      p_city: copy.city,
      p_lon: copy.lon,
      p_lat: copy.lat,
      p_topics: copy.topics,
      p_occasion_id: copy.occasion_id,
      p_expected_revision: expectedRevision ?? 0,
    });
    if (error) {
      if (missingRpc(error))
        return {
          ok: false,
          setupPending: true,
          error: 'The sharing setup on the server is older than this app: the date fields from migration 20261105_discovery.sql are not installed yet. Nothing was shared.',
        };
      const conflict = /revision|conflict|newer|stale/i.test(String(error?.message || ''));
      return { ok: false, conflict, error: communityError(error, 'That copy could not be published. Nothing was changed.') };
    }
    const revision = Number(data?.revision);
    if (!Number.isInteger(revision) || revision < 1)
      return { ok: false, error: 'The shared copy could not be confirmed. Nothing was changed.' };
    return { ok: true, revision, publishedId: data?.id || preview.publishedId || null };
  } catch (err) {
    if (missingRpc(err))
      return {
        ok: false,
        setupPending: true,
        error: 'The sharing setup on the server is older than this app: the date fields from migration 20261105_discovery.sql are not installed yet. Nothing was shared.',
      };
    return { ok: false, error: communityError(err, 'That copy could not be published. Nothing was changed.') };
  }
}

// Unpublishing removes the public copy; likes and saved quotes on it
// are withdrawn by cascade. The private story is untouched.
//
// Id-only DELETE: ownership is enforced by the
// published_stories_owner_delete RLS policy (auth.uid() = owner_id), so no
// owner_id filter is sent. Filtering on owner_id would fail because the
// authenticated role is deliberately granted SELECT on the allowlisted
// public columns only — owner_id stays readable solely through the
// owner-scoped RPC. No column grant is widened here.
export async function unpublishCopy(client, acc, publishedId) {
  if (!acc?.userId) return { ok: false, error: 'Sign in to manage your shared copies.' };
  if (!publishedId) return { ok: false, error: 'Choose a shared copy first.' };
  try {
    const { error } = await client.from(PUBLISHED_TABLE).delete().eq('id', publishedId);
    if (error) return { ok: false, error: communityError(error, 'That copy could not be withdrawn. Nothing was changed.') };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: communityError(err, 'That copy could not be withdrawn. Nothing was changed.') };
  }
}

export async function toggleRealLike(client, acc, publishedId, currentlyLiked) {
  if (!acc?.userId) return { ok: false, error: 'Sign in to like a shared story. The story stays readable.' };
  if (!publishedId) return { ok: false, error: 'Choose a story first.' };
  try {
    if (currentlyLiked) {
      const { error } = await client.from(LIKES_TABLE).delete().eq('published_id', publishedId).eq('user_id', acc.userId);
      if (error) return { ok: false, error: communityError(error, 'That like could not be removed.') };
      return { ok: true, liked: false };
    }
    const { error } = await client.from(LIKES_TABLE).insert({ published_id: publishedId, user_id: acc.userId });
    if (error) {
      if (/duplicate|unique|already/i.test(String(error?.message || ''))) return { ok: true, liked: true };
      return { ok: false, error: communityError(error, 'That like could not be saved.') };
    }
    return { ok: true, liked: true };
  } catch (err) {
    return { ok: false, error: communityError(err, 'That like could not be saved.') };
  }
}

export async function loadMyLikes(client, acc) {
  if (!acc?.userId) return { ok: false, error: 'Sign in to see your likes.' };
  try {
    const { data, error } = await client.from(LIKES_TABLE).select('published_id');
    if (error) return { ok: false, error: communityError(error) };
    return { ok: true, liked: (Array.isArray(data) ? data : []).map((r) => r?.published_id).filter(Boolean) };
  } catch (err) {
    return { ok: false, error: communityError(err) };
  }
}

// Cloud quote save: exactness and revision are checked locally first,
// then enforced again by the database function. Attribution comes from
// the public row, never from caller input.
export async function saveCloudQuote(client, acc, row, text, openedRevision) {
  if (!acc?.userId) return { ok: false, error: 'Sign in to keep cloud quotes. Your on-device shelf still works.' };
  const check = validateRealQuote(text, row, openedRevision ?? row?.revision);
  if (check.error) return { ok: false, error: check.error, stale: check.stale };
  try {
    const { error } = await client.rpc(QUOTE_RPC, {
      p_published_id: row.id,
      p_revision: row.revision,
      p_text: String(text).replace(/^\s+|\s+$/g, ''),
    });
    if (error) {
      const stale = /revision|conflict|newer|stale/i.test(String(error?.message || ''));
      return { ok: false, stale, error: communityError(error, 'That phrase could not be kept.') };
    }
    return { ok: true, attribution: check.attribution };
  } catch (err) {
    return { ok: false, error: communityError(err, 'That phrase could not be kept.') };
  }
}

export async function loadMyQuotes(client, acc) {
  if (!acc?.userId) return { ok: false, error: 'Sign in to see your cloud quotes.' };
  try {
    const { data, error } = await client.from(QUOTES_TABLE).select('id,published_id,published_revision,author,source_title,text,created_at').order('created_at', { ascending: false });
    if (error) return { ok: false, error: communityError(error) };
    return { ok: true, quotes: Array.isArray(data) ? data : [] };
  } catch (err) {
    return { ok: false, error: communityError(err) };
  }
}

export async function loadProfile(client, acc) {
  if (!acc?.userId) return { ok: false, error: 'Sign in first.' };
  try {
    const { data, error } = await client.from(PROFILES_TABLE).select('display_name').eq('user_id', acc.userId).maybeSingle();
    if (error) return { ok: false, error: communityError(error) };
    return { ok: true, displayName: data?.display_name || '' };
  } catch (err) {
    return { ok: false, error: communityError(err) };
  }
}

export async function saveProfile(client, acc, displayName) {
  if (!acc?.userId) return { ok: false, error: 'Sign in first.' };
  const pen = clean(displayName);
  if (!pen) return { ok: false, error: 'Choose a pen name first.' };
  if (pen.length > MAX_PEN_NAME) return { ok: false, error: `Keep the pen name under ${MAX_PEN_NAME} characters.` };
  try {
    const { error } = await client.from(PROFILES_TABLE).upsert({ user_id: acc.userId, display_name: pen, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) return { ok: false, error: communityError(error, 'That pen name could not be kept.') };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: communityError(err, 'That pen name could not be kept.') };
  }
}

// Optional private cloud persistence for book drafts: text-only copies
// under owner RLS with explicit save/load, mirroring the story cloud
// flow. Local drafts always work without it.
export function bookPayload(book) {
  const clone = JSON.parse(JSON.stringify(book));
  delete clone.cloudRevision;
  delete clone.cloudOwnerId;
  return clone;
}

export function bookRevisionOf(book, userId) {
  if (userId && book?.cloudOwnerId && book.cloudOwnerId !== userId) return 0;
  const rev = Number(book?.cloudRevision);
  return Number.isInteger(rev) && rev >= 0 ? rev : 0;
}

export async function saveBookDraft(client, acc, book, expectedRevision) {
  if (!acc?.userId) return { ok: false, error: 'Sign in to save a cloud copy of your book.' };
  if (!book || typeof book.id !== 'string') return { ok: false, error: 'Open your book first. Nothing was sent.' };
  try {
    const { data, error } = await client.rpc(BOOK_RPC, {
      p_id: book.id,
      p_payload: bookPayload(book),
      p_expected_revision: expectedRevision ?? bookRevisionOf(book, acc.userId),
    });
    if (error) {
      const conflict = /revision|conflict|newer|stale/i.test(String(error?.message || ''));
      return { ok: false, conflict, error: communityError(error, 'The book copy could not be saved. Your draft on this device is unchanged.') };
    }
    const revision = Number(data?.revision);
    if (!Number.isInteger(revision) || revision < 1)
      return { ok: false, error: 'The book copy could not be confirmed. Nothing was changed on this device.' };
    return { ok: true, revision };
  } catch (err) {
    return { ok: false, error: communityError(err, 'The book copy could not be saved. Your draft on this device is unchanged.') };
  }
}

export async function loadBookDrafts(client, acc) {
  if (!acc?.userId) return { ok: false, error: 'Sign in to open your cloud book copies.' };
  try {
    const { data, error } = await client.from(BOOKS_TABLE).select('id,owner_id,revision,updated_at,payload').order('updated_at', { ascending: false });
    if (error) return { ok: false, error: communityError(error) };
    return { ok: true, rows: (Array.isArray(data) ? data : []).filter((r) => r && r.owner_id === acc.userId) };
  } catch (err) {
    return { ok: false, error: communityError(err) };
  }
}
