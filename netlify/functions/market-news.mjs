import { json, cleanSymbol } from './_shared/http.mjs';
import { fetchRss } from './_shared/rss.mjs';
import { toYahooSymbol } from './_shared/yahoo.mjs';
import { IDX_UNIVERSE } from './_shared/idx-universe.mjs';

const GENERAL_FEEDS = [
  { source: 'CNBC Indonesia Market', url: 'https://www.cnbcindonesia.com/market/rss' },
  { source: 'IDXChannel', url: 'https://www.idxchannel.com/rss' }
];

const EXPANSION_KEYWORDS = [
  'ekspansi', 'capex', 'belanja modal', 'akuisisi', 'pabrik', 'proyek', 'kontrak',
  'laporan keuangan', 'lapkeu', 'laba', 'pendapatan', 'revenue', 'growth', 'rights issue',
  'merger', 'investasi', 'dividen', 'kinerja'
];

const uniqueByLink = items => {
  const seen = new Set();
  return items.filter(item => {
    const key = item.link || item.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const detectSymbols = (item, activeSymbol) => {
  const found = new Set(activeSymbol ? [activeSymbol] : []);
  const text = ` ${item.title || ''} ${item.summary || ''} `;

  for (const symbol of IDX_UNIVERSE) {
    if (found.size >= 6) break;
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`[^A-Za-z0-9]${escaped}[^A-Za-z0-9]`).test(text)) found.add(symbol);
  }

  return [...found];
};

const scoreNews = (item, activeSymbol) => {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  const matched = EXPANSION_KEYWORDS.filter(keyword => text.includes(keyword));
  const forceActiveSymbol = activeSymbol && String(item.source || '').includes(`Yahoo Finance ${activeSymbol}`);
  return {
    ...item,
    symbols: detectSymbols(item, forceActiveSymbol ? activeSymbol : null),
    expansionSignal: matched.length > 0,
    matchedKeywords: matched.slice(0, 4)
  };
};

export default async req => {
  try {
    const u = new URL(req.url);
    const symbol = cleanSymbol(u.searchParams.get('symbol'));
    const feeds = [...GENERAL_FEEDS];
    if (symbol) {
      feeds.unshift({
        source: `Yahoo Finance ${symbol}`,
        url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(toYahooSymbol(symbol))}&region=US&lang=en-US`
      });
    }

    const batches = await Promise.allSettled(feeds.map(feed => fetchRss(feed.url, feed.source)));
    const news = uniqueByLink(batches.flatMap(batch => batch.status === 'fulfilled' ? batch.value : []))
      .map(item => scoreNews(item, symbol))
      .sort((a, b) => (b.symbols.length > 0) - (a.symbols.length > 0) || Number(b.expansionSignal) - Number(a.expansionSignal))
      .slice(0, 24);

    return json(200, {
      generatedAt: new Date().toISOString(),
      symbol: symbol || null,
      news,
      expansionNews: news.filter(item => item.expansionSignal).slice(0, 8)
    }, { 'Cache-Control': 'public, max-age=300, s-maxage=300' });
  } catch (e) {
    return json(502, { message: e.message || 'News gagal dimuat.' });
  }
};
