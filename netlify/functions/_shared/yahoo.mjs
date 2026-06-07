const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = 'Mozilla/5.0 StockSantuy/1.0';

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const dateTimeFmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

export const hasYahooFallback = () => process.env.ENABLE_YAHOO_FALLBACK !== 'false';

export const toYahooSymbol = raw => {
  const symbol = String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9.^:-]/g, '').slice(0, 16);
  if (!symbol) return '';
  if (symbol.startsWith('^')) return symbol;
  if (symbol.endsWith(':IDX')) return `${symbol.slice(0, -4)}.JK`;
  if (symbol.includes('.') || symbol.includes(':')) return symbol;
  return `${symbol}.JK`;
};

const yahooInterval = interval => {
  const value = String(interval || '1day').toLowerCase();
  if (value === '1day' || value === '1d' || value === 'daily') return '1d';
  if (value === '1week' || value === '1wk' || value === '1w' || value === 'weekly') return '1wk';
  if (value === '1month' || value === '1mo' || value === '1mth' || value === 'monthly') return '1mo';
  if (value === '3month' || value === '3mo' || value === 'quarterly') return '3mo';
  if (value === '1min' || value === '1m') return '1m';
  if (value === '5min' || value === '5m') return '5m';
  if (value === '15min' || value === '15m') return '15m';
  if (value === '30min' || value === '30m') return '30m';
  if (value === '1h' || value === '60min' || value === '60m') return '60m';
  return value;
};

const rangeFor = interval => {
  if (interval === '1m') return '5d';
  if (['5m', '15m', '30m', '60m'].includes(interval)) return '1mo';
  if (['1d', '1wk', '1mo', '3mo'].includes(interval)) return '20y';
  return '2y';
};

const fetchJson = async url => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 14000);

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json' }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.chart?.error?.description || `Yahoo Finance error ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
};

const normalizeCandles = result => {
  const quote = result?.indicators?.quote?.[0] || {};
  const timestamps = result?.timestamp || [];

  return timestamps
    .map((ts, i) => {
      const date = new Date(ts * 1000);
      return {
        time: ts,
        date: dateFmt.format(date),
        datetime: dateTimeFmt.format(date).replace(' ', 'T'),
        open: Number(quote.open?.[i]),
        high: Number(quote.high?.[i]),
        low: Number(quote.low?.[i]),
        close: Number(quote.close?.[i]),
        volume: Number(quote.volume?.[i] || 0)
      };
    })
    .filter(c => [c.open, c.high, c.low, c.close].every(v => Number.isFinite(v) && v > 0));
};

export async function yahooChart(rawSymbol, options = {}) {
  if (!hasYahooFallback()) throw new Error('Yahoo fallback tidak diaktifkan.');

  const symbol = toYahooSymbol(rawSymbol);
  if (!symbol) throw new Error('Ticker wajib diisi.');

  const interval = yahooInterval(options.interval);
  const range = options.range || rangeFor(interval);
  const outputsize = Number(options.outputsize) || 260;
  const url = new URL(`${BASE}/${symbol}`);
  url.searchParams.set('interval', interval);
  url.searchParams.set('range', range);
  url.searchParams.set('includePrePost', 'false');
  url.searchParams.set('events', 'div,splits');

  const data = await fetchJson(url);
  const result = data?.chart?.result?.[0];
  const err = data?.chart?.error;
  if (err) throw new Error(err.description || 'Yahoo Finance gagal mengirim data.');

  const candles = normalizeCandles(result).slice(-outputsize);
  if (!candles.length) throw new Error('Data saham tidak ditemukan di Yahoo Finance.');

  const meta = result.meta || {};
  const latest = candles.at(-1);

  return {
    symbol: symbol.replace('.JK', ''),
    provider: 'Yahoo Finance',
    dataStatus: ['1d', '1wk', '1mo', '3mo'].includes(interval) ? 'delayed/eod' : 'intraday-delayed',
    delayedMinutes: null,
    sourceReliability: 'free-unofficial',
    meta: {
      symbol: meta.symbol || symbol,
      name: meta.shortName || meta.longName || symbol.replace('.JK', ''),
      exchange: meta.exchangeName || 'IDX',
      interval,
      currency: meta.currency || 'IDR',
      regularMarketPrice: meta.regularMarketPrice,
      previousClose: meta.chartPreviousClose,
      regularMarketTime: meta.regularMarketTime,
      lastDataTime: latest?.datetime,
      sourceNote: 'Yahoo Finance fallback gratis. Untuk IDX, real-time tidak dijamin dan dapat delayed.'
    },
    candles
  };
}
