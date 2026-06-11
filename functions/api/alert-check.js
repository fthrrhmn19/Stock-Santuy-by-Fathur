import { json } from './_shared/http.js';
import { sendEmail, emailConfigured } from './_shared/email.js';
import { yahooChart } from './_shared/yahoo.js';
import { idxMarketSchedule } from './_shared/market-calendar.js';
import { onRequest as scanMarket } from './scan-market.js';
import { analyze } from '../../src/js/analysis.js';

const minScore = () => Number(process.env.ALERT_MIN_SCORE || 78);
const siteUrl = () => process.env.SITE_URL || process.env.URL || 'https://stock-santuy-cloudflare.pages.dev';
const harmonicLookback = session =>
  Number(session.key === 'watch'
    ? (process.env.HARMONIC_ALERT_RECENT_LOOKBACK || 1)
    : (process.env.HARMONIC_ALERT_LOOKBACK || 20));
const watchCooldownMs = () => {
  const hours = Number(process.env.WATCH_HARMONIC_COOLDOWN_HOURS || 4);
  return Math.min(Math.max(Number.isFinite(hours) ? hours : 4, 1), 24) * 60 * 60 * 1000;
};

const SESSIONS = {
  default: {
    key: 'default',
    title: 'Stock Santuy Alert',
    subject: 'Stock Santuy Alert',
    focus: 'Kandidat saham potensial dari scanner terbaru.',
    modes: ['Day Trade', 'Swing Trade', 'Long Term', 'Potential Bagger'],
    pickDelta: 0,
    maxPicks: 12
  },
  morning: {
    key: 'morning',
    title: 'Menu Pagi - Beli Pagi Jual Sore',
    subject: 'Stock Santuy Menu Pagi',
    focus: 'Fokus day trade: kandidat beli pagi, disiplin jual sore, dan cek orderbook sebelum eksekusi.',
    modes: ['Day Trade'],
    pickDelta: -4,
    maxPicks: 10
  },
  midday: {
    key: 'midday',
    title: 'Menu Siang - Update Istirahat Market',
    subject: 'Stock Santuy Menu Siang',
    focus: 'Update jam istirahat market: pantau momentum yang bertahan, volume, dan saham yang mulai masuk area entry.',
    modes: ['Day Trade', 'Swing Trade'],
    pickDelta: -2,
    maxPicks: 12
  },
  afternoon: {
    key: 'afternoon',
    title: 'Menu Sore - Hold/Jual Besok Pagi',
    subject: 'Stock Santuy Menu Sore',
    focus: 'Fokus sore: kandidat swing/overnight yang berpotensi dijual pagi berikutnya jika momentum lanjut.',
    modes: ['Swing Trade', 'Potential Bagger', 'Long Term'],
    pickDelta: -2,
    maxPicks: 12
  },
  watch: {
    key: 'watch',
    title: 'Realtime Harmonic Pattern Watch',
    subject: 'Stock Santuy Harmonic Pattern',
    focus: 'Trigger realtime hanya untuk saham yang baru membentuk harmonic pattern. Sinyal yang sama masuk cooldown agar tidak mengirim berulang.',
    modes: [],
    pickDelta: 0,
    maxPicks: 0
  }
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;'
}[ch]));

const rupiah = value => Number.isFinite(value)
  ? `Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(value)}`
  : '-';
const pct = (a, b) => b ? ((a - b) / b) * 100 : 0;
const round = value => Number.isFinite(value) ? Math.round(value) : 0;
const sessionFor = url => SESSIONS[url.searchParams.get('session')] || SESSIONS.default;
const thresholdFor = session => Math.max(55, minScore() + (session.pickDelta || 0));

const candidatePool = scan => [
  ...(scan.trading || []).map(item => ({ ...item, mode: 'Day Trade' })),
  ...(scan.swing || []).map(item => ({ ...item, mode: 'Swing Trade' })),
  ...(scan.investment || []).map(item => ({ ...item, mode: 'Long Term' })),
  ...(scan.bagger || []).map(item => ({ ...item, mode: 'Potential Bagger' }))
];

