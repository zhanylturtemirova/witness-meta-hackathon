// DOM-free cloud project helpers. Cloud rows are text-only copies of a
// local story: recordings and images always stay on this device until media
// storage integration lands. Nothing uploads automatically and nothing
// merges into the local library without an explicit import click.
import { validProject } from './domain.js';
import { CLOUD_TABLE } from './auth.js';

export { CLOUD_TABLE };

export const SAVE_RPC = 'witness_save_project';

// A local copy remembers which cloud revision it came from (or was saved
// as) so later saves can compare-and-swap instead of silently overwriting.
// The revision is bound to the account that wrote it: when a user id is
// given and the copy belongs to a different owner, the revision reads as 0
// (never saved under this account) so a save creates that account's own
// row instead of overwriting someone else's.
export function cloudRevisionOf(project, userId) {
  if (
    userId &&
    project?.cloudOwnerId &&
    project.cloudOwnerId !== userId
  )
    return 0;
  const rev = Number(project?.cloudRevision);
  return Number.isInteger(rev) && rev >= 0 ? rev : 0;
}

// Builds the text-only payload for a cloud save. Returns the payload plus
// a list of what stayed on this device, shown next to the save button.
export function textOnlyPayload(project) {
  const clone = JSON.parse(JSON.stringify(project));
  const dropped = [];
  if (Array.isArray(clone.recordings) && clone.recordings.length) dropped.push('recordings');
  delete clone.recordings;
  if (clone.images !== undefined) {
    if (Array.isArray(clone.images) && clone.images.length) dropped.push('images');
    delete clone.images;
  }
  if (clone.video !== undefined) {
    dropped.push('film plan');
    delete clone.video;
  }
  delete clone.cloudRevision;
  delete clone.cloudOwnerId;
  delete clone.cloudImport;
  return { payload: clone, dropped };
}

export function isOwnerRow(row, userId) {
  return !!row && !!userId && row.owner_id === userId;
}

// A row is loadable only when its shape is intact and its payload is still
// a valid story. Owner scoping is enforced by RLS; the caller additionally
// checks isOwnerRow before showing anything.
export function validateCloudRow(row) {
  if (!row || typeof row !== 'object') return 'That cloud copy is damaged and was not opened.';
  if (typeof row.id !== 'string' || !row.id) return 'That cloud copy is damaged and was not opened.';
  if (typeof row.owner_id !== 'string' || !row.owner_id) return 'That cloud copy is damaged and was not opened.';
  if (!Number.isInteger(row.revision) || row.revision < 1) return 'That cloud copy is damaged and was not opened.';
  if (!row.payload || typeof row.payload !== 'object') return 'That cloud copy is damaged and was not opened.';
  if (row.payload.id !== row.id) return 'That cloud copy is damaged and was not opened.';
  if (!validProject(row.payload)) return 'That cloud copy no longer matches a story Witness can open. Nothing was changed.';
  return null;
}

// Saves on explicit user action only. Uses the atomic compare-and-swap RPC
// so two tabs or devices cannot silently last-write-win: when the cloud
// revision moved since this copy was opened, the write is refused and the
// local story is left intact. Never reports success on a failed write.
export async function saveCloudProject(client, acc, project, expectedRevision) {
  if (!acc?.userId) return { ok: false, error: 'Sign in to save a cloud copy.' };
  if (!project || !validProject(project))
    return { ok: false, error: 'This story cannot be saved yet. Nothing was sent.' };
  const { payload, dropped } = textOnlyPayload(project);
  if (!validProject(payload))
    return { ok: false, error: 'This story cannot be saved yet. Nothing was sent.' };
  const expected = expectedRevision ?? cloudRevisionOf(project);
  try {
    const { data, error } = await client.rpc(SAVE_RPC, {
      p_id: project.id,
      p_payload: payload,
      p_expected_revision: expected,
    });
    if (error) return { ok: false, ...cloudWriteError(error) };
    const revision = Number(data?.revision);
    if (!Number.isInteger(revision) || revision < 1)
      return { ok: false, error: 'The cloud copy could not be confirmed. Nothing was changed on this device.' };
    return { ok: true, revision, dropped };
  } catch (err) {
    return { ok: false, error: cloudWriteError(err).error };
  }
}

