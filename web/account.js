// DOM-free Account dialog markup. Rendered inside the app's modal by
// app.js; all wording here is static text, never interpolated secrets.
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function cloudRowTitle(row) {
  const p = row?.payload;
  if (p && typeof p.title === 'string' && p.title.trim()) return p.title.trim().slice(0, 120);
  return 'Untitled story';
}

function cloudListHtml(acc) {
  if (acc.cloudLoading) return '<p class="muted" role="status">Opening your cloud copies…</p>';
  if (acc.cloudError) return `<div class="stale-banner" role="alert">${esc(acc.cloudError)}</div>`;
  if (!acc.cloudProjects.length)
    return '<p class="muted">No cloud copies yet. Open a finished story and choose “Save to my account”.</p>';
  return `<div class="saved-list">${acc.cloudProjects
    .map(
      (row) => `<article class="memory-card"><div><h3>${esc(cloudRowTitle(row))}</h3><p class="muted">Cloud copy · revision ${esc(row.revision)}</p></div><div class="memory-card-actions"><button class="text-button" data-action="cloud-open" data-id="${esc(row.id)}">Open →</button></div></article>`
    )
    .join('')}</div>`;
}

// The email/code forms are retired from the product UI: sign-in is Google
// only, so no SMTP is needed. The list stays exported (empty) so old callers
// fail closed instead of matching unrelated forms. Legacy OTP helpers remain
// in auth.js with unit tests only.
export const ACCOUNT_FORM_IDS = [];

export function isAccountFormSubmit(formId) {
  return ACCOUNT_FORM_IDS.includes(formId);
}

// Stable marker so the app repaints only a currently open account dialog
// and never overwrites an unrelated story or source dialog on auth events.
export const ACCOUNT_DIALOG_MARKER = 'data-account-dialog';

export function accountDialogHtml(acc, { pendingProjectTitle = '', openedRow = null, notificationsHtml = '' } = {}) {
  const head = '<button class="modal-close" data-action="close" aria-label="Close">×</button><p class="eyebrow">ACCOUNT</p><h2 id="modal-title">Your <em>account.</em></h2>';
  const scopeNote = '<p class="muted">Guest stories stay in this browser. Cloud copies are text only — recordings stay on this device — and never mix into the shelf on their own.</p>';
  if (acc.status !== 'signed-in') {
    return `<div ${ACCOUNT_DIALOG_MARKER}>${head}<p>Sign in with Google to keep cloud copies of your stories. Nothing uploads on its own.</p>${acc.error ? `<div class="stale-banner" role="alert">${esc(acc.error)}</div>` : ''}<div class="event-actions"><button class="button primary" data-action="account-google"><span class="google-mark" aria-hidden="true">G</span> Continue with Google</button></div><p class="muted">No sign-in needed to use Witness — guest stories on this device stay exactly as they are.</p>${notificationsHtml}</div>`;
  }
  const opened = openedRow
    ? `<section aria-label="Open cloud copy"><div class="section-heading"><h3>${esc(cloudRowTitle(openedRow))}</h3><span>revision ${esc(openedRow.revision)}</span></div><p class="muted">Importing makes a local copy on this device — the cloud copy stays as it is. Recordings stay on this device.</p><div class="event-actions"><button class="button primary small" data-action="cloud-import" data-id="${esc(openedRow.id)}">Make a local copy</button></div></section>`
    : '';
  const pending = pendingProjectTitle
    ? `<section aria-label="Save this story"><div class="event-actions"><button class="button primary small" data-action="cloud-save">Save “${esc(pendingProjectTitle.slice(0, 80))}” to my account</button></div><p class="muted">Text only — recordings stay on this device.</p></section>`
    : '';
  return `<div ${ACCOUNT_DIALOG_MARKER}>${head}<p>Signed in as <strong>${esc(acc.email || acc.userId || '')}</strong>.</p>${acc.error ? `<div class="stale-banner" role="alert">${esc(acc.error)}</div>` : ''}${scopeNote}${acc.notice ? `<div class="save-notice" role="status" aria-live="polite">${esc(acc.notice)}</div>` : ''}${pending}<section aria-label="Your cloud copies"><div class="section-heading"><h3>Your cloud copies</h3><button class="text-button" data-action="cloud-refresh">Refresh</button></div>${cloudListHtml(acc)}</section>${opened}${notificationsHtml}<div class="event-actions"><button class="text-button" data-action="account-signout">Sign out</button></div></div>`;
}

export function accountNavLabel(acc) {
  if (acc?.status === 'signed-in' && acc.email) {
    const name = acc.email.split('@')[0].slice(0, 18);
    return name || 'Account';
  }
  return 'Account';
}
