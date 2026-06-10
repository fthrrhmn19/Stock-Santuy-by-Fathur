import { json } from './_shared/http.js';
import { idxMarketSchedule } from './_shared/market-calendar.js';

export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  globalThis.process = { env: { ...(globalThis.process ? globalThis.process.env : {}), ...env } };
  try {
    const schedule = await idxMarketSchedule();
    return json(200, schedule, { 'Cache-Control': 'public, max-age=15, s-maxage=15' });
  } catch (e) {
    return json(502, { message: e.message || 'Jadwal market gagal dimuat.' });
  }
};
