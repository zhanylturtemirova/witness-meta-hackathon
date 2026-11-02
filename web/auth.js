// DOM-free account state for Supabase email OTP sign-in.
// Signup and login share one email-code flow; there is no password and no
// fake logged-in flag. The real session always comes from the SDK client
// (auth.getUser / onAuthStateChange), which the browser loads lazily only
// when the person opens Account. Tokens are never logged or shown.
//
// `client` is the object returned by createClient (or a test fake) with an
// `auth` namespace shaped like the official SDK.
export const CLOUD_TABLE = 'witness_projects';

export function createAccount() {
  return {
    status: 'signed-out', // 'signed-out' | 'code-sent' | 'signed-in'
    email: '',
    userId: null,
    error: '',
    seq: 0, // bumps on every new request; stale responses are dropped
    cloudSeq: 0, // bumps when the cloud list is cleared or reloaded
    cloudProjects: [], // rows scoped to the signed-in user, this session only
    cloudError: '',
    cloudLoading: false,
    notice: '', // in-dialog success text (aria-live status), never a toast
  };
}

export function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim());
}

function networkLike(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return err instanceof TypeError || /network|fetch|offline|load failed|failed to fetch|econn|enotfound|timeout/i.test(msg);
}

// Error text is always safe to show: it never includes the code/token.
export function authErrorMessage(err) {
  const msg = String(err?.message || err || '');
  if (!msg || networkLike(err))
    return 'Witness could not reach the sign-in service. You may be offline — your stories are unchanged. Try again when connected.';
  if (/expir/i.test(msg))
    return 'That code has expired. Ask for a new one and try again — nothing was changed.';
  if (/session|jwt/i.test(msg))
    return 'Your sign-in expired. Sign in again — your stories on this device are unchanged.';
  if (/invalid|incorrect|wrong|mismatch|not match/i.test(msg))
    return 'That code did not match. Check the latest email and try again — nothing was changed.';
  if (/rate|too many|throttl/i.test(msg))
    return 'Too many attempts for now. Wait a little before asking for another code.';
  if (/smtp|mail|send/i.test(msg))
    return 'Sign-in email is unavailable right now. Try again later — your stories on this device are unchanged.';
  return 'Something did not work on the sign-in step. Nothing was changed — try again.';
}

function currentUserId(data) {
  return data?.user?.id || null;
}

// Sending happens only from an explicit user click. This function never
// sends on its own; the UI calls it from the "Send code" button handler.
export async function sendCode(client, acc, email) {
  const seq = ++acc.seq;
  const clean = String(email || '').trim().toLowerCase();
  if (!validEmail(clean)) {
    acc.error = 'Enter an email address first, then ask for a code.';
    return { ok: false };
  }
  acc.error = '';
  try {
    const { error } = await client.auth.signInWithOtp({
      email: clean,
      options: { shouldCreateUser: true },
    });
    if (seq !== acc.seq) return { ok: false, stale: true };
    if (error) {
      acc.error = authErrorMessage(error);
      return { ok: false };
    }
    acc.status = 'code-sent';
    acc.email = clean;
    return { ok: true };
  } catch (err) {
    if (seq !== acc.seq) return { ok: false, stale: true };
    acc.error = authErrorMessage(err);
    return { ok: false };
  }
}

export async function verifyCode(client, acc, email, token) {
  const seq = ++acc.seq;
  const code = String(token || '').trim();
  if (!code) {
    acc.error = 'Enter the code from the email first.';
    return { ok: false };
  }
  acc.error = '';
  try {
    const { error } = await client.auth.verifyOtp({
      email: String(email || '').trim().toLowerCase() || acc.email,
      token: code,
      type: 'email',
    });
    if (seq !== acc.seq) return { ok: false, stale: true };
    if (error) {
      acc.error = authErrorMessage(error);
      return { ok: false };
    }
    const { data } = await client.auth.getUser();
    if (seq !== acc.seq) return { ok: false, stale: true };
    const userId = currentUserId(data);
    if (!userId) {
      acc.error = authErrorMessage('session missing');
      return { ok: false };
    }
    noteAccountSwitch(acc, userId);
    acc.status = 'signed-in';
    acc.userId = userId;
    return { ok: true };
  } catch (err) {
    if (seq !== acc.seq) return { ok: false, stale: true };
    acc.error = authErrorMessage(err);
    return { ok: false };
  }
}

// Google is the primary (and only advertised) sign-in. The redirect starts
// ONLY from the explicit "Continue with Google" button; nothing here runs
// on page load. No extra scopes are requested and no offline access is asked
// for — the SDK call passes provider and redirectTo only. A successful call
// still leaves the account signed out: the real session arrives only after
// the provider redirects back and the SDK reports a user (getUser or an
// auth-state event). Legacy email-OTP helpers below are kept for tests but
// are no longer shown in the product UI.
export function validRedirectUrl(value) {
  try {
    const u = new URL(String(value || ''));
    if (u.protocol === 'https:' && u.hostname) return true;
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
    return false;
  } catch {
    return false;
  }
}

