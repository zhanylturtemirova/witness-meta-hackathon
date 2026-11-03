-- Witness community increment: private book drafts, pen-name profiles,
-- opt-in published STORY COPIES, per-user likes, and exact saved quotes.
--
-- SETUP GATE (honest status): this migration has NOT been applied. The app
-- treats missing tables/RPCs as "community sharing is not set up yet" and
-- keeps every local story intact. To enable, the owner applies this file
-- once in the Supabase SQL editor (or `supabase db push`); nothing in the
-- app applies SQL remotely.
--
-- FIRST-INSTALL SCRIPT, not idempotent: this file contains no DROP, DELETE,
-- TRUNCATE, or other destructive statements. `CREATE TABLE IF NOT EXISTS`,
-- `CREATE OR REPLACE FUNCTION`, and `ALTER TABLE ... ENABLE ROW LEVEL
-- SECURITY` are safe to re-run on their own, but plain `CREATE POLICY`,
-- `CREATE TRIGGER`, and `GRANT` statements below raise "already exists" (or
-- duplicate-grant no-ops) when applied twice. Apply once per project; the
-- Supabase migration tracker (`supabase db push`) records that for CLI
-- users. SQL-editor users who need to re-apply should use a fresh project
-- or remove the objects by hand first. A repeat run failing on
-- "already exists" means the objects are already there, not that data was
-- lost. String-only inspection of this file does not prove RLS on its own:
-- the owner re-checks table privileges and policies after applying.
--
-- PRIVACY SHAPE
-- - Published rows are COPIES with their own id and revision, never a flag
--   on the private diary. Private interview answers/history, auth
--   email/UID, raw audio/images, and whole project JSON are never columns
--   here and never pass through the publish function.
-- - Public readers see the chosen pen name, never a personal email.
--   Owner UUIDs and private story IDs stay out of public reads: anonymous
--   and signed-in readers are granted ONLY the allowlisted columns, and
--   owners read their full rows through the owner-scoped RPC below.
-- - No SECURITY DEFINER object is callable by anonymous users. The four
--   RPCs below run as the database owner but are granted to authenticated
--   users only, and every one of them scopes its work to auth.uid() and
--   refuses a null caller — they can only ever touch the caller's own rows.
-- - There are NO direct INSERT or UPDATE grants on published_stories for
--   any user role. Publication (insert) and revision updates go only
--   through the hardened owner-scoped publish RPC with compare-and-swap.
--   Owners keep direct DELETE for unpublishing; the like-count column is
--   maintained solely by the locked-down trigger below, never by callers.
--
-- CASCADE / WITHDRAWAL
-- - Unpublishing (owner deletes their published row) cascade-deletes its
--   likes and saved quotes: withdrawal removes community state.
-- - Updating a published copy bumps its revision and keeps like_count;
--   quotes already saved keep citing the earlier revision they came from.
-- - Deleting a private story does NOT touch its public copy: the owner
--   must unpublish explicitly. Likes shown are real rows, never invented.
--
-- Validation lives in SQL (passage allowlist, topic allowlist without
-- duplicates, city/coordinate pairs, finite numbers, revision conflicts)
-- so no write path can bypass it; the app validates the same rules before
-- sending.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- books
-- Optional private cloud copies of local book drafts (text only).
create table if not exists public.witness_books (
  id uuid not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  payload jsonb not null,
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

alter table public.witness_books enable row level security;

create policy witness_books_select_owner
  on public.witness_books for select to authenticated
  using (auth.uid() = owner_id);

create policy witness_books_insert_owner
  on public.witness_books for insert to authenticated
  with check (auth.uid() = owner_id);

create policy witness_books_update_owner
  on public.witness_books for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy witness_books_delete_owner
  on public.witness_books for delete to authenticated
  using (auth.uid() = owner_id);

-- ------------------------------------------------------------- profiles
-- A remembered pen name per user. Owner-scoped only: public readers see
-- the pen name denormalised on each published copy, never this table.
create table if not exists public.witness_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  updated_at timestamptz not null default now()
);

alter table public.witness_profiles enable row level security;

create policy witness_profiles_owner_all
  on public.witness_profiles for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ------------------------------------------------------ validation fns
