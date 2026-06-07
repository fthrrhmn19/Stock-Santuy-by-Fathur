import { json } from './_shared/http.mjs';
import { hasTwelveDataKey } from './_shared/twelve.mjs';
import { hasYahooFallback } from './_shared/yahoo.mjs';

export default async () => {
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
