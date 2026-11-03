-- Witness discovery increment: optional event-date metadata on public copies.
--
-- SETUP GATE (honest status): this migration has NOT been applied. The app
-- treats a missing v2 RPC as "the sharing setup on the server is older than
-- this app" and refuses to publish rather than storing a copy without the
-- narrator's date wording (publishCopyV2 fails closed with setupPending).
-- To enable, the owner applies this file once in the Supabase SQL editor
-- (or `supabase db push`); nothing in the app applies SQL remotely.
--
-- ADDITIVE ONLY: three nullable columns on the already-applied
-- public.published_stories, column-only public SELECT grants for exactly
-- those three columns (owner/private columns are NOT widened), and a new
-- owner-auth-only compare-and-swap witness_publish_story_v2. The legacy
-- witness_publish_story (v1) is untouched so old clients keep working.
-- No DROP, DELETE, TRUNCATE, or rewrite of earlier migrations.
--
-- PRIVACY SHAPE
-- - The three new columns carry only what the narrator explicitly chose:
--   the confirmed event's date wording verbatim (e.g. 'around 2019'), an
--   optional explicit year, and an approximate flag. Unknown stays null.
-- - Public readers gain ONLY these three columns. owner_id, story_id, and
--   every other private column stay out of every public grant, as before.
-- - No SECURITY DEFINER object is callable by anonymous users. The v2 RPC
--   is granted to authenticated users only, scopes every write to
--   auth.uid(), and refuses a null caller.
-- - There are NO direct INSERT or UPDATE grants on published_stories for
--   any user role, before or after this file. Publication and revision
--   updates go only through the owner-scoped publish RPCs.

-- Three optional date columns. Nullable: copies published before this
-- migration, and narrators who leave the date unknown, read as unknown
-- (null), never as a guessed date. Bounds mirror web/community.js
-- (MAX_EVENT_DATE_TEXT 120, years 1800-2100).
alter table public.published_stories
  add column if not exists event_date_text text
    check (event_date_text is null or char_length(event_date_text) <= 120);

alter table public.published_stories
  add column if not exists event_year integer
    check (event_year is null or (event_year >= 1800 and event_year <= 2100));

alter table public.published_stories
  add column if not exists date_approx boolean not null default false;

-- Public readers see exactly these three new columns alongside the
-- already-granted allowlist. Owner UUIDs, private story ids, and every
-- other private column are deliberately absent: this GRANT adds no other
-- column for any role.
grant select (event_date_text, event_year, date_approx)
  on public.published_stories to anon, authenticated;

-- Publish with event-date metadata: every v1 argument in the same order,
-- plus the three date parameters grouped after the event city. The body
-- validates the caller and the date bounds FIRST, then runs the existing
-- v1 function and sets the metadata on the resulting row inside the same
-- transaction — one function call is one transaction, so invalid metadata
-- raises before anything is written and any failure rolls everything
-- back atomically. Owner-scoped compare-and-swap semantics (including
-- revision conflicts) are inherited from v1 unchanged.
create or replace function public.witness_publish_story_v2(
  p_id uuid,
  p_story_id uuid,
  p_pen_name text,
  p_title text,
  p_passages jsonb,
  p_event_title text,
  p_event_summary text,
  p_event_city text,
  p_event_date_text text,
  p_event_year integer,
  p_date_approx boolean,
  p_city text,
  p_lon double precision,
  p_lat double precision,
  p_topics text[],
  p_occasion_id text,
  p_expected_revision integer
)
returns public.published_stories
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.published_stories%rowtype;
  v_date text := nullif(btrim(coalesce(p_event_date_text, '')), '');
begin
  if auth.uid() is null then
    raise exception 'sign-in is required';
  end if;
  if v_date is not null and char_length(v_date) > 120 then
    raise exception 'the event date wording is too long';
  end if;
  if p_event_year is not null and (p_event_year < 1800 or p_event_year > 2100) then
    raise exception 'the event year is out of range';
  end if;
  v_row := public.witness_publish_story(
    p_id, p_story_id, p_pen_name, p_title, p_passages,
    p_event_title, p_event_summary, p_event_city,
    p_city, p_lon, p_lat, p_topics,
    p_occasion_id, p_expected_revision
  );
  update public.published_stories
  set event_date_text = v_date,
      event_year = p_event_year,
      date_approx = coalesce(p_date_approx, false)
  where id = v_row.id
    and owner_id = auth.uid()
  returning * into v_row;
  if not found then
    raise exception 'that shared copy changed since it was opened'
      using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;

-- v2 is owner-auth-only: callable by signed-in users, by nobody else.
revoke all on function public.witness_publish_story_v2(uuid, uuid, text, text, jsonb, text, text, text, text, integer, boolean, text, double precision, double precision, text[], text, integer) from public, anon, authenticated;
grant execute on function public.witness_publish_story_v2(uuid, uuid, text, text, jsonb, text, text, text, text, integer, boolean, text, double precision, double precision, text[], text, integer) to authenticated;
