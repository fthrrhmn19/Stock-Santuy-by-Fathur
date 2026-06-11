const cache = new Map();

const TV_COLUMNS = [
  'description', 'close', 'sector', 'industry', 
  'price_earnings_ttm', 'price_book_ratio', 'earnings_per_share_basic_ttm',
  'return_on_equity', 'return_on_assets', 'total_debt', 'total_revenue', 'net_income',
  'total_shares_outstanding_fundamental', 'cash_n_short_term_invest', 'dividend_yield_recent',
  'enterprise_value_ebitda_ttm', 'price_sales_ratio', 'net_margin', 'free_cash_flow'
];

async function fetchTradingViewFundamentals(symbol) {
  const cleanSymbol = symbol.replace('.JK', '').toUpperCase();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  
  try {
    const res = await fetch('https://scanner.tradingview.com/indonesia/scan', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 StockSantuy/1.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Origin': 'https://www.tradingview.com',
        'Referer': 'https://www.tradingview.com/'
      },
      body: JSON.stringify({
        symbols: { tickers: [`IDX:${cleanSymbol}`] },
        columns: TV_COLUMNS
      })
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `TradingView error ${res.status}`);
    
    const row = data?.data?.[0]?.d;
    if (!row) throw new Error('Data saham tidak ditemukan di TradingView.');
    
    return { symbol: cleanSymbol, row };
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequest(context) {
  const request = context.request;
  const env = context.env;
  globalThis.process = { env: { ...(globalThis.process ? globalThis.process.env : {}), ...env } };
  const url = new URL(request.url);
  const symbolParam = url.searchParams.get('symbol');
  
  if (!symbolParam) {
    return new Response(JSON.stringify({ error: 'Ticker wajib diisi' }), { status: 400 });
  }

  const cleanSymbol = symbolParam.replace('.JK', '').toUpperCase();

  if (cache.has(cleanSymbol)) {
    const cached = cache.get(cleanSymbol);
    if (Date.now() - cached.timestamp < 3600000) { // 1 hour
      return new Response(JSON.stringify(cached.data), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }

  try {
    const { row } = await fetchTradingViewFundamentals(cleanSymbol);
    
    const [
      name, price, sector, industry,
      per, pbv, eps,
      roePct, roaPct, totalDebt, totalRevenue, netIncome,
      sharesOutstanding, totalCash, divYieldPct,
      evEbitda, priceToSales, netMarginPct, freeCashflow
    ] = row;

    const bookValuePerShare = (price && pbv) ? price / pbv : null;
    
    const result = {
      symbol: cleanSymbol,
      name: name || cleanSymbol,
      price: price,
      sector: sector || 'Unknown',
      industry: industry || 'Unknown',
      eps: eps,
      trailingEps: eps,
      forwardEps: null,
      per: per,
      forwardPer: null,
      pbv: pbv,
      bookValuePerShare: bookValuePerShare,
      sharesOutstanding: sharesOutstanding,
      equity: (bookValuePerShare && sharesOutstanding) ? bookValuePerShare * sharesOutstanding : null,
      totalDebt: totalDebt,
      totalCash: totalCash,
      operatingCashflow: null,
      freeCashflow: freeCashflow,
      totalRevenue: totalRevenue,
      netIncome: netIncome,
      revenueGrowth: null,
      earningsGrowth: null,
      roe: roePct ? roePct / 100 : null,
      roa: roaPct ? roaPct / 100 : null,
      netProfitMargin: netMarginPct ? netMarginPct / 100 : null,
      dividendPerShare: (divYieldPct && price) ? (divYieldPct / 100) * price : null,
      dividendPayoutRatio: null,
      evEbitda: evEbitda,
      evSales: null,
      priceToSales: priceToSales,
      lastQuarterDate: null
    };

    cache.set(cleanSymbol, { timestamp: Date.now(), data: result });

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    console.error(`Error fetching valuation data for ${cleanSymbol}:`, err);
    return new Response(JSON.stringify({ error: 'Gagal mengambil data fundamental dari TradingView: ' + err.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
};
