const HOLIDAY_API = 'https://api-hari-libur.vercel.app/api';
const cache = new Map();

export function jakartaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function weekdayOf(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function envHolidayMap() {
  const map = new Map();
  String(process.env.IDX_HOLIDAYS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .forEach(value => {
      const [date, ...label] = value.split(':');
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        map.set(date, label.join(':') || 'IDX holiday');
      }
    });
  return map;
}

async function nationalHolidays(year) {
  const cached = cache.get(year);
  if (cached && cached.expires > Date.now()) return cached.data;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4500);
  try {
    const url = new URL(HOLIDAY_API);
    url.searchParams.set('year', year);
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Holiday API ${res.status}`);
    const data = await res.json();
    const holidays = new Map((data.data || []).map(item => [item.date, item.description || 'Hari libur']));
    cache.set(year, { data: holidays, expires: Date.now() + 12 * 60 * 60 * 1000 });
    return holidays;
  } finally {
    clearTimeout(timer);
  }
}

export async function idxTradingDay(dateKey = jakartaDateKey()) {
  const weekday = weekdayOf(dateKey);
  if (weekday === 0 || weekday === 6) {
    return { open: false, date: dateKey, reason: 'Weekend' };
  }

  const manual = envHolidayMap();
  if (manual.has(dateKey)) {
    return { open: false, date: dateKey, reason: manual.get(dateKey), source: 'IDX_HOLIDAYS' };
  }

  try {
    const holidays = await nationalHolidays(dateKey.slice(0, 4));
    if (holidays.has(dateKey)) {
      return { open: false, date: dateKey, reason: holidays.get(dateKey), source: 'api-hari-libur' };
    }
  } catch {
    // If the holiday API is unavailable, fall back to weekend + manual IDX_HOLIDAYS.
  }

  return { open: true, date: dateKey, reason: 'Trading day' };
}