-- Immutable so CHECK constraints can use them on every write path.
-- Topics must be 1-5 entries from the fixed community list, with no
-- blanks and no duplicates. The list mirrors COMMUNITY_TOPICS in
-- web/community.js; adding a topic means updating both places.
create or replace function public.witness_valid_topics(topics text[])
returns boolean
language sql immutable
as $$
  select coalesce(array_length(topics, 1), 0) between 1 and 5
    and not exists (
      select 1 from unnest(topics) t
      where t is null
        or t not in (
          'moving-abroad', 'first-concert', 'first-project',
          'turning-point', 'family', 'everyday', 'work', 'celebration'
        )
    )
    and (select count(*) from unnest(topics) t)
      = (select count(distinct t) from unnest(topics) t);
$$;

-- Each passage must be EXACTLY {text}: one key, no metadata, no private
-- answer ids. The text must be a real JSON string (JSON null and
-- non-strings are rejected, since `->>` yields SQL null for those and
-- would otherwise slip past length checks), 1-5000 characters with
-- non-blank content. Anything else is rejected, never stored.
create or replace function public.witness_valid_passages(passages jsonb)
returns boolean
language plpgsql immutable
as $$
declare
  item jsonb;
  v_text text;
begin
  if passages is null or jsonb_typeof(passages) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(passages) < 1 or jsonb_array_length(passages) > 20 then
    return false;
  end if;
  for item in select * from jsonb_array_elements(passages) loop
    if jsonb_typeof(item) <> 'object' then
      return false;
    end if;
    if not (item ? 'text') then
      return false;
    end if;
    if (select count(*) from jsonb_object_keys(item)) <> 1 then
      return false;
    end if;
    if jsonb_typeof(item -> 'text') <> 'string' then
      return false;
    end if;
    v_text := item ->> 'text';
    if v_text is null or char_length(v_text) < 1 or char_length(v_text) > 5000 then
      return false;
    end if;
    if char_length(btrim(v_text)) < 1 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- ---------------------------------------------------- published copies
create table if not exists public.published_stories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  story_id uuid not null,
  pen_name text not null check (char_length(pen_name) between 1 and 40),
  title text not null check (char_length(title) between 1 and 120),
  passages jsonb not null check (public.witness_valid_passages(passages)),
  event_title text not null check (char_length(event_title) between 1 and 120),
  event_summary text not null default '' check (char_length(event_summary) <= 500),
  event_city text not null check (char_length(event_city) between 1 and 80),
  city text not null check (char_length(city) between 1 and 80),
  lon double precision check (lon is null or (lon >= -180 and lon <= 180)),
  lat double precision check (lat is null or (lat >= -90 and lat <= 90)),
  topics text[] not null default '{}' check (public.witness_valid_topics(topics)),
  occasion_id text check (occasion_id is null or (char_length(occasion_id) between 1 and 80)),
  revision integer not null default 1 check (revision >= 1),
  like_count integer not null default 0 check (like_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lon is null and lat is null) or (lon is not null and lat is not null))
);

alter table public.published_stories enable row level security;

-- Owner reads of their own rows. There is deliberately NO owner INSERT or
-- UPDATE policy: direct inserts/updates are blocked at the grant layer
-- and publication goes only through the RPC below.
create policy published_stories_owner_select
  on public.published_stories for select to authenticated
  using (auth.uid() = owner_id);

-- Owner-only delete preserves unpublishing. Likes and quotes on the copy
-- are withdrawn by cascade.
create policy published_stories_owner_delete
  on public.published_stories for delete to authenticated
  using (auth.uid() = owner_id);

-- Public reads use the allowlisted column grants below; owner_id and
-- story_id never pass through any grant or public RPC.
create policy published_stories_public_read
  on public.published_stories for select to anon, authenticated
  using (true);

