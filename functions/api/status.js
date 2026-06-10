import { json } from './_shared/http.js';
import { hasTwelveDataKey } from './_shared/twelve.js';
import { hasYahooFallback } from './_shared/yahoo.js';

export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  globalThis.process = { env: { ...(globalThis.process ? globalThis.process.env : {}), ...env } };
  const provider = (process.env.MARKET_DATA_PROVIDER || 'twelvedata').toLowerCase();
  const twelveReady = provider === 'twelvedata' && hasTwelveDataKey();
  const yahooReady = hasYahooFallback();

  return json(200, {
    configured: twelveReady || yahooReady,
    provider: twelveReady ? 'Twelve Data' : 'Yahoo Finance fallback',
    indonesiaCoverage: twelveReady ? 'EOD delayed/intraday by plan' : 'Free fallback, realtime not guaranteed',
    realtimeCapable: false,
    note: 'IDX realtime resmi umumnya membutuhkan lisensi data. Fallback gratis dipakai untuk analisis live/delayed.'
  });
};
