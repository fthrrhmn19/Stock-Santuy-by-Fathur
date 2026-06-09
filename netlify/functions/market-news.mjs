import { json, cleanSymbol } from './_shared/http.mjs';
import { fetchRss } from './_shared/rss.mjs';
import { toYahooSymbol } from './_shared/yahoo.mjs';
import { IDX_UNIVERSE } from './_shared/idx-universe.mjs';

const GENERAL_FEEDS = [
  { source: 'CNBC Indonesia Market', url: 'https://www.cnbcindonesia.com/market/rss' },
  { source: 'IDXChannel', url: 'https://www.idxchannel.com/rss' },
  { source: 'IDNFinancials', url: 'https://www.idnfinancials.com/rss' },
  { source: 'Bisnis.com Market', url: 'https://market.bisnis.com/rss' },
  { source: 'Kontan Investasi', url: 'https://investasi.kontan.co.id/rss/' }
];

export const EXPANSION_KEYWORDS = [
  'ekspansi', 'capex', 'belanja modal', 'akuisisi', 'pabrik', 'proyek', 'kontrak',
  'laporan keuangan', 'lapkeu', 'laba', 'pendapatan', 'revenue', 'growth', 'rights issue',
  'merger', 'investasi', 'dividen', 'kinerja',
  'corporate action', 'aksi korporasi', 'divestasi', 'joint venture',
  'right issue', 'buyback', 'tender offer', 'ipo anak',
  'pabrik baru', 'pembangunan', 'konstruksi', 'kontrak baru',
  'ekspor', 'pasar baru', 'laba bersih', 'laba naik', 'laba meningkat', 'laba tumbuh',
  'pendapatan naik', 'pendapatan meningkat', 'pendapatan tumbuh',
  'revenue naik', 'revenue meningkat', 'revenue tumbuh',
  'pertumbuhan laba', 'pertumbuhan pendapatan',
  'rekor laba', 'rekor pendapatan', 'cetak laba',
  'akuisisi saham', 'beli saham', 'mengakuisisi',
  'pembangunan pabrik', 'rencana ekspansi', 'rencana investasi',
  'emisi saham', 'stock split', 'bonus saham',
  'kenaikan laba', 'kenaikan pendapatan',
  'margin meningkat', 'margin naik',
  'order baru', 'kontrak kerja', 'kerja sama',
  'tambang baru', 'smelter', 'hilirisasi',
  'listing', 'ipo', 'go public'
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

/**
 * Fetch expansion/corporate news specifically for a single symbol.
 * Used by scan-market to enrich bagger cards with real headlines.
 * Returns { hasExpansionNews, headlines: [{ title, source, link, matchedKeywords }] }
 */
export async function fetchGeneralFeeds() {
  const batches = await Promise.allSettled(
    GENERAL_FEEDS.map(feed => fetchRss(feed.url, feed.source).catch(() => []))
  );
  return uniqueByLink(batches.flatMap(batch => batch.status === 'fulfilled' ? batch.value : []));
}

export async function fetchSymbolExpansionNews(symbol, preFetchedGeneralNews = null) {
  const yahooFeed = { source: `Yahoo Finance ${symbol}`, url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(toYahooSymbol(symbol))}&region=US&lang=en-US` };
  
  const batches = await Promise.allSettled([
    fetchRss(yahooFeed.url, yahooFeed.source).catch(() => [])
  ]);
  const yahooItems = batches[0].status === 'fulfilled' ? batches[0].value : [];
  
  let allItems;
  if (preFetchedGeneralNews) {
    allItems = uniqueByLink([...yahooItems, ...preFetchedGeneralNews]);
  } else {
    const generalItems = await fetchGeneralFeeds();
    allItems = uniqueByLink([...yahooItems, ...generalItems]);
  }

  // Filter news that mention this symbol OR are from the symbol-specific Yahoo feed
  const symbolRegex = new RegExp(`[^A-Za-z0-9]${symbol}[^A-Za-z0-9]`, 'i');
  const relevant = allItems.filter(item => {
    const text = ` ${item.title || ''} ${item.summary || ''} `;
    const isYahooFeed = String(item.source || '').includes(`Yahoo Finance ${symbol}`);
    return isYahooFeed || symbolRegex.test(text);
  });

  // Score for expansion keywords
  const scored = relevant.map(item => {
    const text = `${item.title} ${item.summary}`.toLowerCase();
    const matched = EXPANSION_KEYWORDS.filter(kw => text.includes(kw));
    return { ...item, matchedKeywords: matched, expansionSignal: matched.length > 0 };
  });

  // Prioritize expansion news first, then any relevant news
  const sorted = scored.sort((a, b) =>
    Number(b.expansionSignal) - Number(a.expansionSignal) ||
    b.matchedKeywords.length - a.matchedKeywords.length
  );

  const headlines = sorted.slice(0, 3).map(item => ({
    title: item.title,
    source: item.source,
    link: item.link,
    matchedKeywords: item.matchedKeywords.slice(0, 3),
    expansionSignal: item.expansionSignal
  }));

  return {
    hasExpansionNews: headlines.some(h => h.expansionSignal),
    hasAnyNews: headlines.length > 0,
    headlines
  };
}

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