-- ---------------------------------------------------------------- likes
-- One row per (user, story). Counts shown in the app come from the
-- trigger-maintained like_count column, never invented.
create table if not exists public.story_likes (
  published_id uuid not null references public.published_stories (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (published_id, user_id)
);

alter table public.story_likes enable row level security;

create policy story_likes_owner_all
  on public.story_likes for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Derived count, recomputed from the real like rows on every change so
-- concurrent likes and unlikes converge instead of drifting. SECURITY
-- DEFINER with a fixed search_path: a reader liking ANOTHER author's row
-- cannot update that row under owner RLS, so the trigger runs as the
-- database owner to maintain the derived count. Not callable directly:
-- execute is revoked from every user role below.
create or replace function public.witness_refresh_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if TG_OP = 'INSERT' then
    v_id := NEW.published_id;
  elsif TG_OP = 'DELETE' then
    v_id := OLD.published_id;
  else
    return null;
  end if;
  update public.published_stories
  set like_count = (
    select count(*) from public.story_likes where published_id = v_id
  )
  where id = v_id;
  if TG_OP = 'INSERT' then
    return NEW;
  end if;
  return OLD;
end;
$$;

create trigger story_likes_count
  after insert or delete on public.story_likes
  for each row execute function public.witness_refresh_like_count();

-- ---------------------------------------------------------------- quotes
-- Owner-scoped exact quotes with attribution and story revision. The
-- trigger derives author/source_title from the published row itself and
-- refuses fabricated text (it must appear verbatim in one published
-- passage) and stale revisions.
create table if not exists public.witness_quotes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  published_id uuid not null references public.published_stories (id) on delete cascade,
  published_revision integer not null check (published_revision >= 1),
  author text not null check (char_length(author) between 1 and 40),
  source_title text not null check (char_length(source_title) between 1 and 120),
  text text not null check (char_length(text) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.witness_quotes enable row level security;

create policy witness_quotes_owner_all
  on public.witness_quotes for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create or replace function public.witness_check_quote()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_revision integer;
  v_pen_name text;
  v_title text;
  v_found boolean;
  v_text text;
begin
  if auth.uid() is null then
    raise exception 'sign-in is required'
      using errcode = 'P0001';
  end if;
  if TG_OP = 'UPDATE' then
    if OLD.owner_id is distinct from auth.uid() then
      raise exception 'that saved phrase belongs to someone else'
        using errcode = 'P0001';
    end if;
  end if;
  select revision, pen_name, title
    into v_revision, v_pen_name, v_title
  from public.published_stories
  where id = NEW.published_id;
  if not found then
    raise exception 'that story is no longer shared'
      using errcode = 'P0001';
  end if;
  if v_revision <> NEW.published_revision then
    raise exception 'that story changed since it was opened'
      using errcode = 'P0001';
  end if;
  v_text := btrim(coalesce(NEW.text, ''));
  if char_length(v_text) < 1 or char_length(v_text) > 2000 then
    raise exception 'saved words of 1-2000 characters are required'
      using errcode = 'P0001';
  end if;
  select exists (
    select 1
    from jsonb_array_elements(
      (select passages from public.published_stories where id = NEW.published_id)
    ) p
    where p ? 'text'
      and jsonb_typeof(p -> 'text') = 'string'
      and position(v_text in (p ->> 'text')) > 0
  ) into v_found;
  if not coalesce(v_found, false) then
    raise exception 'saved words must match the shared story exactly'
      using errcode = 'P0001';
  end if;
  -- Attribution always comes from the published row, never from caller
  -- input: even a direct table write cannot fabricate author, title, or
  -- quote text. The revision stays the caller's (already verified above)
  -- so a quote saved from an older version keeps citing that version.
  NEW.owner_id := auth.uid();
  NEW.author := v_pen_name;
  NEW.source_title := v_title;
  NEW.text := v_text;
  return NEW;
end;
$$;

create trigger witness_quotes_check
  before insert or update on public.witness_quotes
  for each row execute function public.witness_check_quote();

-- ------------------------------------------------------------------ RPCs
-- Owner-scoped helpers. SECURITY DEFINER (the public column grants
-- below would otherwise block the owner columns these functions need),
-- granted to authenticated users only, and each one touches solely the
-- caller's own rows via auth.uid(), refusing a null caller. The fixed
-- search_path pins names.

-- The caller's own published rows, full fields, newest first.
create or replace function public.witness_my_publications()
returns setof public.published_stories
language sql
security definer
set search_path = public
as $$
  select *
  from public.published_stories
  where owner_id = auth.uid()
  order by updated_at desc;
$$;

-- Publish a new copy (expected revision 0) or update the caller's copy
-- with a compare-and-swap on revision. A moved revision raises a
-- conflict instead of silently overwriting. Coordinates must arrive as a
-- pair (lon AND lat, or neither) with finite in-range numbers; the table
-- CHECKs re-enforce the pair and the ranges on every write path.
create or replace function public.witness_publish_story(
  p_id uuid,
  p_story_id uuid,
  p_pen_name text,
  p_title text,
  p_passages jsonb,
  p_event_title text,
  p_event_summary text,
  p_event_city text,
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
  v_expected integer := coalesce(p_expected_revision, 0);
  v_row public.published_stories%rowtype;
begin
  if auth.uid() is null then
    raise exception 'sign-in is required';
  end if;
  if p_story_id is null then
    raise exception 'a story reference is required';
  end if;
  if p_pen_name is null or char_length(btrim(p_pen_name)) < 1 or char_length(p_pen_name) > 40 then
    raise exception 'a pen name of 1-40 characters is required';
  end if;
  if p_title is null or char_length(btrim(p_title)) < 1 or char_length(p_title) > 120 then
    raise exception 'a title of 1-120 characters is required';
  end if;
  if not public.witness_valid_passages(p_passages) then
    raise exception 'at least one passage of 1-5000 characters is required';
  end if;
  if p_event_title is null or char_length(btrim(p_event_title)) < 1 or char_length(p_event_title) > 120 then
    raise exception 'a shared event title is required';
  end if;
  if p_event_summary is not null and char_length(p_event_summary) > 500 then
    raise exception 'the shared event summary is too long';
  end if;
  if p_event_city is null or char_length(btrim(p_event_city)) < 1 or char_length(p_event_city) > 80 then
    raise exception 'an explicitly chosen city is required';
  end if;
  if p_city is null or char_length(btrim(p_city)) < 1 or char_length(p_city) > 80 then
    raise exception 'an explicitly chosen city is required';
  end if;
  if (p_lon is null) <> (p_lat is null) then
    raise exception 'the city coordinates must be set together';
  end if;
  if p_lon is not null and (p_lon::text in ('Infinity', '-Infinity', 'NaN') or p_lat::text in ('Infinity', '-Infinity', 'NaN')) then
    raise exception 'the city coordinates are not valid numbers';
  end if;
  if p_lon is not null and (p_lon < -180 or p_lon > 180) then
    raise exception 'the city longitude is out of range';
  end if;
  if p_lat is not null and (p_lat < -90 or p_lat > 90) then
    raise exception 'the city latitude is out of range';
  end if;
  if not public.witness_valid_topics(p_topics) then
    raise exception '1-5 listed topics without repeats are required';
  end if;
  if p_occasion_id is not null and (char_length(p_occasion_id) < 1 or char_length(p_occasion_id) > 80) then
    raise exception 'the occasion identifier is too long';
  end if;
  if v_expected = 0 then
    insert into public.published_stories
      (owner_id, story_id, pen_name, title, passages, event_title, event_summary,
       event_city, city, lon, lat, topics, occasion_id, revision, updated_at)
    values
      (auth.uid(), p_story_id, btrim(p_pen_name), btrim(p_title), p_passages,
       btrim(p_event_title), coalesce(p_event_summary, ''), btrim(p_event_city),
       btrim(p_city), p_lon, p_lat, p_topics,
       nullif(btrim(coalesce(p_occasion_id, '')), ''), 1, now())
    returning * into v_row;
    return v_row;
  end if;
  if p_id is null then
    raise exception 'the shared copy reference is missing';
  end if;
  update public.published_stories
  set pen_name = btrim(p_pen_name),
      title = btrim(p_title),
      passages = p_passages,
      event_title = btrim(p_event_title),
      event_summary = coalesce(p_event_summary, ''),
      event_city = btrim(p_event_city),
      city = btrim(p_city),
      lon = p_lon,
      lat = p_lat,
      topics = p_topics,
      occasion_id = nullif(btrim(coalesce(p_occasion_id, '')), ''),
      revision = revision + 1,
      updated_at = now()
  where id = p_id
    and owner_id = auth.uid()
    and revision = v_expected
  returning * into v_row;
  if not found then
    raise exception 'that shared copy changed since it was opened'
      using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;

-- Save an exact quote with attribution taken from the published row
-- itself, never from caller input. A caller-passed revision that no
-- longer matches is a conflict, not a silent re-attachment; the trigger
-- re-checks exactness and revision, so direct inserts are held to the
-- same rule.
create or replace function public.witness_save_quote(
  p_published_id uuid,
  p_revision integer,
  p_text text
)
returns public.witness_quotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.published_stories%rowtype;
  v_quote public.witness_quotes%rowtype;
  v_text text := btrim(coalesce(p_text, ''));
begin
  if auth.uid() is null then
    raise exception 'sign-in is required';
  end if;
  if p_published_id is null then
    raise exception 'a shared story reference is required';
  end if;
  if char_length(v_text) < 1 or char_length(v_text) > 2000 then
    raise exception 'saved words of 1-2000 characters are required';
  end if;
  select * into v_row
  from public.published_stories
  where id = p_published_id;
  if not found then
    raise exception 'that story is no longer shared'
      using errcode = 'P0001';
  end if;
  if p_revision is not null and p_revision <> v_row.revision then
    raise exception 'that story changed since it was opened'
      using errcode = 'P0001';
  end if;
  insert into public.witness_quotes
    (owner_id, published_id, published_revision, author, source_title, text)
  values
    (auth.uid(), p_published_id, v_row.revision, v_row.pen_name, v_row.title, v_text)
  returning * into v_quote;
  return v_quote;
end;
$$;

-- Atomic compare-and-swap save for private book drafts, mirroring the
-- project save: revision 1 on first save, then exactly-one-step
-- advances only while the stored revision still matches.
create or replace function public.witness_save_book(
  p_id uuid,
  p_payload jsonb,
  p_expected_revision integer
)
returns public.witness_books
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected integer := coalesce(p_expected_revision, 0);
  v_row public.witness_books%rowtype;
begin
  if p_id is null or p_payload is null then
    raise exception 'witness_save_book: id and payload are required';
  end if;
  if auth.uid() is null then
    raise exception 'sign-in is required';
  end if;
  if v_expected = 0 then
    insert into public.witness_books (id, owner_id, payload, revision, updated_at)
    values (p_id, auth.uid(), p_payload, 1, now())
    on conflict (owner_id, id) do nothing
    returning * into v_row;
    if not found then
      raise exception 'witness_save_book conflict: a copy already exists'
        using errcode = 'P0001';
    end if;
    return v_row;
  end if;
  update public.witness_books
  set payload = p_payload,
      revision = revision + 1,
      updated_at = now()
  where id = p_id
    and owner_id = auth.uid()
    and revision = v_expected
  returning * into v_row;
  if not found then
    raise exception 'witness_save_book conflict: a newer copy exists'
      using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------- grants
-- Supabase default privileges grant table access directly to the anon
-- and authenticated roles, so revoking from PUBLIC alone is not enough:
-- every revoke below names public, anon AND authenticated first, then
-- re-grants only what each table intends. Row-level policies (above)
-- keep the re-granted access owner-scoped.
-- Private tables: owner access only, nothing for anonymous callers.
revoke all on table public.witness_books from public, anon, authenticated;
grant select, insert, update, delete on table public.witness_books to authenticated;

revoke all on table public.witness_profiles from public, anon, authenticated;
grant select, insert, update, delete on table public.witness_profiles to authenticated;

-- Likes need no UPDATE: rows are inserted and deleted only; the count is
-- derived by the trigger.
revoke all on table public.story_likes from public, anon, authenticated;
grant select, insert, delete on table public.story_likes to authenticated;

revoke all on table public.witness_quotes from public, anon, authenticated;
grant select, insert, update, delete on table public.witness_quotes to authenticated;

-- Published copies: the public may read ONLY the allowlisted columns.
-- owner_id and story_id stay readable solely through the owner RPC.
-- There are deliberately NO insert or update grants here: publication
-- goes through the RPC, and like_count is trigger-maintained. Owners
-- keep DELETE so they can unpublish (withdraw) their own copies.
revoke all on table public.published_stories from public, anon, authenticated;
grant select (
  id, pen_name, title, passages,
  event_title, event_summary, event_city,
  city, lon, lat, topics, occasion_id,
  revision, like_count, updated_at
) on public.published_stories to anon, authenticated;
grant delete on table public.published_stories to authenticated;

-- RPCs: authenticated users only; each one is owner-scoped inside.
revoke all on function public.witness_my_publications() from public, anon, authenticated;
grant execute on function public.witness_my_publications() to authenticated;

revoke all on function public.witness_publish_story(uuid, uuid, text, text, jsonb, text, text, text, text, double precision, double precision, text[], text, integer) from public, anon, authenticated;
grant execute on function public.witness_publish_story(uuid, uuid, text, text, jsonb, text, text, text, text, double precision, double precision, text[], text, integer) to authenticated;

revoke all on function public.witness_save_quote(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.witness_save_quote(uuid, integer, text) to authenticated;

revoke all on function public.witness_save_book(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.witness_save_book(uuid, jsonb, integer) to authenticated;

-- Validators and the like-count trigger run inside constraints, triggers,
-- and RPCs. Nobody calls them directly.
revoke all on function public.witness_valid_topics(text[]) from public, anon, authenticated;
revoke all on function public.witness_valid_passages(jsonb) from public, anon, authenticated;
revoke all on function public.witness_refresh_like_count() from public, anon, authenticated;