const pickCandidates = (scan, session) => {
  const seen = new Set();
  const allowed = new Set(session.modes || SESSIONS.default.modes);
  return candidatePool(scan)
    .filter(item => allowed.has(item.mode))
    .filter(item => item.score >= thresholdFor(session))
    .sort((a, b) => b.score - a.score || Math.abs(b.changePct || 0) - Math.abs(a.changePct || 0))
    .filter(item => {
      const key = `${item.mode}-${item.symbol}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, session.maxPicks || 12);
};

const uniqueSymbols = scan => {
  const symbols = [
    ...(scan.trading || []).slice(0, 8),
    ...(scan.swing || []).slice(0, 10),
    ...(scan.investment || []).slice(0, 6),
    ...(scan.bagger || []).slice(0, 10),
    ...(scan.market?.topGainer || []).slice(0, 8),
    ...(scan.market?.topLoser || []).slice(0, 4),
    ...(scan.market?.topValue || []).slice(0, 6),
    ...(scan.market?.topVolume || []).slice(0, 6)
  ].map(item => item.symbol).filter(Boolean);
  return [...new Set(symbols)].slice(0, 6);
};

const withLimit = async (items, limit, task) => {
  const out = [];
  let index = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (index < items.length) {
      const item = items[index++];
      try {
        const value = await task(item);
        if (Array.isArray(value)) out.push(...value.filter(Boolean));
        else if (value) out.push(value);
      } catch {
        // Skip unavailable symbols or weak signal reads.
      }
    }
  });
  await Promise.all(workers);
  return out;
};

const findHarmonicAlerts = async (scan, session) => {
  const symbols = uniqueSymbols(scan);
  const frames = session.key === 'watch'
    ? [{ interval: '15min', range: '1mo', outputsize: 600, mode: 'day', label: '15m' }]
    : [{ interval: '1day', outputsize: 320, mode: 'swing', label: '1D' }];

  const alerts = await withLimit(symbols, 5, async symbol => {
    const found = [];
    for (const frame of frames) {
      const payload = await yahooChart(symbol, frame);
      const analysis = analyze(payload.candles, { mode: frame.mode });
      const fresh = (analysis.harmonicPatterns || [])
        .filter(pattern => pattern.points?.at(-1)?.index >= payload.candles.length - harmonicLookback(session))
        .sort((a, b) => b.score - a.score);
      if (!fresh.length) continue;
      const pattern = fresh[0];
      found.push({
        symbol,
        name: payload.meta?.name || symbol,
        price: analysis.last.close,
        trend: analysis.trend,
        score: analysis.score,
        pattern: pattern.name,
        bias: pattern.bias,
        date: pattern.date,
        timeframe: frame.label,
        ratios: pattern.ratios
      });
    }
    return found;
  });

  const seen = new Set();
  return alerts
    .sort((a, b) => b.score - a.score)
    .filter(item => {
      const key = `${item.symbol}-${item.timeframe}-${item.pattern}-${item.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
};

const findBaggerAlerts = scan => {
  const threshold = Math.max(70, minScore() - 8);
  return (scan.bagger || [])
    .filter(item => item.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(item => ({
      symbol: item.symbol,
      score: item.score,
      label: item.label,
      price: item.price,
      trend: item.trend,
      validation: item.expansionProxy || 'Validasi lapkeu/news ekspansi'
    }));
};

const findSwingEntryAlerts = async scan => {
  const symbols = [...new Set([
    ...(scan.swing || []).slice(0, 8).map(item => item.symbol),
    ...(scan.market?.topGainer || []).slice(0, 3).map(item => item.symbol),
    ...(scan.market?.volumeSpike || []).slice(0, 3).map(item => item.symbol)
  ].filter(Boolean))].slice(0, 4);

  const alerts = await withLimit(symbols, 4, async symbol => {
    const payload = await yahooChart(symbol, { interval: '1day', outputsize: 320 });
    const analysis = analyze(payload.candles, { mode: 'swing' });
    const setup = analysis.swingSetup;
    const score = analysis.modes.swing.score;
    const gapPct = pct(analysis.last.close, setup.buyOnPullback);
    const nearPullback = Math.abs(gapPct) <= 2;
    const breakoutReady = analysis.breakout && score >= 68;
    if (score < 62 || (!nearPullback && !breakoutReady)) return null;

    return {
      symbol,
      name: payload.meta?.name || symbol,
      score,
      label: analysis.modes.swing.label,
      price: analysis.last.close,
      entry: nearPullback ? setup.buyOnPullback : setup.aggressiveEntry,
      stop: setup.stop,
      target1: setup.target1,
      gapPct,
      trigger: nearPullback ? 'Dekat buy on pullback' : 'Breakout swing aktif'
    };
  });

  return alerts.sort((a, b) => b.score - a.score).slice(0, 8);
};

const signalCache = () => {
  if (!globalThis.__stockSantuySignalCache) globalThis.__stockSantuySignalCache = new Map();
  return globalThis.__stockSantuySignalCache;
};

const cleanupSignalCache = () => {
  const now = Date.now();
  const cache = signalCache();
  for (const [key, expires] of cache.entries()) {
    if (expires <= now) cache.delete(key);
  }
  return cache;
};

const harmonicSignalKey = item => [
  'H',
  item.symbol,
  item.timeframe,
  item.pattern,
  item.bias,
  item.date
].join(':');

const watchSymbolKey = item => ['WATCH_SYMBOL', item.symbol].join(':');

const filterFreshWatchHarmonics = alerts => {
  const now = Date.now();
  const cache = cleanupSignalCache();
  const fresh = [];

  alerts.forEach(item => {
    const harmonicKey = harmonicSignalKey(item);
    const symbolKey = watchSymbolKey(item);
    if (cache.get(harmonicKey) > now || cache.get(symbolKey) > now) return;

    cache.set(harmonicKey, now + watchCooldownMs());
    cache.set(symbolKey, now + watchCooldownMs());
    fresh.push(item);
  });

  return fresh;
};

const signalSignature = ({ session, picks, harmonicAlerts, baggerAlerts, swingEntryAlerts }) => [
  session.key,
  ...picks.map(item => `P:${item.mode}:${item.symbol}:${round(item.score)}`),
  ...harmonicAlerts.map(item => `H:${item.symbol}:${item.timeframe}:${item.pattern}:${item.date}`),
  ...baggerAlerts.map(item => `B:${item.symbol}:${round(item.score)}`),
  ...swingEntryAlerts.map(item => `S:${item.symbol}:${item.trigger}:${round(item.entry)}`)
].join('|');

const shouldSend = payload => {
  if (payload.session.key !== 'watch') return true;
  if (!payload.harmonicAlerts.length && !payload.swingEntryAlerts.length) return false;

  const now = Date.now();
  const cache = cleanupSignalCache();
  const signature = signalSignature(payload);
  if (cache.get(signature) > now) return false;
  cache.set(signature, now + watchCooldownMs());
  return true;
};

const row = cells => `<tr>${cells.map(cell => `<td style="padding:8px;border-top:1px solid #46675f">${cell}</td>`).join('')}</tr>`;

const harmonicTable = harmonicAlerts => `
  <h2 style="margin-top:24px">Harmonic Pattern Baru</h2>
  <table style="width:100%;border-collapse:collapse">
    <thead><tr><th align="left">Saham</th><th align="left">TF</th><th align="left">Pattern</th><th align="left">Bias</th><th align="left">Harga</th></tr></thead>
    <tbody>${harmonicAlerts.map(item => row([
      `<strong>${esc(item.symbol)}</strong>`,
      esc(item.timeframe),
      esc(item.pattern),
      esc(item.bias),
      rupiah(item.price)
    ])).join('')}</tbody>
  </table>
`;

const emailHtml = ({ session, picks, harmonicAlerts, baggerAlerts, swingEntryAlerts }) => {
  const watch = session.key === 'watch';
  return `
    <div style="font-family:Arial,sans-serif;background:#102c27;color:#f3ead5;padding:24px">
      <h1 style="margin-top:0">${esc(session.title)}</h1>
      <p>${esc(session.focus)}</p>
      <p>${watch
        ? `Sinyal realtime: <strong>${harmonicAlerts.length}</strong> harmonic, <strong>${swingEntryAlerts.length}</strong> swing entry dekat harga masuk.`
        : `Kandidat skor: <strong>${picks.length}</strong>, bagger: <strong>${baggerAlerts.length}</strong>.`
      }</p>
    ${picks.length ? `
      <h2 style="margin-top:24px">Kandidat Utama</h2>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th align="left">Mode</th><th align="left">Saham</th><th align="left">Score</th><th align="left">Trend</th><th align="left">Harga</th></tr></thead>
        <tbody>${picks.map(item => row([
          esc(item.mode),
          `<strong>${esc(item.symbol)}</strong>`,
          round(item.score),
          esc(item.trend),
          rupiah(item.price)
        ])).join('')}</tbody>
      </table>
    ` : ''}
    ${swingEntryAlerts.length ? `
      <h2 style="margin-top:24px">Swing Entry Dekat Harga Masuk</h2>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th align="left">Saham</th><th align="left">Trigger</th><th align="left">Entry</th><th align="left">Stop</th><th align="left">TP1</th></tr></thead>
        <tbody>${swingEntryAlerts.map(item => row([
          `<strong>${esc(item.symbol)}</strong>`,
          esc(item.trigger),
          rupiah(item.entry),
          rupiah(item.stop),
          rupiah(item.target1)
        ])).join('')}</tbody>
      </table>
    ` : ''}
    ${harmonicAlerts.length ? harmonicTable(harmonicAlerts) : ''}
    ${baggerAlerts.length ? `
      <h2 style="margin-top:24px">Potential Bagger Watch</h2>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th align="left">Saham</th><th align="left">Label</th><th align="left">Score</th><th align="left">Trend</th><th align="left">Validasi</th></tr></thead>
        <tbody>${baggerAlerts.map(item => row([
          `<strong>${esc(item.symbol)}</strong>`,
          esc(item.label),
          round(item.score),
          esc(item.trend),
          esc(item.validation)
        ])).join('')}</tbody>
      </table>
    ` : ''}
    <p style="margin-top:24px"><a href="${siteUrl()}" style="color:#eadbbd">Buka dashboard</a></p>
    <p style="font-size:12px;color:#d5cbb6">Data gratis dapat delayed. Cek ulang orderbook broker sebelum transaksi. Bukan instruksi transaksi.</p>
  </div>
`;
};

const emailText = ({ session, picks, harmonicAlerts, baggerAlerts, swingEntryAlerts }) => {
  if (session.key === 'watch') {
    return [
      session.title,
      session.focus,
      '',
      `Harmonic pattern baru: ${harmonicAlerts.length}`,
      ...harmonicAlerts.map(item => `${item.symbol}: ${item.timeframe} ${item.bias} ${item.pattern} score ${round(item.score)} harga ${rupiah(item.price)}`),
      '',
      `Swing entry dekat harga masuk: ${swingEntryAlerts.length}`,
      ...swingEntryAlerts.map(item => `${item.symbol}: ${item.trigger}, entry ${rupiah(item.entry)}, stop ${rupiah(item.stop)}, TP1 ${rupiah(item.target1)}`)
    ].join('\n');
  }

  return [
    session.title,
    session.focus,
    '',
    `Kandidat skor: ${picks.length}`,
    ...picks.map(item => `${item.mode}: ${item.symbol} score ${round(item.score)} harga ${rupiah(item.price)}`),
    '',
    `Swing entry: ${swingEntryAlerts.length}`,
    ...swingEntryAlerts.map(item => `${item.symbol}: ${item.trigger}, entry ${rupiah(item.entry)}, stop ${rupiah(item.stop)}, TP1 ${rupiah(item.target1)}`),
    '',
    `Harmonic pattern: ${harmonicAlerts.length}`,
    ...harmonicAlerts.map(item => `${item.symbol}: ${item.timeframe} ${item.bias} ${item.pattern} score ${round(item.score)}`),
    '',
    `Potential bagger: ${baggerAlerts.length}`,
    ...baggerAlerts.map(item => `${item.symbol}: ${item.label} score ${round(item.score)} - ${item.validation}`)
  ].join('\n');
};

export async function onRequest(context) {
  const req = context.request;
  const env = context.env;
  globalThis.process = { env: { ...(globalThis.process ? globalThis.process.env : {}), ...env } };
  try {
    const u = new URL(req.url);
    const session = sessionFor(u);
    const manualSecret = process.env.ALERT_MANUAL_SECRET;
    const forceSend = u.searchParams.get('send') === '1'
      && manualSecret
      && u.searchParams.get('secret') === manualSecret;
    const scheduledRun = req.headers.get('X-CF-Event') === 'schedule';
    const sendRequested = forceSend || scheduledRun || req.method !== 'GET';
    const quickStatus = !sendRequested && session.key === 'default';
    const marketSchedule = await idxMarketSchedule();
    const marketDay = {
      open: marketSchedule.tradingDayOpen,
      date: marketSchedule.date,
      reason: marketSchedule.holidayReason || 'Trading day',
      source: marketSchedule.holidaySource || marketSchedule.source
    };

    if (sendRequested && !marketDay.open) {
      return json(200, {
        generatedAt: new Date().toISOString(),
        emailConfigured: emailConfigured(),
        session: session.key,
        sessionTitle: session.title,
        minScore: thresholdFor(session),
        marketDay,
        skipped: true,
        count: 0,
        harmonicCount: 0,
        baggerCount: 0,
        swingEntryCount: 0,
        picks: [],
        harmonicAlerts: [],
        baggerAlerts: [],
        swingEntryAlerts: [],
        email: {
          ok: false,
          skipped: true,
          message: `Email tidak dikirim karena ${marketDay.date} bukan hari bursa: ${marketDay.reason}.`
        }
      });
    }

    if (sendRequested && session.key === 'watch' && !marketSchedule.refreshActive) {
      return json(200, {
        generatedAt: new Date().toISOString(),
        emailConfigured: emailConfigured(),
        session: session.key,
        sessionTitle: session.title,
        minScore: thresholdFor(session),
        marketDay,
        marketSchedule,
        skipped: true,
        count: 0,
        harmonicCount: 0,
        baggerCount: 0,
        swingEntryCount: 0,
        picks: [],
        harmonicAlerts: [],
        baggerAlerts: [],
        swingEntryAlerts: [],
        email: {
          ok: false,
          skipped: true,
          message: `Watch alert pause karena ${marketSchedule.phaseLabel}.`
        }
      });
    }

    const watchSession = session.key === 'watch';
    const scanLimit = 15;
    const scanIntradayLimit = 5;
    const res = await scanMarket({ request: new Request(`${siteUrl()}/api/scan-market?limit=${scanLimit}&intradayLimit=${scanIntradayLimit}`), env: context.env });
    const scan = await res.json();
    
    let harmonicAlerts = [];
    let swingEntryAlerts = [];
    let picks = [];
    let baggerAlerts = [];

    if (watchSession) {
      harmonicAlerts = await findHarmonicAlerts(scan, session);
      swingEntryAlerts = await findSwingEntryAlerts(scan);
      harmonicAlerts = sendRequested ? filterFreshWatchHarmonics(harmonicAlerts) : harmonicAlerts;
      // swingEntryAlerts could also be filtered if needed, but we rely on realtime trigger
    } else {
      const picksResult = await pickCandidates(scan, session);
      const baggerResult = findBaggerAlerts(scan);
      picks = picksResult || [];
      baggerAlerts = baggerResult || [];
    }

    const payload = { session, picks, harmonicAlerts, baggerAlerts, swingEntryAlerts };
    let email = { ok: false, skipped: true, message: 'Tidak ada email dikirim.' };
    const hasSignal = picks.length || harmonicAlerts.length || baggerAlerts.length || swingEntryAlerts.length;
    const canSend = hasSignal && sendRequested && shouldSend(payload);

    if (canSend) {
      email = await sendEmail({
        subject: watchSession
          ? `${session.subject}: ${harmonicAlerts.length} harmonic, ${swingEntryAlerts.length} swing entry`
          : `${session.subject}: ${picks.length} kandidat`,
        html: emailHtml(payload),
        text: emailText(payload)
      });
    } else if (session.key === 'watch' && hasSignal && sendRequested) {
      email = { ok: false, skipped: true, message: 'Sinyal sama masih dalam cooldown realtime watch.' };
    }

    return json(200, {
      generatedAt: new Date().toISOString(),
      emailConfigured: emailConfigured(),
      session: session.key,
      sessionTitle: session.title,
      minScore: thresholdFor(session),
      marketDay,
      marketSchedule,
      quickStatus,
      count: picks.length,
      harmonicCount: harmonicAlerts.length,
      baggerCount: baggerAlerts.length,
      swingEntryCount: swingEntryAlerts.length,
      picks,
      harmonicAlerts,
      baggerAlerts,
      swingEntryAlerts,
      email
    });
  } catch (e) {
    return json(502, { message: e.message || 'Alert check gagal.' });
  }
};