export function cloudWriteError(err) {
  const msg = String(err?.message || err || '');
  if (!msg || /network|fetch|offline|load failed|failed to fetch|econn|enotfound|timeout/i.test(msg.toLowerCase()) || err instanceof TypeError)
    return { error: 'The cloud copy could not be reached. You may be offline — your story on this device is unchanged.' };
  if (/revision|conflict|newer/i.test(msg))
    return {
      conflict: true,
      error: 'A newer cloud copy exists (saved from another tab or device). It was kept — your story on this device is unchanged. Open the cloud copy to compare.',
    };
  if (/relation .* does not exist|table .* does not exist|PGRST|schema cache|function .* does not exist/i.test(msg))
    return { error: 'Cloud saving is not set up yet: the project table has not been created. Your story on this device is unchanged.' };
  if (/expired|jwt|auth|permission|policy|rls|unauthorized|401|403/i.test(msg))
    return { error: 'Your sign-in expired. Sign in again to save — your story on this device is unchanged.' };
  return { error: 'The cloud copy could not be saved. Your story on this device is unchanged.' };
}

// Reads one owned row for the explicit open/import step.
export async function openCloudProject(client, acc, id) {
  if (!acc?.userId) return { ok: false, error: 'Sign in to open a cloud copy.' };
  try {
    const { data, error } = await client.from(CLOUD_TABLE).select('*').eq('id', id).single();
    if (error) {
      const { error: message } = cloudWriteError(error);
      return { ok: false, error: message };
    }
    if (!isOwnerRow(data, acc.userId))
      return { ok: false, error: 'That copy belongs to a different account and was not opened.' };
    const problem = validateCloudRow(data);
    if (problem) return { ok: false, error: problem };
    return { ok: true, row: data };
  } catch (err) {
    return { ok: false, error: cloudWriteError(err).error };
  }
}

// Import is explicit: it makes a local copy of the cloud row and never
// merges cloud data into the shared local library. Blocked while this tab
// is stale or a recording/capture is pending.
export function importGuard({ storageConflict, capturePending }) {
  if (storageConflict)
    return 'This tab is behind another tab. Download your draft or reload the saved version before importing.';
  if (capturePending)
    return 'Finish recording or saving your audio before importing.';
  return null;
}

export function buildLocalCopy(row, { userId, existingIds, now = Date.now() } = {}) {
  if (!isOwnerRow(row, userId))
    return { ok: false, error: 'That copy belongs to a different account and was not imported.' };
  const problem = validateCloudRow(row);
  if (problem) return { ok: false, error: problem };
  if (Array.isArray(existingIds) && existingIds.includes(row.id))
    return { ok: false, error: 'That story is already on this device. Nothing was imported.' };
  const project = {
    ...JSON.parse(JSON.stringify(row.payload)),
    updatedAt: now,
    cloudRevision: row.revision,
    cloudOwnerId: row.owner_id,
    cloudImport: { revision: row.revision, at: now, cloudId: row.id },
  };
  if (!validProject(project)) return { ok: false, error: 'That cloud copy no longer matches a story Witness can open. Nothing was imported.' };
  return { ok: true, project };
}

// Decides the in-dialog outcome after a confirmed cloud save plus an
// optional list refresh. Pure: no network, no DOM, unit-testable offline.
// A failed refresh never rewrites a confirmed save as a failure — the save
// notice stands and the caller shows the list error from account state
// alongside it. `list` is null when no refresh was attempted.
export function cloudSaveFollowup({ saveUid, userId, save, list }) {
  if (!userId || userId !== saveUid)
    return { status: 'account-changed', notice: '', error: 'The account changed while saving. Nothing was changed on this device.' };
  if (!save?.ok)
    return { status: 'save-failed', notice: '', error: save?.error || 'The cloud copy could not be saved. Your story on this device is unchanged.' };
  const kept = Array.isArray(save.dropped) && save.dropped.length
    ? 'Cloud copy saved. Text only — ' + save.dropped.join(', ') + ' stayed on this device.'
    : 'Cloud copy saved.';
  if (list && !list.ok) return { status: 'saved-list-stale', notice: kept, error: '' };
  return { status: 'saved', notice: kept, error: '' };
}
