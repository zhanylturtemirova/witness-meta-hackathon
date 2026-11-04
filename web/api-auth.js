// Bearer tokens for hosted Meta endpoints. The access token lives only in
// memory, is refreshed from the Supabase session after sign-in, and is
// never logged, persisted, or placed in URLs. Local mode sends no token.
let memoryToken = '';
let hostedMode = false;
export function setHostedMode(on) { hostedMode = !!on; }
export function setApiToken(token) { memoryToken = typeof token === 'string' ? token : ''; }
export function hasApiToken() { return !!memoryToken; }
export function apiAuthHeaders() { return memoryToken ? {Authorization: 'Bearer ' + memoryToken} : {}; }
// Loads the cached session token on hosted servers when none is set yet.
// Lazy: the auth SDK bundle loads only here, never on plain guest pages.
export async function ensureApiToken() {
  if (memoryToken || !hostedMode) return memoryToken;
  try {
    const {loadSupabaseClient} = await import('./auth-client.js');
    const client = await loadSupabaseClient();
    const {data} = await client.auth.getSession();
    setApiToken(data?.session?.access_token || '');
  } catch { setApiToken(''); }
  return memoryToken;
}
