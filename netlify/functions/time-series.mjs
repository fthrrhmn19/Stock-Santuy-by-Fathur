import { json, cleanSymbol } from './_shared/http.mjs';
import { hasTwelveDataKey, twelve } from './_shared/twelve.mjs';
import { hasYahooFallback, yahooChart } from './_shared/yahoo.mjs';

const ttlFor = interval => {
  const key = interval === '1day' ? 'CACHE_TTL_DAILY' : 'CACHE_TTL_INTRADAY';
  const ttl = Number(process.env[key]);
  if (Number.isFinite(ttl) && ttl > 0) return Math.floor(ttl);
  return interval === '1day' ? 3600 : 60;
};

export default async req => {
  try {
    const provider = (process.env.MARKET_DATA_PROVIDER || 'twelvedata').toLowerCase();

    const u = new URL(req.url);
    const raw = cleanSymbol(u.searchParams.get('symbol'));
    if (!raw) return json(400, { message: 'Ticker wajib diisi.' });

    const interval = u.searchParams.get('interval') || '1day';
    const outputsize = Math.min(Math.max(Number(u.searchParams.get('outputsize')) || 260, 60), 5000);
    const range = u.searchParams.get('range') || undefined;

    if ((provider === 'yahoo' || !hasTwelveDataKey()) && hasYahooFallback()) {
      const payload = await yahooChart(raw, { interval, outputsize, range });
      const ttl = ttlFor(interval);
      return json(200, payload, { 'Cache-Control': `public, max-age=${ttl}, s-maxage=${ttl}` });
    }

    if (provider !== 'twelvedata') throw new Error(`Provider ${provider} belum didukung.`);

    const candidates = raw.includes(':') || raw.includes('.') ? [raw] : [`${raw}:IDX`, raw, `${raw}.JK`];
    let data, lastErr;

    for (const symbol of candidates) {
      try {
        data = await twelve('time_series', { symbol, interval, outputsize, timezone: 'Asia/Jakarta', order: 'ASC' });
        if (data.values?.length) break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!data?.values?.length) {
      throw lastErr || new Error('Data saham tidak ditemukan. Pastikan paket Twelve Data mendukung Bursa Indonesia.');
    }

    const candles = data.values
      .map(v => ({
        time: Math.floor(new Date(v.datetime).getTime() / 1000),
        date: v.datetime.slice(0, 10),
        datetime: v.datetime,
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        close: Number(v.close),
        volume: Number(v.volume || 0)
      }))
      .filter(c => [c.open, c.high, c.low, c.close].every(Number.isFinite));
    const ttl = ttlFor(interval);

    return json(
      200,
      { symbol: raw, provider: 'Twelve Data', dataStatus: 'delayed', delayedMinutes: null, meta: data.meta, candles },
      { 'Cache-Control': `public, max-age=${ttl}, s-maxage=${ttl}` }
    );
  } catch (e) {
    return json(502, { message: e.message || 'Gagal mengambil data Twelve Data.' });
  }
};
