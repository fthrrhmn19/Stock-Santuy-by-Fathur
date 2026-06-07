import { json } from './_shared/http.mjs';
import { analyzeForScan } from './_shared/engine.mjs';
import { yahooChart } from './_shared/yahoo.mjs';
import { IDX_UNIVERSE } from './_shared/idx-universe.mjs';

const PRIORITY_UNIVERSE = [
  'BBCA', 'BBRI', 'BMRI', 'BBNI', 'TLKM', 'ASII', 'UNVR', 'ICBP', 'INDF', 'AMRT',
  'GOTO', 'BRIS', 'MDKA', 'ANTM', 'INCO', 'ADRO', 'PTBA', 'ITMG', 'HRUM', 'MEDC',
  'PGAS', 'ISAT', 'EXCL', 'CPIN', 'JPFA', 'KLBF', 'MIKA', 'TPIA', 'BRPT', 'AKRA',
  'MAPI', 'ACES', 'SMGR', 'INTP', 'ESSA', 'ARTO', 'BUKA', 'EMTK', 'SIDO', 'INKP',
  'AMMN'
];

const MARKET_MOVER_EXTRA = [
  'MUTU', 'MMIX', 'CBPE', 'DIGI', 'LFLO', 'BTON', 'DWGL', 'ICON', 'KOIN', 'BATA',
  'WIFI', 'ARKO', 'RSGK', 'APIC', 'RMKE', 'GPSO', 'IRSX', 'WEHA', 'DOOH', 'ELPI',
  'BUMI', 'DSSA', 'BNBR', 'DEWA', 'CUAN'
];

const UNIVERSE = [...new Set([...PRIORITY_UNIVERSE, ...MARKET_MOVER_EXTRA, ...IDX_UNIVERSE])].slice(0, 320);

const LIQUID_INTRADAY = UNIVERSE.slice(0, 80);

const withLimit = async (items, limit, task) => {
  const out = [];
  let index = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (index < items.length) {
      const current = items[index++];
      try {
        const value = await task(current);
        if (value) out.push(value);
      } catch {
        // Skip symbols unavailable from the free provider.
      }
    }
  });
  await Promise.all(workers);
  return out;
};

const card = (symbol, analysis, meta = {}) => ({
  symbol,
  name: meta.name || symbol,
  price: analysis.price,
  changePct: analysis.changePct,
  score: analysis.score,
  label: analysis.label,
  trend: analysis.trend,
  rsi: analysis.rsi,
  rvol: analysis.rvol,
  statusVolume: analysis.statusVolume,
  breakout: analysis.breakout,
  support: analysis.support,
  resistance: analysis.resistance,
  ebook: analysis.ebook?.available ? {
    score: analysis.ebook.score,
    stage: analysis.ebook.stage?.stage,
    vpa: analysis.ebook.vpa?.label,
    minervini: `${analysis.ebook.minervini?.passed || 0}/${analysis.ebook.minervini?.total || 7}`,
    boxer: analysis.ebook.boxer?.label
  } : null
});

const moverCard = item => {
  const last = item.candles.at(-1);
  const prev = item.candles.at(-2);
  const changePct = prev?.close ? ((last.close - prev.close) / prev.close) * 100 : 0;
  const volume = last.volume || 0;
  return {
    symbol: item.symbol,
    name: item.meta?.name || item.symbol,
    price: last.close,
    changeAbs: prev?.close ? last.close - prev.close : 0,
    changePct,
    value: last.close * volume,
    volume,
    label: changePct >= 0 ? 'Top Gainer' : 'Top Loser',
    trend: changePct >= 0 ? 'market gainer' : 'market loser',
    rsi: null,
    rvol: null,
    statusVolume: 'EOD market mover',
    breakout: false,
    support: null,
    resistance: null,
    source: 'Yahoo Finance IDX EOD'
  };
};

const parseCompactMetric = value => {
  const match = String(value || '').trim().replace(/,/g, '').match(/^([+-]?\d+(?:\.\d+)?)([KMBT])?$/i);
  if (!match) return null;
  const multiplier = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2]?.toUpperCase()] || 1;
  return Number(match[1]) * multiplier;
};

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
    const metric = label => section.match(new RegExp(`${label}\\s+([0-9.,]+[KMBT]?)`, 'i'))?.[1] || null;
    return {
      volume: parseCompactMetric(metric('Volume')),
      lot: parseCompactMetric(metric('Lot')),
      value: parseCompactMetric(metric('Value') || metric('Turnover')),
      average: parseCompactMetric(metric('Average')),
      marketCap: parseCompactMetric(metric('Market Cap')),
      source: 'Yahoo Finance IDX EOD + Pluang turnover stats'
    };
  } finally {
    clearTimeout(timer);
  }
};

const enrichMarketItems = async items => {
  const indexed = items.map((item, order) => ({ item, order }));
  const enriched = await withLimit(indexed, 12, async ({ item, order }) => {
    const stats = await fetchPluangStats(item.symbol).catch(() => ({}));
    return {
      order,
      item: {
        ...item,
        value: Number.isFinite(stats.value) ? stats.value : item.value,
        volume: Number.isFinite(stats.volume) ? stats.volume : item.volume,
        lot: Number.isFinite(stats.lot) ? stats.lot : item.volume / 100,
        average: Number.isFinite(stats.average) ? stats.average : null,
        marketCap: Number.isFinite(stats.marketCap) ? stats.marketCap : null,
        source: stats.source || item.source
      }
    };
  });
  return enriched.sort((a, b) => a.order - b.order).map(entry => entry.item);
};

