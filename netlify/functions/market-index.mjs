import { json } from './_shared/http.mjs';
import { yahooChart } from './_shared/yahoo.mjs';
import { idxMarketSchedule } from './_shared/market-calendar.mjs';

export default async () => {
  try {
    const marketSchedule = await idxMarketSchedule();
    const liveOptions = { interval: '5min', outputsize: 180, range: '5d' };
    const dailyOptions = { interval: '1day', outputsize: 180, range: '1y' };
    const preferIntraday = Boolean(marketSchedule.tradingDayOpen);
    let ihsg;
    let chartMode = preferIntraday ? 'live' : 'daily';

    try {
      ihsg = await yahooChart('^JKSE', preferIntraday ? liveOptions : dailyOptions);
    } catch (e) {
      if (!preferIntraday) throw e;
      ihsg = await yahooChart('^JKSE', dailyOptions);
      chartMode = 'daily-fallback';
    }

    const last = ihsg.candles.at(-1);
    const prev = ihsg.candles.at(-2);
    const basis = Number(ihsg.meta?.previousClose) || prev?.close;
    const changePct = basis ? ((last.close - basis) / basis) * 100 : 0;
    const ttl = preferIntraday ? 60 : 300;

    return json(200, {
      generatedAt: new Date().toISOString(),
      symbol: 'IHSG',
      provider: ihsg.provider,
      dataStatus: ihsg.dataStatus,
      chartMode,
      marketSchedule,
      last,
      changePct,
      candles: ihsg.candles,
      meta: ihsg.meta
    }, { 'Cache-Control': `public, max-age=${ttl}, s-maxage=${ttl}` });
  } catch (e) {
    return json(502, { message: e.message || 'Data IHSG gagal dimuat.' });
  }
};
