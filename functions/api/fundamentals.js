import { json, cleanSymbol } from './_shared/http.js';

const parseCompact = value => {
  const match = String(value || '').trim().replace(/,/g, '').match(/^([+-]?\d+(?:\.\d+)?)([KMBT])?$/i);
  if (!match) return null;
  const multiplier = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2]?.toUpperCase()] || 1;
  return Number(match[1]) * multiplier;
};

const TV_COLUMNS = [
  'name',
  'description',
  'close',
  'market_cap_basic',
  'earnings_per_share_diluted_ttm',
  'price_earnings_ttm',
  'price_book_fq',
  'return_on_equity_fq',
  'total_liabilities_fq',
  'total_equity_fq',
  'debt_to_equity_fq',
  'book_value_per_share_fq',
  'total_revenue_ttm',
  'net_income_ttm'
];

const toNumber = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const pickFinite = (...values) => values.find(value => Number.isFinite(value)) ?? null;
const countFinite = (source, keys) => keys.filter(key => Number.isFinite(source[key])).length;

const metricFrom = (section, label) =>
  section.match(new RegExp(`${label}\\s+([0-9.,]+[KMBT]?)`, 'i'))?.[1] || null;

const fetchPluangStats = async symbol => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);

  try {
    const res = await fetch(`https://pluang.com/en/asset/indo-stock/${encodeURIComponent(symbol)}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 StockSantuy/1.0', Accept: 'text/html' }
    });
    if (!res.ok) throw new Error(`Pluang error ${res.status}`);
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ');
    const section = text.match(/Key Stats(.*?)(?:About|News|Global ID)/s)?.[1] || '';

    return {
      provider: 'Pluang public stock page',
      marketCap: parseCompact(metricFrom(section, 'Market Cap')),
      volume: parseCompact(metricFrom(section, 'Volume')),
      lot: parseCompact(metricFrom(section, 'Lot')),
      turnover: parseCompact(metricFrom(section, 'Turnover') || metricFrom(section, 'Value')),
      averagePrice: parseCompact(metricFrom(section, 'Average')),
      iep: parseCompact(metricFrom(section, 'IEP')),
      iev: parseCompact(metricFrom(section, 'IEV'))
    };
  } finally {
    clearTimeout(timer);
  }
};

const fetchTradingViewFundamentals = async symbol => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);

  try {
    const res = await fetch('https://scanner.tradingview.com/indonesia/scan', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 StockSantuy/1.0',
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: 'https://www.tradingview.com',
        Referer: 'https://www.tradingview.com/'
      },
      body: JSON.stringify({
        symbols: { tickers: [`IDX:${symbol}`], query: { types: [] } },
        columns: TV_COLUMNS,
        ignore_unknown_fields: true
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `TradingView error ${res.status}`);

    const row = data?.data?.find(item => item?.s === `IDX:${symbol}`) || data?.data?.[0];
    if (!row?.d?.length) throw new Error('Data rasio TradingView tidak ditemukan.');

    const values = Object.fromEntries(TV_COLUMNS.map((key, index) => [key, row.d[index]]));
    const close = toNumber(values.close);
    const eps = toNumber(values.earnings_per_share_diluted_ttm);
    const per = pickFinite(toNumber(values.price_earnings_ttm), close && eps ? close / eps : null);
    const equity = toNumber(values.total_equity_fq);
    const liabilities = toNumber(values.total_liabilities_fq);
    const liabilitiesToEquity = Number.isFinite(liabilities) && Number.isFinite(equity) && equity !== 0
      ? liabilities / equity
      : null;

    return {
      provider: 'TradingView Indonesia scanner',
      companyName: values.description || values.name || null,
      lastPrice: close,
      marketCap: toNumber(values.market_cap_basic),
      eps,
      per,
      pbv: toNumber(values.price_book_fq),
      roe: toNumber(values.return_on_equity_fq),
      der: pickFinite(liabilitiesToEquity, toNumber(values.debt_to_equity_fq)),
      derBasis: Number.isFinite(liabilitiesToEquity) ? 'liabilities/equity' : 'debt/equity',
      bookValuePerShare: toNumber(values.book_value_per_share_fq),
      totalRevenueTtm: toNumber(values.total_revenue_ttm),
      netIncomeTtm: toNumber(values.net_income_ttm)
    };
  } finally {
    clearTimeout(timer);
  }
};

export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  globalThis.process = { env: { ...(globalThis.process ? globalThis.process.env : {}), ...env } };
  try {
    const u = new URL(req.url);
    const symbol = cleanSymbol(u.searchParams.get('symbol'));
    if (!symbol) return json(400, { message: 'Ticker wajib diisi.' });

    const [pluangResult, tvResult] = await Promise.allSettled([
      fetchPluangStats(symbol),
      fetchTradingViewFundamentals(symbol)
    ]);
    const pluangStats = pluangResult.status === 'fulfilled' ? pluangResult.value : {};
    const tvStats = tvResult.status === 'fulfilled' ? tvResult.value : {};
    const marketStats = {
      marketCap: pickFinite(pluangStats.marketCap, tvStats.marketCap),
      volume: pickFinite(pluangStats.volume),
      lot: pickFinite(pluangStats.lot),
      turnover: pickFinite(pluangStats.turnover),
      averagePrice: pickFinite(pluangStats.averagePrice),
      iep: pickFinite(pluangStats.iep),
      iev: pickFinite(pluangStats.iev)
    };
    const ratioStats = {
      companyName: tvStats.companyName || null,
      lastPrice: pickFinite(tvStats.lastPrice),
      eps: pickFinite(tvStats.eps),
      per: pickFinite(tvStats.per),
      pbv: pickFinite(tvStats.pbv),
      roe: pickFinite(tvStats.roe),
      der: pickFinite(tvStats.der),
      derBasis: tvStats.derBasis || null,
      bookValuePerShare: pickFinite(tvStats.bookValuePerShare),
      totalRevenueTtm: pickFinite(tvStats.totalRevenueTtm),
      netIncomeTtm: pickFinite(tvStats.netIncomeTtm)
    };

    const marketFilled = countFinite(marketStats, ['marketCap', 'volume', 'lot', 'turnover', 'averagePrice']);
    const ratioFilled = countFinite(ratioStats, ['eps', 'per', 'pbv', 'roe', 'der']);
    if (!marketFilled && !ratioFilled) {
      throw new Error(pluangResult.reason?.message || tvResult.reason?.message || 'Fundamental gagal dimuat.');
    }

    const sourceNames = [
      marketFilled ? pluangStats.provider : null,
      ratioFilled ? tvStats.provider : null
    ].filter(Boolean);
    const confidenceScore = Math.min(100, Math.round(
      35
      + marketFilled * 8
      + ratioFilled * 5
      + (Number.isFinite(marketStats.iep) ? 5 : 0)
    ));

    return json(200, {
      generatedAt: new Date().toISOString(),
      symbol,
      ...marketStats,
      ...ratioStats,
      provider: sourceNames.join(' + ') || 'Proxy teknikal',
      financialSource: ratioFilled ? tvStats.provider : null,
      confidenceScore,
      confidenceLabel: confidenceScore >= 85 ? 'Tinggi' : confidenceScore >= 65 ? 'Cukup' : 'Terbatas',
      note: ratioFilled
        ? 'Rasio lapkeu memakai EPS TTM dan data kuartal terbaru dari scanner publik. Validasi final tetap ke laporan keuangan IDX/emiten.'
        : 'Rasio EPS, PER, PBV, ROE, dan DER belum tersedia dari sumber publik.'
    }, { 'Cache-Control': 'public, max-age=900, s-maxage=900' });
  } catch (e) {
    return json(502, { message: e.message || 'Fundamental gagal dimuat.' });
  }
};
