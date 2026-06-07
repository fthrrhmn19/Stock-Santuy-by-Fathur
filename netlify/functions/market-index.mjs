import { json } from './_shared/http.mjs';
import { yahooChart } from './_shared/yahoo.mjs';

export default async () => {
  try {
    const ihsg = await yahooChart('^JKSE', { interval: '1day', outputsize: 180, range: '1y' });
    const last = ihsg.candles.at(-1);
    const prev = ihsg.candles.at(-2);
    const changePct = prev?.close ? ((last.close - prev.close) / prev.close) * 100 : 0;

    return json(200, {
      generatedAt: new Date().toISOString(),
      symbol: 'IHSG',
      provider: ihsg.provider,
      dataStatus: ihsg.dataStatus,
      last,
      changePct,
      candles: ihsg.candles,
      meta: ihsg.meta
    }, { 'Cache-Control': 'public, max-age=300, s-maxage=300' });
  } catch (e) {
    return json(502, { message: e.message || 'Data IHSG gagal dimuat.' });
  }
};
