// Session verification for hosted Meta endpoints. Local development needs
// no account; hosted mode requires a server-verified Supabase session on
// every paid request. Tokens, stories, and recordings are never logged —
// this module logs nothing at all.
import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
import {isHosted} from './config.mjs';
const TOKEN_CACHE_TTL_MS = 60000;
const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map(); // sha256(token) -> {userId, expires}
let cachedClient = null;
let cachedClientKey = '';
export function __resetAuthForTests() {
  tokenCache.clear();
  cachedClient = null;
  cachedClientKey = '';
}
function authError(message, status) {
  return Object.assign(Error(message), {status});
}
function clientFor(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw authError('Sign-in is not configured on this server yet.', 503);
  const cacheKey = url + '\n' + key;
  if (!cachedClient || cachedClientKey !== cacheKey) {
    cachedClient = createClient(url, key, {auth: {persistSession: false, autoRefreshToken: false}});
    cachedClientKey = cacheKey;
  }
  return cachedClient;
}
async function defaultGetUser(env, token) {
  const {data, error} = await clientFor(env).auth.getUser(token);
  if (error) throw error;
  return data?.user || null;
}
function bearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match ? match[1].trim() : '';
}
// Returns {userId} for a verified session. In local mode returns
// {userId:null} without checking anything. Throws 401/503 otherwise.
export async function requireUser(request, env = {}, {getUser} = {}) {
  if (!isHosted(env)) return {userId: null};
  const token = bearerToken(request);
  if (!token) throw authError('Sign in to use this feature. Your work on this device is saved.', 401);
  const fingerprint = createHash('sha256').update(token).digest('hex');
  const cached = tokenCache.get(fingerprint);
  if (cached && cached.expires > Date.now()) return {userId: cached.userId};
  let user = null;
  try {
    user = getUser ? await getUser(token) : await defaultGetUser(env, token);
  } catch (err) {
    if (err?.status) throw err;
    const msg = String(err?.message || err || '').toLowerCase();
    if (err?.status === 401 || /invalid|expired|malformed|jwt|token|session/i.test(msg) && !/network|fetch|econn|enotfound|timeout/i.test(msg)) {
      throw authError('Your sign-in is not valid any more. Sign in again — your work on this device is saved.', 401);
    }
    throw authError('The sign-in service could not be reached. Your work on this device is saved.', 503);
  }
  const userId = user && typeof user.id === 'string' ? user.id : '';
  if (!userId) throw authError('Your sign-in is not valid any more. Sign in again — your work on this device is saved.', 401);
  if (tokenCache.size >= TOKEN_CACHE_MAX) tokenCache.clear();
  tokenCache.set(fingerprint, {userId, expires: Date.now() + TOKEN_CACHE_TTL_MS});
  return {userId};
}
