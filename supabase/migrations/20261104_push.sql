-- Witness optional Web Push: owner-only preferences, device
-- subscriptions, explicitly synced quote snapshots, and send claims.
--
-- SETUP GATE (honest status): this migration has NOT been applied. The app
-- treats a missing table/RPC as "push is not set up yet" and keeps every
-- local story intact; the Notifications section reports "unconfigured" and
-- nothing subscribes. To enable, the owner applies this file once in the
-- Supabase SQL editor (or `supabase db push`); nothing in the app applies
-- SQL remotely.
--
-- FIRST-INSTALL SCRIPT, not idempotent: `CREATE TABLE IF NOT EXISTS` and
-- `CREATE OR REPLACE FUNCTION` are safe to re-run, but plain
-- `CREATE POLICY` statements below raise "already exists" when applied
-- twice. Apply once per project; a repeat run failing on "already exists"
-- means the objects are already there, not that data was lost.
--
-- PRIVACY SHAPE
-- - Preferences default to everything OFF. Quiet hours, cadence, and the
--   lock-screen preview flag are per-owner rows; no email or personal data.
-- - Subscriptions store only the push endpoint and its encryption keys.
--   Endpoints are never readable by other users and never logged.
-- - Quote snapshots are copied ONLY for phrases the owner explicitly
--   switches on ("Remind me"). No auto-sync of saved text ever happens.
-- - There are NO direct table grants for any user role (see grants below):
--   the browser reaches these rows only through the owner-scoped RPCs, and
--   the scheduled sender uses the service role internally. Row-level
--   policies below keep the tables owner-scoped as defence in depth.
-- - No SECURITY DEFINER object is callable by anonymous users. Every RPC
--   is granted to authenticated users only, scopes its work to auth.uid(),
--   and refuses a null caller.
--
-- WITHDRAWAL
-- - Removing a device subscription deletes its row; revoking a phrase marks
--   its snapshot revoked so the sender skips it.
-- - Shared-story snapshots cite the published copy id AND revision. The
--   scheduled sender re-checks the published row and revokes snapshots
--   whose copy is gone or revised, so old/unpublished quotes are excluded.
-- - Kind 'published' snapshots are owner-verified at sync time against the
--   caller's own witness_quotes row (id, published id, revision, and exact
--   text must all match; author/title come from that row, never the caller)
--   and the published copy must still sit at the cited revision.
-- - Send claims are one row per (owner, local day, kind): a retried run
--   cannot double-send.

-- ------------------------------------------------------------ preferences
create table if not exists public.witness_push_prefs (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  phrase_enabled boolean not null default false,
  question_enabled boolean not null default false,
  cadence text not null default 'daily' check (cadence in ('daily', 'weekly')),
  local_time text not null default '09:00' check (local_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  time_zone text not null default 'UTC' check (char_length(time_zone) between 1 and 100),
  quiet_start text not null default '22:00' check (quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_end text not null default '07:00' check (quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  preview_text boolean not null default false,
  last_sent_phrase date,
  last_sent_question date,
  updated_at timestamptz not null default now()
);

alter table public.witness_push_prefs enable row level security;

drop policy if exists witness_push_prefs_owner on public.witness_push_prefs;
create policy witness_push_prefs_owner
  on public.witness_push_prefs
  for all
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- ---------------------------------------------------------- subscriptions
create table if not exists public.witness_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 9 and 2000 and endpoint like 'https://%'),
  p256dh text not null check (char_length(p256dh) between 1 and 512),
  auth text not null check (char_length(auth) between 1 and 512),
  created_at timestamptz not null default now()
);

alter table public.witness_push_subscriptions enable row level security;

drop policy if exists witness_push_subscriptions_owner on public.witness_push_subscriptions;
create policy witness_push_subscriptions_owner
  on public.witness_push_subscriptions
  for all
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- ----------------------------------------------------- quote snapshots
-- Explicit per-phrase copies. quote_key is the browser's local quote id,
-- except for kind 'published', where it is exactly the witness_quotes.id
-- (UUID) of an owned saved phrase; local shared-fictional demo snapshots
-- stay a local-example class and never trigger public UUID lookups.
create table if not exists public.witness_push_quotes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  quote_key text not null check (char_length(quote_key) between 1 and 200),
  text text not null check (char_length(text) between 1 and 2000),
  author text not null default '' check (char_length(author) <= 200),
  source_title text not null default '' check (char_length(source_title) <= 200),
  source_kind text not null check (source_kind in ('own', 'shared-fictional', 'published')),
  source_id text not null check (char_length(source_id) between 1 and 200),
  source_revision integer check (source_revision is null or source_revision >= 1),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, quote_key)
);

