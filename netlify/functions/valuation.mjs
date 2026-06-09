import YahooFinance from 'yahoo-finance2';
import { toYahooSymbol } from './_shared/yahoo.mjs';

const yahooFinance = new YahooFinance();

const cache = new Map();

export default async (request, context) => {
  const url = new URL(request.url);
  const symbolParam = url.searchParams.get('symbol');
  if (!symbolParam) {
    return new Response(JSON.stringify({ error: 'Ticker wajib diisi' }), { status: 400 });
  }

  const symbol = toYahooSymbol(symbolParam);
  
  if (cache.has(symbol)) {
    const cached = cache.get(symbol);
    if (Date.now() - cached.timestamp < 3600000) { // 1 hour cache
      return new Response(JSON.stringify(cached.data), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }

  try {
    const data = await yahooFinance.quoteSummary(symbol, {
      modules: ['financialData', 'defaultKeyStatistics', 'assetProfile', 'summaryDetail']
    });

    const fd = data.financialData || {};
    const dks = data.defaultKeyStatistics || {};
    const ap = data.assetProfile || {};
    const sd = data.summaryDetail || {};

    const price = fd.currentPrice || sd.previousClose;
    if (!price) throw new Error('Data harga tidak ditemukan');

    const result = {
      symbol: symbol.replace('.JK', ''),
      name: sd.shortName || sd.longName || symbol,
      price: price,
      sector: ap.sector || 'Unknown',
      industry: ap.industry || 'Unknown',
      eps: dks.trailingEps || fd.revenuePerShare, // Fallback EPS if needed, but better keep actual EPS
      trailingEps: dks.trailingEps,
      forwardEps: dks.forwardEps,
      per: sd.trailingPE,
      forwardPer: sd.forwardPE,
      pbv: dks.priceToBook,
      bookValuePerShare: dks.bookValue,
      sharesOutstanding: dks.sharesOutstanding,
      equity: (dks.bookValue && dks.sharesOutstanding) ? dks.bookValue * dks.sharesOutstanding : null,
      totalDebt: fd.totalDebt,
      totalCash: fd.totalCash,
      operatingCashflow: fd.operatingCashflow,
      freeCashflow: fd.freeCashflow,
      totalRevenue: fd.totalRevenue,
      netIncome: fd.netIncomeToCommon,
      revenueGrowth: fd.revenueGrowth,
      earningsGrowth: fd.earningsGrowth,
      roe: fd.returnOnEquity,
      roa: fd.returnOnAssets,
      netProfitMargin: fd.profitMargins,
      dividendPerShare: sd.trailingAnnualDividendRate || sd.dividendRate,
      dividendPayoutRatio: sd.payoutRatio,
      evEbitda: dks.enterpriseToEbitda,
      evSales: dks.enterpriseToRevenue,
      priceToSales: sd.priceToSalesTrailing12Months || dks.priceToSalesTrailing12Months,
      lastQuarterDate: dks.mostRecentQuarter ? new Date(dks.mostRecentQuarter).toISOString().split('T')[0] : null
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
