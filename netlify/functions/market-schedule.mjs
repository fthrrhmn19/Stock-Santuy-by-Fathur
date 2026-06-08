import { json } from './_shared/http.mjs';
import { idxMarketSchedule } from './_shared/market-calendar.mjs';

export default async () => {
  try {
    const schedule = await idxMarketSchedule();
    return json(200, schedule, { 'Cache-Control': 'public, max-age=15, s-maxage=15' });
  } catch (e) {
    return json(502, { message: e.message || 'Jadwal market gagal dimuat.' });
  }
};