alter table public.witness_push_quotes enable row level security;

drop policy if exists witness_push_quotes_owner on public.witness_push_quotes;
create policy witness_push_quotes_owner
  on public.witness_push_quotes
  for all
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- ------------------------------------------------------------ send claims
-- One row per (owner, local day, kind). Claimed before sending so a
-- retried scheduler run cannot double-send.
create table if not exists public.witness_push_sends (
  message_key text primary key check (char_length(message_key) between 1 and 300),
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('phrase', 'question')),
  status text not null default 'sending' check (status in ('sending', 'sent')),
  created_at timestamptz not null default now()
);

alter table public.witness_push_sends enable row level security;

drop policy if exists witness_push_sends_owner on public.witness_push_sends;
create policy witness_push_sends_owner
  on public.witness_push_sends
  for all
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- ------------------------------------------------------------------ RPCs
-- Owner-scoped helpers. SECURITY DEFINER, granted to authenticated users
-- only; every one refuses a null caller and touches solely auth.uid() rows.

create or replace function public.witness_push_get_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_prefs jsonb;
  v_subs integer;
  v_keys jsonb;
begin
  if v_owner is null then
    raise exception 'witness_push_get_state: sign-in required';
  end if;
  select to_jsonb(p) into v_prefs from public.witness_push_prefs p where p.owner_id = v_owner;
  select count(*)::integer into v_subs from public.witness_push_subscriptions s where s.owner_id = v_owner;
  select coalesce(jsonb_agg(q.quote_key), '[]'::jsonb) into v_keys
    from public.witness_push_quotes q where q.owner_id = v_owner and q.revoked_at is null;
  return jsonb_build_object('prefs', v_prefs, 'subscriptions', v_subs, 'syncedKeys', v_keys);
end;
$$;

