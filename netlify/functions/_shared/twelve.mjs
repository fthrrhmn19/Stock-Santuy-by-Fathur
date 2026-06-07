const BASE = 'https://api.twelvedata.com';
const PLACEHOLDER_KEYS = new Set(['masukkan_api_key', 'masukkan_api_key_twelve_data', 'API_KEY_ANDA']);

export const hasTwelveDataKey = () => {
  const key = String(process.env.TWELVE_DATA_API_KEY || '').trim();
  return Boolean(key) && !PLACEHOLDER_KEYS.has(key);
};

export async function twelve(endpoint, params = {}) {
  const key = String(process.env.TWELVE_DATA_API_KEY || '').trim();
  if (!hasTwelveDataKey()) throw new Error('TWELVE_DATA_API_KEY belum disetel di Netlify.');

  const url = new URL(`${BASE}/${endpoint}`);
  Object.entries({ ...params, apikey: key }).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);

  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const d = await r.json();
    if (!r.ok || d.status === 'error') throw new Error(d.message || `Twelve Data error ${r.status}`);
    return d;
  } finally {
    clearTimeout(timer);
  }
}
