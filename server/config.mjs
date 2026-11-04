// Server configuration: local development versus public hosted mode.
// Hosted mode is explicit: it turns on only when PUBLIC_ORIGIN is set to
// the public site origin (e.g. https://witness.onrender.com). Local
// development keeps localhost defaults and mock-friendly behaviour.
// Nothing here reads .env files or prints environment values.
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
export function isHosted(env = {}) {
  return typeof env.PUBLIC_ORIGIN === 'string' && !!env.PUBLIC_ORIGIN.trim();
}
export function publicOrigin(env = {}) {
  const raw = typeof env.PUBLIC_ORIGIN === 'string' ? env.PUBLIC_ORIGIN.trim() : '';
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch { return null; }
}
// Host gate for /api/* and other sensitive routes. Local mode accepts only
// loopback hosts. Hosted mode accepts only the configured public host.
// Forwarded headers (X-Forwarded-*) are never consulted: the Host header
// arrives over the direct connection from the platform proxy.
export function isHostAllowed(hostname, env = {}) {
  if (isHosted(env)) {
    const origin = publicOrigin(env);
    if (!origin) return false;
    try { return new URL(origin).hostname.toLowerCase() === String(hostname || '').toLowerCase(); }
    catch { return false; }
  }
  return LOCAL_HOSTS.includes(String(hostname || '').toLowerCase());
}
export function serverListen(env = {}) {
  const port = Number(env.PORT || 4173);
  return {
    port: Number.isInteger(port) && port > 0 ? port : 4173,
    host: typeof env.HOST === 'string' && env.HOST ? env.HOST : '127.0.0.1',
    hosted: isHosted(env),
  };
}
// Lightweight liveness probe. Carries no secrets, versions, or values.
export function healthBody(env = {}) {
  return {ok: true, mode: isHosted(env) ? 'hosted' : 'local'};
}