create or replace function public.witness_push_save_prefs(p_prefs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_row public.witness_push_prefs%rowtype;
begin
  if v_owner is null then
    raise exception 'witness_push_save_prefs: sign-in required';
  end if;
  if p_prefs is null
    or not (p_prefs ? 'phraseEnabled' and p_prefs ? 'questionEnabled' and p_prefs ? 'cadence'
      and p_prefs ? 'localTime' and p_prefs ? 'timeZone'
      and p_prefs ? 'quietStart' and p_prefs ? 'quietEnd' and p_prefs ? 'previewText') then
    raise exception 'witness_push_save_prefs: complete preferences are required';
  end if;
  insert into public.witness_push_prefs as p (
    owner_id, phrase_enabled, question_enabled, cadence,
    local_time, time_zone, quiet_start, quiet_end, preview_text, updated_at
  ) values (
    v_owner,
    (p_prefs->>'phraseEnabled')::boolean,
    (p_prefs->>'questionEnabled')::boolean,
    p_prefs->>'cadence',
    p_prefs->>'localTime',
    p_prefs->>'timeZone',
    p_prefs->>'quietStart',
    p_prefs->>'quietEnd',
    (p_prefs->>'previewText')::boolean,
    now()
  )
  on conflict (owner_id) do update set
    phrase_enabled = excluded.phrase_enabled,
    question_enabled = excluded.question_enabled,
    cadence = excluded.cadence,
    local_time = excluded.local_time,
    time_zone = excluded.time_zone,
    quiet_start = excluded.quiet_start,
    quiet_end = excluded.quiet_end,
    preview_text = excluded.preview_text,
    updated_at = now()
  returning * into v_row;
  return to_jsonb(v_row);
exception
  when check_violation then
    raise exception 'witness_push_save_prefs: preferences out of range';
  when invalid_text_representation then
    raise exception 'witness_push_save_prefs: preferences out of range';
end;
$$;

create or replace function public.witness_push_add_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_id uuid;
begin
  if v_owner is null then
    raise exception 'witness_push_add_subscription: sign-in required';
  end if;
  if p_endpoint is null or p_p256dh is null or p_auth is null then
    raise exception 'witness_push_add_subscription: endpoint and keys are required';
  end if;
  -- An endpoint belongs to exactly one owner: re-registering your own
  -- device refreshes its keys, but another owner's endpoint is never
  -- adopted — the insert below then conflicts and is refused.
  update public.witness_push_subscriptions s
    set p256dh = p_p256dh, auth = p_auth
    where s.owner_id = v_owner and s.endpoint = p_endpoint
  returning s.id into v_id;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.witness_push_subscriptions (owner_id, endpoint, p256dh, auth)
  values (v_owner, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'witness_push_add_subscription: endpoint unavailable';
  end if;
  return v_id;
exception
  when check_violation then
    raise exception 'witness_push_add_subscription: subscription out of range';
end;
$$;

create or replace function public.witness_push_remove_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then
    raise exception 'witness_push_remove_subscription: sign-in required';
  end if;
  if p_endpoint is null then
    raise exception 'witness_push_remove_subscription: endpoint is required';
  end if;
  delete from public.witness_push_subscriptions s where s.owner_id = v_owner and s.endpoint = p_endpoint;
  return true;
end;
$$;

create or replace function public.witness_push_own_subscription(p_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_row jsonb;
begin
  if v_owner is null then
    raise exception 'witness_push_own_subscription: sign-in required';
  end if;
  if p_endpoint is null then
    raise exception 'witness_push_own_subscription: endpoint is required';
  end if;
  select jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth) into v_row
    from public.witness_push_subscriptions s where s.owner_id = v_owner and s.endpoint = p_endpoint;
  if v_row is null then
    raise exception 'witness_push_own_subscription: unknown device';
  end if;
  return v_row;
end;
$$;

create or replace function public.witness_push_sync_quote(p_snapshot jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_id uuid;
  v_kind text;
  v_quote_id uuid;
  v_pub_id uuid;
  v_rev integer;
  v_text text;
  v_author text;
  v_title text;
  v_current_rev integer;
begin
  if v_owner is null then
    raise exception 'witness_push_sync_quote: sign-in required';
  end if;
  if p_snapshot is null
    or not (p_snapshot ? 'quoteKey' and p_snapshot ? 'text' and p_snapshot ? 'sourceKind'
      and p_snapshot ? 'sourceId') then
    raise exception 'witness_push_sync_quote: complete snapshot is required';
  end if;
  v_kind := p_snapshot->>'sourceKind';
  if not (v_kind in ('own', 'shared-fictional', 'published')) then
    raise exception 'witness_push_sync_quote: snapshot out of range';
  end if;
  if v_kind in ('shared-fictional', 'published')
    and (p_snapshot->>'sourceRevision') is null then
    raise exception 'witness_push_sync_quote: shared quotes cite their revision';
  end if;
  if v_kind = 'published' then
    -- Owner verification: quoteKey must be exactly the witness_quotes.id of
    -- a row the caller owns, and sourceId/sourceRevision/text must match
    -- that owned row. Author and title come from the owned row, never from
    -- caller input. A second lookup confirms the published copy still sits
    -- at the cited revision. Malformed UUIDs and unknown rows fail safe
    -- with the generic out-of-range error below.
    begin
      v_quote_id := (p_snapshot->>'quoteKey')::uuid;
      v_pub_id := (p_snapshot->>'sourceId')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'witness_push_sync_quote: snapshot out of range';
    end;
    v_rev := nullif(p_snapshot->>'sourceRevision', '')::integer;
    select q.text, q.author, q.source_title
      into v_text, v_author, v_title
      from public.witness_quotes q
      where q.id = v_quote_id
        and q.owner_id = v_owner
        and q.published_id = v_pub_id
        and q.published_revision = v_rev
        and q.text = (p_snapshot->>'text');
    if not found then
      raise exception 'witness_push_sync_quote: snapshot out of range';
    end if;
    select p.revision into v_current_rev
      from public.published_stories p where p.id = v_pub_id;
    if not found or v_current_rev is distinct from v_rev then
      raise exception 'witness_push_sync_quote: snapshot out of range';
    end if;
    insert into public.witness_push_quotes as q (
      owner_id, quote_key, text, author, source_title,
      source_kind, source_id, source_revision, revoked_at
    ) values (
      v_owner,
      p_snapshot->>'quoteKey',
      v_text,
      v_author,
      v_title,
      'published',
      v_pub_id::text,
      v_rev,
      null
    )
    on conflict (owner_id, quote_key) do update set
      text = excluded.text,
      author = excluded.author,
      source_title = excluded.source_title,
      source_kind = excluded.source_kind,
      source_id = excluded.source_id,
      source_revision = excluded.source_revision,
      revoked_at = null
    returning id into v_id;
    return v_id;
  end if;
  insert into public.witness_push_quotes as q (
    owner_id, quote_key, text, author, source_title,
    source_kind, source_id, source_revision, revoked_at
  ) values (
    v_owner,
    p_snapshot->>'quoteKey',
    p_snapshot->>'text',
    coalesce(p_snapshot->>'author', ''),
    coalesce(p_snapshot->>'sourceTitle', ''),
    p_snapshot->>'sourceKind',
    p_snapshot->>'sourceId',
    nullif(p_snapshot->>'sourceRevision', '')::integer,
    null
  )
  on conflict (owner_id, quote_key) do update set
    text = excluded.text,
    author = excluded.author,
    source_title = excluded.source_title,
    source_kind = excluded.source_kind,
    source_id = excluded.source_id,
    source_revision = excluded.source_revision,
    revoked_at = null
  returning id into v_id;
  return v_id;
exception
  when check_violation then
    raise exception 'witness_push_sync_quote: snapshot out of range';
  when invalid_text_representation then
    raise exception 'witness_push_sync_quote: snapshot out of range';
end;
$$;

create or replace function public.witness_push_revoke_quote(p_quote_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then
    raise exception 'witness_push_revoke_quote: sign-in required';
  end if;
  if p_quote_key is null then
    raise exception 'witness_push_revoke_quote: quote key is required';
  end if;
  update public.witness_push_quotes q
    set revoked_at = now()
    where q.owner_id = v_owner and q.quote_key = p_quote_key and q.revoked_at is null;
  return true;
end;
$$;

-- ---------------------------------------------------------------- grants
-- Supabase default privileges would expose new tables directly, so every
-- revoke below names public, anon AND authenticated first. Push tables get
-- NO direct grants: the browser uses the RPCs above and the scheduled
-- sender uses the service role. Policies above stay as defence in depth.
revoke all on table public.witness_push_prefs from public, anon, authenticated;
revoke all on table public.witness_push_subscriptions from public, anon, authenticated;
revoke all on table public.witness_push_quotes from public, anon, authenticated;
revoke all on table public.witness_push_sends from public, anon, authenticated;

revoke all on function public.witness_push_get_state() from public, anon, authenticated;
grant execute on function public.witness_push_get_state() to authenticated;

revoke all on function public.witness_push_save_prefs(jsonb) from public, anon, authenticated;
grant execute on function public.witness_push_save_prefs(jsonb) to authenticated;

revoke all on function public.witness_push_add_subscription(text, text, text) from public, anon, authenticated;
grant execute on function public.witness_push_add_subscription(text, text, text) to authenticated;

revoke all on function public.witness_push_remove_subscription(text) from public, anon, authenticated;
grant execute on function public.witness_push_remove_subscription(text) to authenticated;

revoke all on function public.witness_push_own_subscription(text) from public, anon, authenticated;
grant execute on function public.witness_push_own_subscription(text) to authenticated;

revoke all on function public.witness_push_sync_quote(jsonb) from public, anon, authenticated;
grant execute on function public.witness_push_sync_quote(jsonb) to authenticated;

revoke all on function public.witness_push_revoke_quote(text) from public, anon, authenticated;
grant execute on function public.witness_push_revoke_quote(text) to authenticated;
