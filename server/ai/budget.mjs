// Spending guards for paid Meta calls: per-user hourly limits, bounded
// concurrency, and a global generation cap. Every upstream Meta call spends
// from the budget, including verification and repair calls. State is
// in-memory: a server restart resets counters, which is safe (fail closed
// on the cap only within a single process lifetime). Nothing is logged.
const HOUR_MS = 3600000;
const state = {
  users: new Map(), // key -> {count, windowStart}
  globalSpent: 0,
  inFlight: 0,
};
export function __resetBudgetForTests() {
  state.users.clear();
  state.globalSpent = 0;
  state.inFlight = 0;
}
function budgetError(message, status) {
  return Object.assign(Error(message), {status});
}
function num(env, name, fallback) {
  const v = Number(env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}
export function budgetConfig(env = {}) {
  return {
    userHourlyLimit: num(env, 'AI_USER_HOURLY_LIMIT', 60),
    maxConcurrent: Math.max(1, Math.floor(num(env, 'AI_MAX_CONCURRENT', 1))),
    globalCap: num(env, 'AI_GENERATION_CAP', 1000),
  };
}
// Spend one generation for a user (null in local mode). Throws 429 when
// the user is over their hourly limit, 503 when the global cap is spent.
export function spendGeneration(userId, env = {}) {
  const {userHourlyLimit, globalCap} = budgetConfig(env);
  if (state.globalSpent >= globalCap) {
    throw budgetError('The shared generation budget for this test deployment is spent. Your work is saved.', 503);
  }
  const key = userId || 'local';
  const now = Date.now();
  let entry = state.users.get(key);
  if (!entry || now - entry.windowStart >= HOUR_MS) {
    entry = {count: 0, windowStart: now};
    state.users.set(key, entry);
  }
  if (entry.count >= userHourlyLimit) {
    throw budgetError('You have used this hour\u2019s share of AI requests. Your work is saved; try again later.', 429);
  }
  entry.count += 1;
  state.globalSpent += 1;
  return {userSpent: entry.count, globalSpent: state.globalSpent};
}
// Bounded concurrency across all paid endpoints. Throws 429 when full;
// the caller must call the returned release exactly once.
export function acquireSlot(env = {}) {
  const {maxConcurrent} = budgetConfig(env);
  if (state.inFlight >= maxConcurrent) {
    throw budgetError('Another AI request is running. Wait a moment before retrying. Your answers are still saved.', 429);
  }
  state.inFlight += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.inFlight = Math.max(0, state.inFlight - 1);
  };
}