export async function startGoogleSignIn(client, acc, redirectTo) {
  const seq = ++acc.seq;
  if (!validRedirectUrl(redirectTo)) {
    acc.error = 'That sign-in address did not look right. Nothing was changed — try again from this page.';
    return { ok: false };
  }
  acc.error = '';
  try {
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: String(redirectTo) },
    });
    if (seq !== acc.seq) return { ok: false, stale: true };
    if (error) {
      acc.error = authErrorMessage(error);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    if (seq !== acc.seq) return { ok: false, stale: true };
    acc.error = authErrorMessage(err);
    return { ok: false };
  }
}

// DOM-free check for an OAuth return: Supabase PKCE uses ?code=, while the
// fragment carries access_token (or error on failure). Any other URL is a
// normal guest load and must never load the auth SDK or touch the network.
export function isOAuthReturn(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.searchParams.has('code')) return true;
    return /(^|[#&])(access_token|error)(=|&|$)/.test(u.hash || '');
  } catch {
    return false;
  }
}

// Re-checks the SDK session (expiry, refresh, offline). Never throws.
export async function refreshAccount(client, acc) {
  const seq = ++acc.seq;
  try {
    const { data, error } = await client.auth.getUser();
    if (seq !== acc.seq) return { ok: false, stale: true };
    const userId = error ? null : currentUserId(data);
    if (!userId) {
      if (acc.status === 'signed-in') {
        noteAccountSwitch(acc, null);
        acc.status = 'signed-out';
        acc.userId = null;
        acc.error = error ? authErrorMessage(error) : '';
      }
      return { ok: false };
    }
    if (userId !== acc.userId) noteAccountSwitch(acc, userId);
    acc.status = 'signed-in';
    acc.userId = userId;
    acc.error = '';
    return { ok: true };
  } catch (err) {
    if (seq !== acc.seq) return { ok: false, stale: true };
    if (acc.status === 'signed-in') {
      noteAccountSwitch(acc, null);
      acc.status = 'signed-out';
      acc.userId = null;
      acc.error = authErrorMessage(err);
    }
    return { ok: false };
  }
}

// Signing out (or switching accounts) clears the cloud list and cancels
// pending cloud requests so one account's projects never show under another.
// The seq bump runs first so an in-flight send/verify/refresh that resolves
// after sign-out is dropped instead of signing the UI back in.
export async function signOutAccount(client, acc) {
  acc.seq++;
  clearCloud(acc);
  acc.error = '';
  try {
    const { error } = await client.auth.signOut();
    acc.status = 'signed-out';
    acc.userId = null;
    if (error) {
      acc.error = authErrorMessage(error);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    acc.status = 'signed-out';
    acc.userId = null;
    acc.error = authErrorMessage(err);
    return { ok: false };
  }
}

// Drops the session-scoped cloud list and invalidates in-flight cloud
// requests. Local guest stories are never touched here.
export function clearCloud(acc) {
  acc.cloudSeq++;
  acc.cloudProjects = [];
  acc.cloudError = '';
  acc.cloudLoading = false;
  acc.notice = '';
}

// Call whenever the SDK reports a user id (verify, refresh, auth events).
// Returns true when the account actually changed, in which case the cloud
// list was cleared and in-flight send/verify/refresh work was cancelled via
// the seq bump. Keep callers of this function synchronous: never issue
// async Supabase calls from inside an onAuthStateChange callback, where
// they can deadlock the SDK auth lock.
export function noteAccountSwitch(acc, newUserId) {
  if ((acc.userId || null) === (newUserId || null)) return false;
  acc.seq++;
  clearCloud(acc);
  return true;
}

// Lists only the signed-in user's rows. Stale responses (a list that
// resolves after sign-out or account switch) are dropped, never shown.
export async function listCloud(client, acc) {
  if (!acc.userId) {
    acc.cloudError = 'Sign in to see your cloud copies.';
    return { ok: false };
  }
  const seq = ++acc.cloudSeq;
  acc.cloudLoading = true;
  acc.cloudError = '';
  try {
    const { data, error } = await client
      .from(CLOUD_TABLE)
      .select('id,owner_id,revision,updated_at,payload')
      .order('updated_at', { ascending: false });
    if (seq !== acc.cloudSeq) return { ok: false, stale: true };
    acc.cloudLoading = false;
    if (error) {
      acc.cloudError = cloudReadError(error);
      return { ok: false };
    }
    // Belt-and-braces alongside RLS: show only rows owned by this user.
    acc.cloudProjects = (Array.isArray(data) ? data : []).filter(
      (row) => row && row.owner_id === acc.userId
    );
    return { ok: true, rows: acc.cloudProjects };
  } catch (err) {
    if (seq !== acc.cloudSeq) return { ok: false, stale: true };
    acc.cloudLoading = false;
    acc.cloudError = cloudReadError(err);
    return { ok: false };
  }
}

export function cloudReadError(err) {
  const msg = String(err?.message || err || '');
  if (!msg || networkLike(err))
    return 'The cloud list could not be reached. You may be offline — your stories on this device are unchanged.';
  if (/relation .* does not exist|table .* does not exist|PGRST|schema cache|function .* does not exist/i.test(msg))
    return 'Cloud saving is not set up yet: the project table has not been created. Your stories on this device are unchanged.';
  if (/expired|jwt|auth|permission|policy|rls|unauthorized|401|403/i.test(msg))
    return 'Your sign-in expired. Sign in again to see your cloud copies — your stories on this device are unchanged.';
  return 'The cloud list could not be opened. Your stories on this device are unchanged.';
}
