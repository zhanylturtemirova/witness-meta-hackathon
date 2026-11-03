-- Witness private project copies (text only; recordings/images stay on device).
--
-- SETUP GATE (honest status): this migration has been applied. The app
-- treats a missing table/RPC as "cloud saving is not set up yet" and
-- leaves local stories intact. Strict rollback-only DB RLS checks returned
-- PASS after applying. String-only inspection of this file does not prove
-- RLS on its own.
--
-- No anon (public) policies are created on private rows. No SECURITY
-- DEFINER bypass: the save function runs as the caller (security invoker)
-- so row-level security always applies. No destructive DROP statements.

-- One row per (owner, story): the same guest story id may be copied to
-- distinct accounts, and no user can block another by guessing its UUID.
create table if not exists public.witness_projects (
  id uuid not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  payload jsonb not null,
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

alter table public.witness_projects enable row level security;

-- Owner-only access. Every policy carries BOTH a USING and a WITH CHECK
-- clause where the statement writes rows, so no one can read or plant rows
-- that are not their own.
drop policy if exists witness_projects_select_owner on public.witness_projects;
create policy witness_projects_select_owner
  on public.witness_projects
  for select
  to authenticated
  using (auth.uid() = owner_id);

drop policy if exists witness_projects_insert_owner on public.witness_projects;
create policy witness_projects_insert_owner
  on public.witness_projects
  for insert
  to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists witness_projects_update_owner on public.witness_projects;
create policy witness_projects_update_owner
  on public.witness_projects
  for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists witness_projects_delete_owner on public.witness_projects;
create policy witness_projects_delete_owner
  on public.witness_projects
  for delete
  to authenticated
  using (auth.uid() = owner_id);

-- Atomic compare-and-swap save: creates the row at revision 1 when the
-- caller passes 0 (or null), otherwise advances revision by exactly one
-- only when the stored revision still equals the expected one. A moved
-- revision raises a conflict instead of silently last-write-winning.
-- Runs as the caller so RLS policies above always apply; the fixed
-- search_path keeps name resolution pinned to public.
create or replace function public.witness_save_project(
  p_id uuid,
  p_payload jsonb,
  p_expected_revision integer
)
returns public.witness_projects
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_expected integer := coalesce(p_expected_revision, 0);
  v_row public.witness_projects%rowtype;
begin
  if p_id is null or p_payload is null then
    raise exception 'witness_save_project: id and payload are required';
  end if;
  if v_expected = 0 then
    insert into public.witness_projects (id, owner_id, payload, revision, updated_at)
    values (p_id, auth.uid(), p_payload, 1, now())
    on conflict (owner_id, id) do nothing
    returning * into v_row;
    if not found then
      raise exception 'witness_save_project conflict: a copy already exists'
        using errcode = 'P0001';
    end if;
    return v_row;
  end if;
  update public.witness_projects
  set payload = p_payload,
      revision = revision + 1,
      updated_at = now()
  where id = p_id
    and owner_id = auth.uid()
    and revision = v_expected
  returning * into v_row;
  if not found then
    raise exception 'witness_save_project conflict: a newer copy exists'
      using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;

-- Table access is owner-only via RLS above; grant the table operations
-- explicitly to authenticated and nothing to anonymous callers.
-- Supabase default privileges also grant directly to anon/authenticated,
-- so the revoke names all three roles before the narrow re-grant.
revoke all on table public.witness_projects from public, anon, authenticated;
grant select, insert, update, delete on table public.witness_projects to authenticated;

-- RPC runs as the caller (security invoker) under the same RLS policies.
-- Revoke execute from public/anon/authenticated first, then grant to
-- authenticated only.
revoke all on function public.witness_save_project(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.witness_save_project(uuid, jsonb, integer) to authenticated;
