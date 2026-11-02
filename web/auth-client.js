// Lazily creates the official Supabase client. Import this module only
// from an explicit Account action handler so the guest flow never loads
// the auth SDK or touches the network. The vendored bundle is built from
// the official @supabase/supabase-js npm package (see scripts/build.mjs).
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

let cached = null;

export async function loadSupabaseClient() {
  if (cached) return cached;
  const mod = await import('./vendor/supabase.js');
  cached = mod.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { flowType: 'pkce', detectSessionInUrl: true },
  });
  return cached;
}
