// DOM-free Notifications markup. Rendered inside the Account dialog by
// app.js; all wording here is static English text, never secrets or tokens.
// Quote wording is never rendered here — pushes stay generic unless the
// owner enables preview text, and even then only the selected snapshots do.
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const PUSH_PREFS_FORM_ID = 'push-prefs-form';

const COMMON_ZONES = [
  'UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Moscow', 'America/New_York',
  'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo',
  'Asia/Dubai', 'Asia/Almaty', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
  'Pacific/Auckland',
];

function statusLine(view) {
  switch (view.status) {
    case 'unsupported':
      return 'This browser cannot receive push notifications. Reminders stay off here — try a recent Chrome, Edge, Firefox, or Safari.';
    case 'denied':
      return 'Notifications are blocked for this site in the browser settings. Reminders stay off until you allow them there.';
    case 'signed-out':
      return 'Sign in to use reminders. They need your account so the schedule knows whose phrases and questions to send.';
    case 'unconfigured':
      return 'Reminders aren’t available yet. Please check back later.';
    case 'on':
      return 'Reminders are on for this device. Turn off either kind, or disable this device, any time.';
    default:
      return 'Optional reminders: a saved phrase, or a question to reflect on. Both are off unless you enable them.';
  }
}

function quoteSyncHtml(view) {
  const quotes = Array.isArray(view.quotes) ? view.quotes : [];
  if (!quotes.length)
    return '<p class="muted">Nothing saved yet. Save exact words from a fictional story or one of your own stories first, then choose which ones may be reminded.</p>';
  const synced = new Set(Array.isArray(view.syncedKeys) ? view.syncedKeys : []);
  return `<div class="saved-list">${quotes
    .map((q) => {
      const on = synced.has(q.id);
      const label = q.sourceKind === 'own' ? 'YOUR STORY' : (q.sourceKind === 'published' ? 'SHARED STORY' : 'FICTIONAL STORY');
      return `<article class="memory-card"><div><blockquote class="saved-text">“${esc(String(q.text).slice(0, 160))}”</blockquote><p class="muted">${esc(q.author)} · ${esc(q.sourceTitle)} · ${label}</p></div><div class="memory-card-actions"><button class="text-button" data-action="push-quote" data-id="${esc(q.id)}" aria-pressed="${on}">${on ? 'Reminders on ✓' : 'Remind me'}</button></div></article>`;
    })
    .join('')}</div><p class="muted">Only the phrases you switch on are copied to the server as snapshots. Everything else stays in this browser.</p>`;
}

// `view` carries: status, prefs, deviceOn, busy, error, notice,
// quotes, syncedKeys, deviceTimeZone.
export function pushSectionHtml(view = {}) {
  const v = {
    status: 'ready', prefs: null, deviceOn: false, busy: false,
    error: '', notice: '', quotes: [], syncedKeys: [], deviceTimeZone: '',
    ...view,
  };
  const p = v.prefs && typeof v.prefs === 'object'
    ? v.prefs
    : { phraseEnabled: false, questionEnabled: false, cadence: 'daily', localTime: '09:00', timeZone: v.deviceTimeZone || 'UTC', quietStart: '22:00', quietEnd: '07:00', previewText: false };
  const disabled = v.busy || v.status === 'signed-out' || v.status === 'unconfigured' || v.status === 'unsupported' ? 'disabled' : '';
  const zones = [...new Set([p.timeZone, v.deviceTimeZone, ...COMMON_ZONES].filter(Boolean))];
  return `<section class="push-settings" aria-label="Notifications"><div class="section-heading push-status"><h3>Notifications</h3><span>${v.deviceOn ? 'on for this device' : 'off'}</span></div>`
    + `<p class="muted">${esc(statusLine(v))}</p>`
    + (v.error ? `<div class="stale-banner" role="alert">${esc(v.error)}</div>` : '')
    + (v.notice ? `<div class="save-notice" role="status" aria-live="polite">${esc(v.notice)}</div>` : '')
    + `<form id="${PUSH_PREFS_FORM_ID}"><fieldset class="push-opts"><legend class="muted">Remind me about</legend>`
    + `<label><input type="checkbox" name="phraseEnabled" ${p.phraseEnabled ? 'checked' : ''} ${disabled}> Saved phrase reminders</label>`
    + `<label><input type="checkbox" name="questionEnabled" ${p.questionEnabled ? 'checked' : ''} ${disabled}> Interview questions</label></fieldset>`
    + `<div class="push-grid"><label>How often <select name="cadence" ${disabled}><option value="daily" ${p.cadence === 'daily' ? 'selected' : ''}>Daily</option><option value="weekly" ${p.cadence === 'weekly' ? 'selected' : ''}>Weekly</option></select></label>`
    + `<label>At <input type="time" name="localTime" value="${esc(p.localTime)}" required ${disabled}></label>`
    + `<label>Time zone <input type="text" name="timeZone" list="push-tz-list" value="${esc(p.timeZone)}" required maxlength="100" ${disabled}><datalist id="push-tz-list">${zones.map((z) => `<option value="${esc(z)}">`).join('')}</datalist></label>`
    + `<label>Quiet from <input type="time" name="quietStart" value="${esc(p.quietStart)}" required ${disabled}></label>`
    + `<label>Quiet until <input type="time" name="quietEnd" value="${esc(p.quietEnd)}" required ${disabled}></label></div>`
    + `<label class="muted"><input type="checkbox" name="previewText" ${p.previewText ? 'checked' : ''} ${disabled}> Show the words on the lock screen (off means generic reminders)</label>`
    + `<div class="event-actions"><button class="button outline small" type="submit" ${disabled}>${v.busy ? 'Saving…' : 'Save schedule'}</button></div></form>`
    + `<div class="event-actions">`
    + (v.deviceOn
      ? `<button class="button outline small" data-action="push-disable" ${v.busy ? 'disabled' : ''}>Disable on this device</button><button class="text-button" data-action="push-test" ${v.busy ? 'disabled' : ''}>Send a test</button>`
      : `<button class="button primary small" data-action="push-enable" ${disabled || !v.pushReady ? 'disabled' : ''}>${v.busy ? 'Checking…' : (v.pushReady ? 'Enable on this device' : 'Checking…')}</button>`)
    + `</div>`
    + `<div class="section-heading"><h3>Phrases that may be reminded</h3></div>`
    + quoteSyncHtml(v)
    + `<details><summary>On iPhone or iPad</summary><p class="muted">Notifications need Witness added to the Home Screen: open Witness in Safari, then Share → Add to Home Screen, and open it from there. Your stories stay in this browser either way.</p></details>`
    + `</section>`;
}

// Compact entry shown at the top of the Saved view.
export function pushSavedEntryHtml(status) {
  const label = status === 'on' ? 'Reminders are on for this device.' : 'Optional reminders are off.';
  return `<section aria-label="Reminders"><p class="muted">${esc(label)} <button class="text-button" data-action="account">Notification settings →</button></p></section>`;
}