const baggerCard = (item, meta = {}) => {
  const score = Math.max(0, Math.min(100, Math.round(
    item.investment.score * 0.52
    + item.swing.score * 0.22
    + (item.investment.trend === 'uptrend' ? 10 : 0)
    + Math.min(item.investment.rvol * 7, 10)
    + (item.investment.volatilityPct <= 7 ? 6 : 0)
    + (item.investment.ebook?.stage?.stage?.startsWith('Stage 2') ? 5 : 0)
    + (item.investment.ebook?.minervini?.passed >= 6 ? 5 : 0)
    + (item.investment.ebook?.vpa?.bias === 'bullish' ? 4 : 0)
    - (item.investment.ebook?.stage?.stage?.startsWith('Stage 4') ? 10 : 0)
  )));

  return {
    ...card(item.symbol, item.investment, meta),
    score,
    label: score >= 82 ? 'Potential Bagger' : score >= 70 ? 'Bagger Watch' : 'Monitor',
    expansionProxy: score >= 70
      ? `Butuh validasi news/lapkeu ekspansi; ${item.investment.ebook?.stage?.stage || 'stage belum kuat'}`
      : 'Belum kuat'
  };
};

export default async () => {
  try {
    const daily = await withLimit(UNIVERSE, 10, async symbol => {
      const payload = await yahooChart(symbol, { interval: '1day', outputsize: 260 });
      const swing = analyzeForScan(payload.candles, 'swing');
      const investment = analyzeForScan(payload.candles, 'long');
      if (!swing || !investment) return null;
      return { symbol, meta: payload.meta, candles: payload.candles, swing, investment };
    });

    const intraday = await withLimit(LIQUID_INTRADAY, 8, async symbol => {
      const payload = await yahooChart(symbol, { interval: '5min', outputsize: 180 });
      const day = analyzeForScan(payload.candles, 'day');
      if (!day) return null;
      return { symbol, meta: payload.meta, day };
    });

    const trading = intraday
      .map(item => card(item.symbol, item.day, item.meta))
      .sort((a, b) => b.score - a.score || b.changePct - a.changePct)
      .slice(0, 20);
    const investment = daily
      .map(item => card(item.symbol, item.investment, item.meta))
      .sort((a, b) => b.score - a.score || b.rvol - a.rvol)
      .slice(0, 20);
    const bagger = daily
      .map(item => baggerCard(item, item.meta))
      .sort((a, b) => b.score - a.score || b.rvol - a.rvol)
      .slice(0, 16);
    const swing = daily
      .map(item => card(item.symbol, item.swing, item.meta))
      .sort((a, b) => b.score - a.score || b.changePct - a.changePct)
      .slice(0, 20);

    const allDaily = daily.map(item => card(item.symbol, item.swing, item.meta));
    const movers = daily
      .map(moverCard)
      .filter(item => Number.isFinite(item.price) && Number.isFinite(item.changePct) && item.volume > 0);
    const topGainer = movers
      .filter(x => Number.isFinite(x.changePct))
      .sort((a, b) => b.changePct - a.changePct)
      .slice(0, 10);
    const topLoser = movers
      .filter(x => Number.isFinite(x.changePct))
      .sort((a, b) => a.changePct - b.changePct)
      .slice(0, 10);
    const topValueRaw = movers
      .sort((a, b) => b.value - a.value)
      .slice(0, 20);
    const topVolumeRaw = movers
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10)
      .map(item => ({ ...item, lot: item.volume / 100 }));
    const topValueEnriched = await enrichMarketItems(topValueRaw);
    const topValue = topValueEnriched.sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 10);
    const topVolume = topVolumeRaw.sort((a, b) => (b.lot || b.volume / 100) - (a.lot || a.volume / 100)).slice(0, 10);
    const market = {
      uptrend: allDaily.filter(x => x.trend === 'uptrend').sort((a, b) => b.score - a.score).slice(0, 10),
      breakout: allDaily.filter(x => x.breakout).sort((a, b) => b.changePct - a.changePct).slice(0, 10),
      volumeSpike: allDaily.filter(x => x.rvol >= 1.5).sort((a, b) => b.rvol - a.rvol).slice(0, 10),
      topGainer,
      topLoser,
      topValue,
      topVolume,
      marketMoverSource: 'Yahoo Finance IDX EOD + Pluang turnover stats'
    };

    return json(200, {
      generatedAt: new Date().toISOString(),
      provider: 'Yahoo Finance',
      dataStatus: 'free/delayed fallback - market movers computed from IDX EOD candles',
      trading,
      swing,
      investment,
      bagger,
      market
    }, { 'Cache-Control': 'public, max-age=60, s-maxage=60' });
  } catch (e) {
    return json(502, { message: e.message || 'Scanner gagal mengambil data.' });
  }
};
