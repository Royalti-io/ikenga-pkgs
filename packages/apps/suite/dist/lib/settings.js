// Feature toggles + small settings, persisted to localStorage. Each iframe
// document has its own localStorage scoped to the pkg-content origin/token,
// so settings are per-install. If you want them to sync across devices,
// promote this to a `suite_settings` Supabase table later.

const KEY = 'suite.settings.v1';

const DEFAULTS = {
  features: {
    tasks: true,
    sales: true,
    outbound: true,
    email: true,
  },
};

function readRaw() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      features: { ...DEFAULTS.features, ...(parsed.features ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

let cached = readRaw();
const subscribers = new Set();

export function getSettings() {
  return cached;
}

export function isFeatureEnabled(featureId) {
  return cached.features[featureId] !== false;
}

export function setFeatureEnabled(featureId, enabled) {
  cached = {
    ...cached,
    features: { ...cached.features, [featureId]: enabled },
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch (e) {
    console.warn('[suite] settings persist failed', e);
  }
  for (const fn of subscribers) fn(cached);
}

export function subscribeSettings(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
