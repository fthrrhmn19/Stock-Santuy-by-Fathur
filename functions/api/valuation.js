import { toYahooSymbol } from './_shared/yahoo.js';

const UA = 'Mozilla/5.0 StockSantuy/1.0';
const cache = new Map();

async function fetchQuoteSummary(symbol, modules) {
  const url = new URL(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}`);
  url.searchParams.set('modules', modules.join(','));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 14000);
  try {
    const res = await fetch(url.toString(), {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json' }
    });
    const data = await res.json();
    if (!res.ok || data.quoteSummary?.error) {
      throw new Error(data.quoteSummary?.error?.description || `Yahoo Finance error ${res.status}`);
    }
    const result = data.quoteSummary?.result?.[0];
    if (!result) throw new Error('Tidak ada data dari Yahoo Finance.');
    return result;
  } finally {
    clearTimeout(timer);
  }
}

// Yahoo v10 returns nested { raw, fmt } objects — extract raw value
const raw = v => (v && typeof v === 'object' && 'raw' in v) ? v.raw : (typeof v === 'number' ? v : null);

export async function onRequest(context) {
  const request = context.request;
  const env = context.env;
  globalThis.process = { env: { ...(globalThis.process ? globalThis.process.env : {}), ...env } };
  const url = new URL(request.url);
  const symbolParam = url.searchParams.get('symbol');
  if (!symbolParam) {
    return new Response(JSON.stringify({ error: 'Ticker wajib diisi' }), { status: 400 });
  }

  const symbol = toYahooSymbol(symbolParam);

  if (cache.has(symbol)) {
    const cached = cache.get(symbol);
    if (Date.now() - cached.timestamp < 3600000) {
      return new Response(JSON.stringify(cached.data), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }

  try {
    const data = await fetchQuoteSummary(symbol, [
      'financialData', 'defaultKeyStatistics', 'assetProfile', 'summaryDetail'
    ]);

    const fd = data.financialData || {};
    const dks = data.defaultKeyStatistics || {};
    const ap = data.assetProfile || {};
    const sd = data.summaryDetail || {};

    const price = raw(fd.currentPrice) || raw(sd.previousClose);
    if (!price) throw new Error('Data harga tidak ditemukan');

    const bookValue = raw(dks.bookValue);
    const sharesOutstanding = raw(dks.sharesOutstanding);

    const result = {
      symbol: symbol.replace('.JK', ''),
      name: sd.shortName || sd.longName || symbol,
      price: price,
      sector: ap.sector || 'Unknown',
      industry: ap.industry || 'Unknown',
      eps: raw(dks.trailingEps) || raw(fd.revenuePerShare),
      trailingEps: raw(dks.trailingEps),
      forwardEps: raw(dks.forwardEps),
      per: raw(sd.trailingPE),
      forwardPer: raw(sd.forwardPE),
      pbv: raw(dks.priceToBook),
      bookValuePerShare: bookValue,
      sharesOutstanding: sharesOutstanding,
      equity: (bookValue && sharesOutstanding) ? bookValue * sharesOutstanding : null,
      totalDebt: raw(fd.totalDebt),
      totalCash: raw(fd.totalCash),
      operatingCashflow: raw(fd.operatingCashflow),
      freeCashflow: raw(fd.freeCashflow),
      totalRevenue: raw(fd.totalRevenue),
      netIncome: raw(fd.netIncomeToCommon),
      revenueGrowth: raw(fd.revenueGrowth),
      earningsGrowth: raw(fd.earningsGrowth),
      roe: raw(fd.returnOnEquity),
      roa: raw(fd.returnOnAssets),
      netProfitMargin: raw(fd.profitMargins),
      dividendPerShare: raw(sd.trailingAnnualDividendRate) || raw(sd.dividendRate),
      dividendPayoutRatio: raw(sd.payoutRatio),
      evEbitda: raw(dks.enterpriseToEbitda),
      evSales: raw(dks.enterpriseToRevenue),
      priceToSales: raw(sd.priceToSalesTrailing12Months) || raw(dks.priceToSalesTrailing12Months),
      lastQuarterDate: dks.mostRecentQuarter ? new Date(raw(dks.mostRecentQuarter) * 1000).toISOString().split('T')[0] : null
    };

    cache.set(symbol, { timestamp: Date.now(), data: result });

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    console.error(`Error fetching valuation data for ${symbol}:`, err);
    return new Response(JSON.stringify({ error: 'Gagal mengambil data fundamental dari Yahoo Finance: ' + err.message }), { status: 500 });
  }
};
