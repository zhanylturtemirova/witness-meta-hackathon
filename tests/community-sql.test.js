import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Static contract checks on the reviewed first-install migration. They run
// without a database and without network calls: they prove the FILE holds
// the hardened shape (no direct published INSERT/UPDATE grants, strict
// passage/topic validation, locked-down like trigger, derived quote
// attribution). They do NOT prove row-level security end to end — after
// applying, the owner re-checks privileges live (two distinct accounts:
// one publishes, the other likes; direct INSERT/UPDATE on published rows
// must fail; like_count must follow the real like rows).
const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations', '20261103_community.sql'),
  'utf8',
);

test('migration is first-install with no destructive statements', () => {
  const code = sql.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(code, /\bdrop\b/i);
  assert.doesNotMatch(code, /\btruncate\b/i);
  assert.doesNotMatch(code, /\bdelete\s+from\b/i);
});

test('published rows have no direct insert/update grants; owners keep delete', () => {
  const grants = sql
    .split('\n')
    .filter((line) => /^\s*grant\b/i.test(line) && /published_stories/i.test(line));
  assert.ok(grants.length > 0, 'expected published_stories grants');
  for (const line of grants) assert.doesNotMatch(line, /\binsert\b|\bupdate\b/i);
  assert.ok(
    grants.some((line) => /\bdelete\b/i.test(line)),
    'owners keep direct DELETE for unpublishing',
  );
  assert.doesNotMatch(sql, /for\s+insert\s+to\s+authenticated[\s\S]{0,120}published_stories/i);
  assert.ok(/published_stories_owner_delete/i.test(sql), 'owner delete policy exists');
});

test('passages allow only exact {text} with real string content', () => {
  assert.match(sql, /jsonb_object_keys/);
  assert.match(sql, /jsonb_typeof\(item -> 'text'\) <>\s*'string'|jsonb_typeof\(item -> 'text'\)\s*=\s*'string'/);
  assert.match(sql, /btrim\(v_text\)/);
});

test('topics require listed ids with no duplicates', () => {
  for (const id of ['moving-abroad', 'first-concert', 'first-project', 'turning-point', 'family', 'everyday', 'work', 'celebration'])
    assert.ok(sql.includes(`'${id}'`), `topic ${id} allowlisted in SQL`);
  assert.match(sql, /count\(distinct/i);
});

test('city coordinates arrive as a finite pair', () => {
  assert.match(sql, /must be set together/);
  assert.match(sql, /Infinity.*NaN|NaN.*Infinity/);
  assert.match(sql, /\(lon is null and lat is null\) or \(lon is not null and lat is not null\)/);
});

test('like-count trigger is definer-owned, uncallable, and recomputed from real rows', () => {
  const body = sql.slice(sql.indexOf('witness_refresh_like_count'));
  assert.match(body, /security definer/);
  assert.match(body, /set search_path = public/);
  assert.match(body, /select count\(\*\) from public\.story_likes/);
  assert.match(sql, /revoke all on function public\.witness_refresh_like_count\(\) from public, anon, authenticated/);
});

test('quote writes derive attribution and scope the owner', () => {
  assert.match(sql, /NEW\.author :=/);
  assert.match(sql, /NEW\.source_title :=/);
  assert.match(sql, /NEW\.owner_id := auth\.uid\(\)/);
  assert.match(sql, /belongs to someone else/);
});

test('owner-scoped RPCs refuse anonymous callers', () => {
  const rpcs = ['witness_publish_story', 'witness_save_quote', 'witness_save_book'];
  for (const name of rpcs) {
    const body = sql.slice(sql.indexOf(`function public.${name}`));
    assert.match(body, /auth\.uid\(\) is null/);
    assert.match(body, /security definer/);
    assert.match(body, /set search_path = public/);
  }
});
