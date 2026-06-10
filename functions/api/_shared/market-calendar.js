const HOLIDAY_API = 'https://api-hari-libur.vercel.app/api';
const cache = new Map();

const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const dateTimeFmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

const timeToSeconds = value => {
  const [hour, minute, second = 0] = String(value).split(':').map(Number);
  return hour * 3600 + minute * 60 + second;
};

const secondsToTime = seconds => {
  const hour = Math.floor(seconds / 3600);
  const minute = Math.floor((seconds % 3600) / 60);
  const second = seconds % 60;
  return [hour, minute, second].map(value => String(value).padStart(2, '0')).join(':');
};

const liveRefreshMs = () => {
  const value = Number(process.env.LIVE_REFRESH_MS || process.env.CACHE_TTL_INTRADAY);
  if (!Number.isFinite(value) || value <= 0) return 60_000;
  const ms = value < 1000 ? value * 1000 : value;
  return Math.min(Math.max(Math.floor(ms), 15_000), 300_000);
};

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

function jakartaClockParts(date = new Date()) {
  const iso = dateTimeFmt.format(date).replace(' ', 'T');
  const dateKey = iso.slice(0, 10);
  const seconds = timeToSeconds(iso.slice(11, 19));
  const weekday = weekdayOf(dateKey);
  return {
    iso,
    dateKey,
    weekday,
    dayName: dayNames[weekday],
    seconds
  };
}

export function idxRegularMarketSessions(dateKey = jakartaDateKey()) {
  const weekday = weekdayOf(dateKey);
  const friday = weekday === 5;
  const sessionOneEnd = friday ? '11:30:00' : '12:00:00';
  const sessionTwoStart = friday ? '14:00:00' : '13:30:00';

  return [
    { code: 'preopen', label: 'Pra-pembukaan', start: '08:45:00', end: '08:59:59', open: false },
    { code: 'session-1', label: 'Sesi I', start: '09:00:00', end: sessionOneEnd, open: true },
    { code: 'break', label: 'Istirahat sesi', start: sessionOneEnd, end: sessionTwoStart, open: false },
    { code: 'session-2', label: 'Sesi II', start: sessionTwoStart, end: '15:49:59', open: true },
    { code: 'preclose', label: 'Pra-penutupan', start: '15:50:00', end: '16:01:59', open: false },
    { code: 'postclose', label: 'Pasca-penutupan', start: '16:02:00', end: '16:15:00', open: false }
  ].map(session => ({
    ...session,
    startSeconds: timeToSeconds(session.start),
    endSeconds: timeToSeconds(session.end)
  }));
}

function phaseFor(seconds, sessions) {
  const current = sessions.find(session => seconds >= session.startSeconds && seconds <= session.endSeconds);
  if (current) return current;
  if (seconds < sessions[0].startSeconds) {
    return { code: 'before-open', label: 'Menunggu pra-pembukaan', open: false };
  }
  return { code: 'closed', label: 'Market tutup', open: false };
}

function nextEventFor(seconds, sessions, current) {
  if (current?.open) {
    return {
      type: 'close',
      label: `${current.label} selesai`,
      time: secondsToTime(current.endSeconds)
    };
  }

  const nextOpen = sessions.find(session => session.open && seconds < session.startSeconds);
  if (nextOpen) {
    return {
      type: 'open',
      label: `${nextOpen.label} mulai`,
      time: nextOpen.start
    };
  }

  return {
    type: 'next-day',
    label: 'Menunggu hari bursa berikutnya',
    time: null
  };
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

export async function idxMarketSchedule(date = new Date()) {
  const clock = jakartaClockParts(date);
  const tradingDay = await idxTradingDay(clock.dateKey);
  const sessions = idxRegularMarketSessions(clock.dateKey);
  const phase = tradingDay.open
    ? phaseFor(clock.seconds, sessions)
    : { code: 'closed-day', label: tradingDay.reason, open: false };
  const nextEvent = tradingDay.open
    ? nextEventFor(clock.seconds, sessions, phase)
    : { type: 'closed-day', label: tradingDay.reason, time: null };
  const open = Boolean(tradingDay.open && phase.open);

  return {
    timezone: 'Asia/Jakarta',
    now: clock.iso,
    date: clock.dateKey,
    dayName: clock.dayName,
    tradingDayOpen: tradingDay.open,
    holidayReason: tradingDay.open ? null : tradingDay.reason,
    holidaySource: tradingDay.source || null,
    open,
    refreshActive: open,
    phase: phase.code,
    phaseLabel: phase.label,
    currentSession: phase.start ? {
      code: phase.code,
      label: phase.label,
      start: phase.start,
      end: phase.end,
      open: phase.open
    } : null,
    nextEvent,
    refreshMs: open ? liveRefreshMs() : 60_000,
    sessions: sessions.map(({ startSeconds, endSeconds, ...session }) => session),
    source: 'IDX regular market schedule, Kep-00003/BEI/04-2025'
  };
}
