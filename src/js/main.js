import { createChart, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import { api } from './api.js';
import { analyze } from './analysis.js';
import { calculateValuationScenarios } from './valuation.js';

const $ = id => document.getElementById(id);
let current = null;
let currentSymbol = null;
let currentDailyPayload = null;
let currentDailyAnalysis = null;
let currentIntradayPayload = null;
let currentIntradayAnalysis = null;
let chart = null;
let indexChart = null;
let lastScan = null;
let activeMode = 'day';
let chartRange = 'live';
let chartLoadToken = 0;
let marketIsOpen = false;
let marketRefreshActive = false;
let marketSchedule = null;
let marketScheduleLoadedAt = 0;
let autoRefreshEnabled = true;
let autoRefreshBusy = false;
let autoRefreshMs = 60_000;
let nextAutoRefreshAt = Date.now() + 60_000;

const DEFAULT_AUTO_REFRESH_MS = 60_000;
const MARKET_SCHEDULE_MAX_AGE_MS = 90_000;

const rupiah = n => Number.isFinite(n)
  ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)
  : '-';
const num = (n, digits = 2) => Number.isFinite(n)
  ? new Intl.NumberFormat('id-ID', { maximumFractionDigits: digits }).format(n)
  : '-';
const compact = n => {
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  const units = [
    { value: 1e12, suffix: 'T' },
    { value: 1e9, suffix: 'B' },
    { value: 1e6, suffix: 'M' },
    { value: 1e3, suffix: 'K' }
  ];
  const unit = units.find(item => abs >= item.value);
  return unit ? `${num(n / unit.value, 2)}${unit.suffix}` : num(n, 0);
};
const compactRp = n => Number.isFinite(n) ? `Rp ${compact(n)}` : '-';
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;'
}[ch]));
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const setText = (id, value) => { $(id).textContent = value; };
const statusClass = score => score >= 82 ? 'good' : score >= 68 ? 'warn' : score >= 55 ? 'neutral' : 'bad';
const signalClass = value => value >= 0 ? 'good' : 'bad';
const valuationView = analysis => {
  const gap = analysis?.fairGapPct;
  const fairValue = analysis?.fairValue;
  const price = analysis?.last?.close;
  if (!Number.isFinite(gap) || !Number.isFinite(fairValue) || !Number.isFinite(price) || price <= 0) {
    return {
      badge: 'Valuasi belum dihitung',
      status: '-',
      note: 'Menunggu data fair value.',
      className: 'warn'
    };
  }

  const upsidePct = ((fairValue - price) / price) * 100;
  if (gap <= -20) {
    return {
      badge: 'Deep undervalue',
      status: 'Deep undervalue',
      note: `Harga jauh di bawah fair value proxy. Ruang ke fair value sekitar +${num(upsidePct, 2)}%; tetap tunggu konfirmasi trend dan volume.`,
      className: analysis.trend === 'Downtrend' ? 'warn' : 'good'
    };
  }
  if (gap <= -8) {
    return {
      badge: analysis.trend === 'Downtrend' ? 'Undervalue, tunggu konfirmasi' : 'Undervalue - rebound watch',
      status: 'Undervalue',
      note: `Harga masih di bawah fair value proxy. Potensi mean reversion sekitar +${num(upsidePct, 2)}% jika buyer masuk dan struktur harga membaik.`,
      className: analysis.trend === 'Downtrend' ? 'warn' : 'good'
    };
  }
  if (gap <= -3) {
    return {
      badge: 'Sedikit di bawah fair value',
      status: 'Diskon tipis',
      note: `Masih ada ruang kecil ke fair value sekitar +${num(upsidePct, 2)}%. Konfirmasi tetap lebih penting daripada mengejar harga.`,
      className: 'warn'
    };
  }
  if (gap <= 5) {
    return {
      badge: 'Dekat fair value',
      status: 'Fair',
      note: 'Harga sudah dekat fair value proxy, jadi margin of safety teknikal tidak besar.',
      className: 'neutral'
    };
  }
  return {
    badge: 'Di atas fair value',
    status: 'Over fair value',
    note: `Harga berada +${num(gap, 2)}% di atas fair value proxy. Risiko valuasi lebih tinggi bila momentum melemah.`,
    className: 'bad'
  };
};

const marketTimeSeconds = value => {
  const [hour, minute, second = 0] = String(value).split(':').map(Number);
  return hour * 3600 + minute * 60 + second;
};

function jakartaParts(date = new Date()) {
  const dateKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const hour = Number(parts.hour) % 24;

  return {
    dateKey,
    weekday: parts.weekday,
    seconds: hour * 3600 + Number(parts.minute) * 60 + Number(parts.second)
  };
}

function regularMarketSessions(weekday) {
  const friday = weekday === 'Fri';
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
    startSeconds: marketTimeSeconds(session.start),
    endSeconds: marketTimeSeconds(session.end)
  }));
}

function localMarketSchedule(date = new Date()) {
  const parts = jakartaParts(date);
  const weekdayOpen = !['Sat', 'Sun'].includes(parts.weekday);
  const sessions = regularMarketSessions(parts.weekday);
  const current = sessions.find(session => parts.seconds >= session.startSeconds && parts.seconds <= session.endSeconds);
  const beforeOpen = parts.seconds < sessions[0].startSeconds;
  const nextOpen = sessions.find(session => session.open && parts.seconds < session.startSeconds);

  return {
    date: parts.dateKey,
    tradingDayOpen: weekdayOpen,
    open: Boolean(weekdayOpen && current?.open),
    refreshActive: Boolean(weekdayOpen && current?.open),
    phase: weekdayOpen ? (current?.code || (beforeOpen ? 'before-open' : 'closed')) : 'closed-day',
    phaseLabel: weekdayOpen ? (current?.label || (beforeOpen ? 'Menunggu pra-pembukaan' : 'Market tutup')) : 'Weekend',
    currentSession: current || null,
    nextEvent: current?.open
      ? { type: 'close', label: `${current.label} selesai`, time: current.end }
      : nextOpen
        ? { type: 'open', label: `${nextOpen.label} mulai`, time: nextOpen.start }
        : { type: 'next-day', label: 'Menunggu hari bursa berikutnya', time: null },
    refreshMs: autoRefreshMs || DEFAULT_AUTO_REFRESH_MS,
    source: 'Jadwal lokal IDX'
  };
}

function currentMarketSchedule() {
  const local = localMarketSchedule();
  const freshServerSchedule = marketSchedule
    && Date.now() - marketScheduleLoadedAt < MARKET_SCHEDULE_MAX_AGE_MS
    && marketSchedule.date === local.date;

  if (!freshServerSchedule) return local;

  if (!marketSchedule.tradingDayOpen) {
    return {
      ...local,
      tradingDayOpen: false,
      open: false,
      refreshActive: false,
      phase: 'closed-day',
      phaseLabel: marketSchedule.holidayReason || 'Hari libur bursa',
      holidayReason: marketSchedule.holidayReason,
      holidaySource: marketSchedule.holidaySource,
      source: marketSchedule.source
    };
  }

  return {
    ...local,
    source: marketSchedule.source,
    refreshMs: marketSchedule.refreshMs || local.refreshMs
  };
}

function marketClockText(schedule) {
  const seconds = Math.round((schedule.refreshMs || DEFAULT_AUTO_REFRESH_MS) / 1000);

  if (!schedule.tradingDayOpen) {
    return `IDX tutup ${schedule.date}: ${schedule.phaseLabel}. Auto refresh tetap cek data delayed tiap ${seconds} detik.`;
  }

  if (schedule.open) {
    return `IDX ${schedule.phaseLabel} berjalan. Chart live refresh tiap ${seconds} detik.`;
  }

  const next = schedule.nextEvent?.time ? ` Berikutnya ${schedule.nextEvent.label} ${schedule.nextEvent.time} WIB.` : '';
  return `${schedule.phaseLabel}. Chart live tetap dicek tiap ${seconds} detik.${next}`;
}

function clock() {
  const now = new Date();
  setText('clock', new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(now));

  const schedule = currentMarketSchedule();
  marketIsOpen = Boolean(schedule.open);
  marketRefreshActive = Boolean(schedule.refreshActive);
  autoRefreshMs = schedule.refreshMs || DEFAULT_AUTO_REFRESH_MS;
  setText('marketClock', marketClockText(schedule));
  updateAutoRefreshStatus();
}

setInterval(clock, 1000);
clock();

async function initAuth() {
  try {
    const s = await api.session();
    if (s.authRequired && !s.authenticated) {
      $('loginOverlay').classList.remove('hidden');
      $('loginOverlay').setAttribute('aria-hidden', 'false');
    }
    if (s.authRequired && s.authenticated) $('logoutBtn').classList.remove('hidden');
  } catch {
    // Auth errors should not block the UI shell.
  }
}

async function checkStatus() {
  try {
    const s = await api.status();
    $('providerBadge').textContent = s.configured ? `${s.provider} aktif` : 'API belum disetel';
    $('providerBadge').className = `status ${s.configured ? 'good' : 'bad'}`;
  } catch {
    $('providerBadge').textContent = 'API tidak terhubung';
    $('providerBadge').className = 'status bad';
  }
}

async function loadMarketSchedule() {
  try {
    marketSchedule = await api.schedule();
    marketScheduleLoadedAt = Date.now();
    const schedule = currentMarketSchedule();
    marketIsOpen = Boolean(schedule.open);
    marketRefreshActive = Boolean(schedule.refreshActive);
    autoRefreshMs = schedule.refreshMs || DEFAULT_AUTO_REFRESH_MS;
    setText('marketClock', marketClockText(schedule));
    updateAutoRefreshStatus();
    return schedule;
  } catch {
    const schedule = currentMarketSchedule();
    marketIsOpen = Boolean(schedule.open);
    marketRefreshActive = Boolean(schedule.refreshActive);
    updateAutoRefreshStatus();
    return schedule;
  }
}

function showError(message) {
  $('errorBox').textContent = message;
  $('errorBox').classList.remove('hidden');
}

function clearError() {
  $('errorBox').classList.add('hidden');
  $('errorBox').textContent = '';
}

function updateAutoRefreshStatus(message) {
  const el = $('autoRefreshStatus');
  if (!el) return;

  if (message) {
    el.textContent = message;
    return;
  }

  if (!autoRefreshEnabled) {
    el.textContent = 'Auto refresh OFF';
    el.className = 'status neutral';
    return;
  }

  if (autoRefreshBusy) {
    el.textContent = 'Auto refresh berjalan...';
    el.className = 'status good';
    return;
  }

  const seconds = Math.max(0, Math.ceil((nextAutoRefreshAt - Date.now()) / 1000));
  const schedule = currentMarketSchedule();
  el.textContent = marketRefreshActive
    ? `Auto refresh ${seconds} detik`
    : `Auto refresh ${seconds} detik - ${schedule.phaseLabel.toLowerCase()}`;
  el.className = `status ${marketRefreshActive ? 'good' : 'warn'}`;
}

function scheduleAutoRefresh(delay = autoRefreshMs || DEFAULT_AUTO_REFRESH_MS) {
  nextAutoRefreshAt = Date.now() + delay;
  updateAutoRefreshStatus();
}

async function refreshCurrentAnalysis() {
  if (!currentSymbol) return;
  const symbol = currentSymbol;
  const priorRange = chartRange;
  const canRenderFromRefreshPayload = priorRange === 'live' || priorRange === '1d';
  const [dailyPayload, intradayPayload, fundamentals] = await Promise.all([
    api.series(symbol, '1day', 5000, '20y'),
    api.series(symbol, '5min', 180).catch(() => null),
    api.fundamentals(symbol).catch(() => null)
  ]);
  if (symbol !== currentSymbol) return;

  const dailyAnalysis = analyze(dailyPayload.candles, { mode: 'swing' });
  let intradayAnalysis = null;
  if (intradayPayload?.candles?.length >= 30) {
    intradayAnalysis = analyze(intradayPayload.candles, { mode: 'day' });
  }
  renderAnalysis(symbol, dailyPayload, dailyAnalysis, intradayAnalysis, fundamentals, {
    skipNews: true,
    intradayPayload,
    preserveChartRange: canRenderFromRefreshPayload
  });
  if (!canRenderFromRefreshPayload && priorRange !== chartRange) await loadChartRange(priorRange);
}

async function autoRefreshNow(reason = 'auto') {
  if (!autoRefreshEnabled || autoRefreshBusy) return;
  await loadMarketSchedule();

  autoRefreshBusy = true;
  updateAutoRefreshStatus();
  try {
    await Promise.all([
      checkStatus(),
      loadScanner({ silent: true }),
      loadIHSG(),
      refreshCurrentAnalysis()
    ]);
    const stamp = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(new Date());
    $('autoRefreshStatus').className = 'status good';
    updateAutoRefreshStatus(`Terakhir refresh ${stamp}`);
  } catch (err) {
    $('autoRefreshStatus').className = 'status bad';
    updateAutoRefreshStatus(err.message || 'Auto refresh gagal');
  } finally {
    autoRefreshBusy = false;
    scheduleAutoRefresh();
  }
}

setInterval(() => {
  if (autoRefreshEnabled && Date.now() >= nextAutoRefreshAt) autoRefreshNow();
  else updateAutoRefreshStatus();
}, 1000);

function stockCard(item, kind) {
  const labelClass = statusClass(item.score);
  let validasiHtml = '';
  if (kind === 'bagger') {
    const hasNews = item.expansionNews?.length > 0;
    const validated = item.expansionValidated;
    const badgeClass = validated ? 'expansion-validated' : hasNews ? 'expansion-news' : 'expansion-pending';
    const badgeIcon = validated ? '✓' : hasNews ? '📰' : '⏳';
    const badgeLabel = validated ? 'Katalis ditemukan' : hasNews ? 'Ada berita' : 'Belum ada berita';
    const proxyText = esc(item.expansionProxy || 'Menunggu data...');
    const headlineLinks = (item.expansionNews || []).slice(0, 2).map(h =>
      `<a class="expansion-headline" href="${esc(h.link)}" target="_blank" rel="noopener noreferrer" title="${esc(h.source)}">${esc((h.title || '').slice(0, 80))}${(h.title || '').length > 80 ? '...' : ''}</a>`
    ).join('');
    validasiHtml = `
      <div class="row expansion-row" title="Validasi ganda: mendeteksi otomatis berita aksi korporasi (ekspansi/laba) dan mengonfirmasi fase tren teknikal (Stage Analysis)."><dt>Validasi</dt><dd>
        <span class="expansion-badge ${badgeClass}">${badgeIcon} ${badgeLabel}</span>
      </dd></div>
      <div class="expansion-detail">
        ${headlineLinks || `<span class="muted" title="Stage 1: Akumulasi di bawah | Stage 2: Uptrend (Paling ideal) | Stage 3: Distribusi di pucuk | Stage 4: Downtrend (Hindari)">${proxyText}</span>`}
      </div>
    `;
  }
  return `
    <article class="panel stock-card">
      <div class="stock-card-head">
        <h3 title="Kode Saham">${esc(item.symbol)}</h3>
        <span class="status ${labelClass}" title="Status kelayakan saham ini berdasarkan perpaduan indikator teknikal">${esc(item.label)}</span>
      </div>
      <dl>
        <div class="row" title="Skor teknikal gabungan dari 0-100 (makin tinggi makin ideal)"><dt>Score</dt><dd>${num(item.score, 0)}</dd></div>
        <div class="row" title="Tren pergerakan harga saat ini berdasarkan pola EMA (Uptrend/Downtrend/Sideways)"><dt>Trend</dt><dd>${esc(item.trend)}</dd></div>
        <div class="row" title="Relative Strength Index: Momentum harga, di atas 50 berarti uptrend, di atas 70 overbought (jenuh beli)"><dt>RSI</dt><dd>${num(item.rsi, 2)}</dd></div>
        <div class="row"><dt>Harga</dt><dd>${rupiah(item.price)}</dd></div>
        <div class="row" title="Kondisi volume transaksi saat ini dibandingkan rata-rata (Volume Spike = lonjakan besar)"><dt>Volume</dt><dd>${esc(item.statusVolume)}</dd></div>
        ${validasiHtml}
      </dl>
      <div class="stock-card-actions">
        <button class="primary" type="button" data-analyze="${esc(item.symbol)}" data-kind="${kind}">Analisa</button>
      </div>
    </article>
  `;
}

function wireAnalyzeButtons(root = document) {
  root.querySelectorAll('[data-analyze]').forEach(button => {
    button.onclick = () => run(button.dataset.analyze);
  });
  root.querySelectorAll('[data-news-symbol]').forEach(button => {
    button.onclick = () => {
      const symbol = button.dataset.newsSymbol;
      loadNews(symbol);
      document.getElementById('newsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
}

function renderTickerList(id, items = []) {
  $(id).innerHTML = items.length ? items.map(item => `
    <button type="button" data-analyze="${esc(item.symbol)}">
      ${esc(item.symbol)} ${item.changePct >= 0 ? '+' : ''}${num(item.changePct, 2)}%
    </button>
  `).join('') : '<span class="muted">Belum ada kandidat.</span>';
  wireAnalyzeButtons($(id));
}

function renderMoverList(id, items = [], type = 'change') {
  const shown = items.slice(0, 7);
  const primary = item => {
    if (type === 'value') return `Rp ${compact(item.value)}`;
    if (type === 'volume') return `${compact(item.lot || item.volume / 100)} lot`;
    return `${item.changePct >= 0 ? '+' : ''}${num(item.changePct, 2)}%`;
  };
  const secondary = item => {
    if (type === 'value') return `${compact(item.lot || item.volume / 100)} lot`;
    if (type === 'volume') return `Rp ${compact(item.value)}`;
    return rupiah(item.price);
  };

  $(id).innerHTML = shown.length ? shown.map(item => `
    <button type="button" data-analyze="${esc(item.symbol)}" class="${item.changePct >= 0 ? 'up' : 'down'}">
      <span>
        <strong>${esc(item.symbol)}</strong>
        <small>${esc(item.name || item.symbol)}</small>
      </span>
      <span>
        <strong>${primary(item)}</strong>
        <small>${secondary(item)}</small>
      </span>
    </button>
  `).join('') : '<span class="muted">Belum ada data mover.</span>';
  wireAnalyzeButtons($(id));
}

async function loadScanner(options = {}) {
  const silent = Boolean(options.silent);
  if (!silent) {
    $('scannerLoading').classList.remove('hidden');
    clearError();
  }
  try {
    const data = await api.scan();
    lastScan = data;
    $('tradingGrid').innerHTML = data.trading.map(item => stockCard(item, 'trading')).join('');
    $('investmentGrid').innerHTML = data.investment.map(item => stockCard(item, 'investment')).join('');
    $('baggerGrid').innerHTML = (data.bagger || []).map(item => stockCard(item, 'bagger')).join('');
    setText('marketMoverSource', data.market.marketMoverSource || 'Market mover dihitung dari scanner.');
    renderMoverList('gainerList', data.market.topGainer, 'change');
    renderMoverList('loserList', data.market.topLoser, 'change');
    renderMoverList('valueList', data.market.topValue, 'value');
    renderMoverList('topVolumeList', data.market.topVolume, 'volume');
    wireAnalyzeButtons();
  } catch (err) {
    if (!silent) showError(err.message || 'Scanner gagal dimuat.');
    else throw err;
  } finally {
    if (!silent) $('scannerLoading').classList.add('hidden');
  }
}

function setMode(mode) {
  activeMode = mode;
  document.querySelectorAll('[data-mode-tab]').forEach(button => {
    button.classList.toggle('active', button.dataset.modeTab === mode);
  });
  if (current) renderModePanel(current);
}

function modeCopy(mode, a) {
  const map = {
    day: {
      kicker: 'Day Trade',
      title: 'Momentum cepat intraday',
      description: `Entry ideal dekat ${rupiah((a.daySetup || {}).buyOnWeakness)} atau breakout ${rupiah((a.daySetup || {}).breakoutEntry)}. Cut loss ${rupiah((a.daySetup || {}).stop)}.`,
      score: a.modes.day,
      reasons: a.modes.day.reasons
    },
    swing: {
      kicker: 'Swing Trade',
      title: 'Setup beberapa hari sampai minggu',
      description: `Pullback ideal ${rupiah(a.swingSetup.buyOnPullback)}, entry agresif ${rupiah(a.swingSetup.aggressiveEntry)}, stop ${rupiah(a.swingSetup.stop)}.`,
      score: a.modes.swing,
      reasons: a.modes.swing.reasons
    },
    long: {
      kicker: 'Long Term',
      title: 'Akumulasi bertahap berbasis trend panjang',
      description: `Skor panjang membaca EMA 50/200, stabilitas, likuiditas, dan risiko volatilitas. Fair value proxy ${rupiah(a.fairValue)}.`,
      score: a.modes.long,
      reasons: a.modes.long.reasons
    },
    bagger: {
      kicker: 'Potential Bagger',
      title: 'Kandidat multi-bagger perlu validasi lapkeu',
      description: `Zona akumulasi proxy ${rupiah(a.baggerSetup.accumulationZone)}. Konfirmasi di atas ${rupiah(a.baggerSetup.confirmationLevel)}.`,
      score: a.modes.bagger,
      reasons: a.modes.bagger.reasons
    }
  };
  return map[mode] || map.day;
}

function renderModePanel(a) {
  const mode = modeCopy(activeMode, a);
  setText('modeKicker', mode.kicker);
  setText('modeTitle', mode.title);
  setText('modeDescription', mode.description);
  setText('modeScore', `${mode.score.score}/100`);
  $('modeScore').className = statusClass(mode.score.score);
  $('modeReasons').innerHTML = mode.reasons.map(reason => `<p>${esc(reason)}</p>`).join('');
}

function drawDailyImage(data) {
  const canvas = $('dailyCanvas');
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const today = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta'
  }).format(new Date());
  const pools = [
    ...(data?.trading || []).map(item => ({ ...item, ideaMode: 'Day Trade' })),
    ...(data?.swing || []).map(item => ({ ...item, ideaMode: 'Swing' })),
    ...(data?.bagger || []).map(item => ({ ...item, ideaMode: 'Bagger' })),
    ...(data?.investment || []).map(item => ({ ...item, ideaMode: 'Long Term' }))
  ];
  const picks = pools
    .sort((a, b) => b.score - a.score || (b.rvol || 0) - (a.rvol || 0) || Math.abs(b.changePct || 0) - Math.abs(a.changePct || 0))
    .filter((item, index, arr) => arr.findIndex(x => x.symbol === item.symbol) === index)
    .slice(0, 9);

  const fmtPrice = value => Number.isFinite(value) ? new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(value) : '-';
  const pctText = value => `${value >= 0 ? '+' : ''}${num(value, 2)}%`;
  const ink = '#e8f2ff';
  const inkSoft = 'rgba(226,242,255,.76)';
  const inkFaint = 'rgba(226,242,255,.52)';
  const gain = '#4ade80';
  const loss = '#fb7185';
  const roundRect = (x, y, width, height, radius, fill, stroke) => {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  };
  const label = (value, x, y, options = {}) => {
    ctx.save();
    ctx.fillStyle = options.color || ink;
    ctx.font = options.font || '800 18px Arial';
    ctx.textAlign = options.align || 'left';
    ctx.fillText(value, x, y);
    ctx.restore();
  };
  const fitLabel = (value, x, y, maxWidth, font, color = ink) => {
    ctx.save();
    const parts = String(font).match(/^(.*?)(\d+)px(.*)$/);
    const prefix = parts?.[1] || '';
    const suffix = parts?.[3] || ' Arial';
    let size = Number(parts?.[2] || 18);
    ctx.font = font;
    while (ctx.measureText(value).width > maxWidth && size > 12) {
      size -= 1;
      ctx.font = `${prefix}${size}px${suffix}`;
    }
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
    ctx.restore();
  };
  const badge = (text, x, y, color = '#1d4ed8', fg = ink, size = 14) => {
    ctx.font = `900 ${size}px Arial`;
    const width = ctx.measureText(text).width + 20;
    ctx.fillStyle = color;
    roundRect(x, y - 20, width, 26, 13, true, false);
    ctx.fillStyle = fg;
    ctx.fillText(text, x + 10, y - 3);
    return x + width + 8;
  };
  const metricRow = (name, value, x, y, width, color = ink) => {
    label(name, x, y, { color: inkSoft, font: '900 16px Arial' });
    label(value, x + width, y, { align: 'right', color, font: '900 20px Arial' });
  };
  const drawSetup = (item, x, y, width) => {
    const price = item.price || 0;
    const support = item.support && item.support > 0 ? item.support : price * 0.96;
    const resistance = item.resistance && item.resistance > 0 ? item.resistance : price * 1.05;
    const isDay = item.ideaMode === 'Day Trade';
    const entry = isDay ? price : Math.max(support, price * 0.96);
    const target1 = isDay ? price * 1.03 : Math.max(resistance, price * 1.05);
    const target2 = isDay ? price * 1.05 : price * 1.12;
    const stop = isDay ? price * 0.98 : support * 0.98;

    ctx.fillStyle = 'rgba(8,30,55,.84)';
    roundRect(x, y, width, 122, 14, true, false);
    metricRow('Entry', `Rp ${fmtPrice(entry)}`, x + 16, y + 32, width - 32);
    metricRow('TP1', `Rp ${fmtPrice(target1)}`, x + 16, y + 60, width - 32, gain);
    metricRow('TP2', `Rp ${fmtPrice(target2)}`, x + 16, y + 88, width - 32, gain);
    metricRow('SL', `Rp ${fmtPrice(stop)}`, x + 16, y + 116, width - 32, loss);
  };
  const drawCard = (item, x, y, index) => {
    const width = 340;
    const height = 330;
    ctx.fillStyle = '#163b63';
    ctx.strokeStyle = index < 3 ? 'rgba(96,165,250,.54)' : 'rgba(125,211,252,.34)';
    ctx.lineWidth = 2;
    roundRect(x, y, width, height, 18, true, true);

    label(String(index + 1).padStart(2, '0'), x + 18, y + 34, { color: inkFaint, font: '900 18px Arial' });
    fitLabel(item.symbol, x + 58, y + 44, 168, '900 32px Arial', ink);
    badge(`Score ${Math.round(item.score)}`, x + width - 114, y + 40, '#1e40af', ink, 14);
    badge(item.ideaMode || 'Watch', x + 18, y + 78, '#2563eb', ink, 14);

    let bx = x + 18;
    bx = badge(`Rp ${fmtPrice(item.price)}`, bx, y + 112, '#1e5f9f', ink, 14);
    bx = badge(item.trend || 'trend', bx, y + 112, '#2b6ea6', ink, 14);
    badge(`RSI ${num(item.rsi, 0)}`, bx, y + 112, '#2b6ea6', ink, 14);

    ctx.strokeStyle = 'rgba(226,242,255,.16)';
    ctx.beginPath();
    ctx.moveTo(x + 18, y + 132);
    ctx.lineTo(x + width - 18, y + 132);
    ctx.stroke();

    label((item.changePct || 0) >= 0 ? 'Momentum' : 'Pullback', x + 18, y + 162, { color: inkSoft, font: '900 15px Arial' });
    label(pctText(item.changePct || 0), x + width - 18, y + 162, {
      align: 'right',
      color: (item.changePct || 0) >= 0 ? gain : loss,
      font: '900 22px Arial'
    });
    fitLabel(`Vol ${num(item.rvol || 1, 1)}x - ${item.statusVolume || 'Normal Volume'}`, x + 18, y + 190, width - 36, '800 15px Arial', inkSoft);
    drawSetup(item, x + 18, y + 210, width - 36);
  };

  ctx.fillStyle = '#071b33';
  ctx.fillRect(0, 0, w, h);
  const grad = ctx.createRadialGradient(w / 2, 0, 80, w / 2, 0, 900);
  grad.addColorStop(0, 'rgba(96,165,250,.24)');
  grad.addColorStop(1, 'rgba(96,165,250,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(226,242,255,.055)';
  for (let y = 0; y < h; y += 34) {
    for (let x = 0; x < w; x += 34) ctx.fillRect(x, y, 2, 2);
  }

  ctx.fillStyle = ink;
  ctx.font = '900 64px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Stock Santuy Daily Picks', w / 2, 92);
  ctx.font = '800 21px Arial';
  const dateWidth = ctx.measureText(today).width + 42;
  ctx.fillStyle = '#123f68';
  ctx.strokeStyle = 'rgba(226,242,255,.28)';
  roundRect(w / 2 - dateWidth / 2, 122, dateWidth, 42, 22, true, true);
  ctx.fillStyle = ink;
  ctx.fillText(today, w / 2, 150);
  ctx.textAlign = 'left';
  label('9 rekomendasi teratas dari scanner otomatis. Watchlist awal, bukan instruksi transaksi.', 90, 198, {
    color: 'rgba(226,242,255,.82)',
    font: '800 21px Arial'
  });

  picks.forEach((item, index) => {
    const col = index % 3;
    const rowIndex = Math.floor(index / 3);
    drawCard(item, 70 + col * 380, 230 + rowIndex * 348, index);
  });

  ctx.strokeStyle = 'rgba(226,242,255,.14)';
  ctx.beginPath();
  ctx.moveTo(72, 1302);
  ctx.lineTo(w - 72, 1302);
  ctx.stroke();
  ctx.fillStyle = 'rgba(226,242,255,.66)';
  ctx.font = '900 25px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Reminder: trading berisiko. Gunakan risk management, cek orderbook, dan validasi news/lapkeu.', w / 2, 1352);
  ctx.fillText('Generated by Stock Santuy Analysis - Do Your Own Research.', w / 2, 1402);
  ctx.textAlign = 'left';

  const src = canvas.toDataURL('image/png');
  $('dailyImage').src = src;
  $('dailyImagePanel').classList.remove('hidden');
  $('dailyImagePanel').setAttribute('aria-hidden', 'false');
}

async function generateDailyImage() {
  if (!lastScan) await loadScanner();
  if (lastScan) drawDailyImage(lastScan);
}

function renderNewsItems(targetId, items) {
  $(targetId).innerHTML = items.length ? items.map(item => `
    <article>
      <div class="news-symbols">
        ${(item.symbols || []).length ? item.symbols.map(symbol => `<b>${esc(symbol)}</b>`).join('') : '<b>MARKET</b>'}
      </div>
      <span>${esc(item.source)}${item.expansionSignal && item.matchedKeywords?.length ? ' - ' + item.matchedKeywords.join(', ').toUpperCase() : ''}</span>
      <a href="${esc(item.link)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>
      <p>${esc(item.summary || '').slice(0, 150)}</p>
    </article>
  `).join('') : '<p class="muted">Belum ada data news.</p>';
}

async function loadNews(symbol = current?.symbol || $('symbolInput').value || 'BBCA') {
  try {
    const data = await api.news(symbol);
    renderNewsItems('newsList', data.news || []);
    renderNewsItems('expansionNewsList', data.expansionNews || []);
  } catch (err) {
    $('newsList').innerHTML = `<p class="muted">${esc(err.message || 'News gagal dimuat.')}</p>`;
  }
}

async function checkAlert() {
  try {
    setText('alertStatus', 'Mengecek kandidat alert...');
    const data = await api.alertCheck();
    $('alertEmailStatus').textContent = data.emailConfigured ? 'Email aktif' : 'Email env belum disetel';
    $('alertEmailStatus').className = `status ${data.emailConfigured ? 'good' : 'warn'}`;
    const scoreText = data.count
      ? `${data.count} kandidat melewati skor ${data.minScore}: ${data.picks.slice(0, 4).map(item => `${item.symbol} (${item.mode})`).join(', ')}`
      : `Belum ada kandidat melewati skor ${data.minScore}`;
    const harmonicText = data.harmonicCount
      ? `${data.harmonicCount} harmonic pattern: ${data.harmonicAlerts.slice(0, 3).map(item => `${item.symbol} ${item.bias} ${item.pattern}`).join(', ')}`
      : 'belum ada harmonic pattern terbaru';
    const entryText = data.swingEntryCount
      ? `${data.swingEntryCount} swing entry dekat harga masuk`
      : 'belum ada swing entry dekat harga masuk';
    const baggerText = data.baggerCount
      ? `${data.baggerCount} bagger watch`
      : 'belum ada bagger watch kuat';
    setText('alertStatus', `${scoreText}. ${harmonicText}. ${entryText}. ${baggerText}. Jadwal email: menu pagi 00:00, siang 12:00, sore 15:40 WIB. Realtime watch hanya harmonic pattern saat market.`);
  } catch (err) {
    $('alertEmailStatus').textContent = 'Alert gagal dicek';
    $('alertEmailStatus').className = 'status bad';
    setText('alertStatus', err.message || 'Alert check gagal.');
  }
}

async function sendAlertEmail() {
  try {
    setText('alertStatus', 'Mengirim email alert kandidat...');
    const data = await api.alertSend();
    $('alertEmailStatus').textContent = data.emailConfigured ? 'Email aktif' : 'Email env belum disetel';
    $('alertEmailStatus').className = `status ${data.emailConfigured ? 'good' : 'warn'}`;
    setText('alertStatus', data.email?.ok
      ? `Email terkirim ke daftar penerima. ${data.count} kandidat menu, ${data.harmonicCount || 0} harmonic, ${data.swingEntryCount || 0} swing entry, dan ${data.baggerCount || 0} bagger watch masuk alert.`
      : data.email?.message || 'Tidak ada email dikirim.');
  } catch (err) {
    $('alertEmailStatus').textContent = 'Alert gagal dikirim';
    $('alertEmailStatus').className = 'status bad';
    setText('alertStatus', err.message || 'Kirim email alert gagal.');
  }
}

function shortPatternName(name) {
  return String(name || '')
    .replace('Bullish ', 'Bull ')
    .replace('Bearish ', 'Bear ')
    .replace('Three White Soldiers', '3 Soldiers')
    .replace('Rising Three Methods', 'Rising 3');
}

function renderCandlePatterns(analysis) {
  const recent = (analysis.latestPatterns || []).slice().reverse();
  const strong = recent.filter(item => item.strength >= 3);
  const items = (strong.length ? strong : recent).slice(0, 5);

  $('candlePatternList').innerHTML = items.length ? items.map(item => `
    <p class="${esc(item.bias)}">
      <span>${esc(item.date)} - ${esc(item.bias)}</span>
      <strong>${esc(item.name)}</strong>
      <small>${esc(item.description)}</small>
    </p>
  `).join('') : '<p class="muted">Belum ada pola candle kuat pada candle terbaru.</p>';

  const harmonic = (analysis.harmonicPatterns || []).slice().reverse().slice(0, 4);
  $('harmonicPatternList').innerHTML = harmonic.length ? harmonic.map(item => `
    <p class="${esc(item.bias)}">
      <span>${esc(item.date)} - ${esc(item.bias)} XABCD</span>
      <strong>${esc(item.name)}</strong>
      <small>AB/XA ${num(item.ratios.abXa, 2)} - BC/AB ${num(item.ratios.bcAb, 2)} - CD/BC ${num(item.ratios.cdBc, 2)}</small>
    </p>
  `).join('') : '<p class="muted">Belum ada harmonic pattern valid di swing terbaru.</p>';
}

function ebookCard(title, label, detail, source, score, tooltip) {
  const cls = statusClass(score);
  return `
    <article class="ebook-card ${cls}" title="${esc(tooltip || '')}">
      <span>${esc(title)}</span>
      <strong>${esc(label)}</strong>
      <small>${esc(detail)}</small>
      <small class="ebook-source">${esc(source)}</small>
    </article>
  `;
}

function renderFundamentals(analysis) {
  $('epsValue').textContent = analysis.ebook?.fundamentalGaps?.length ? '?' : 'Tersedia';
  $('btnValuationDetail').style.display = 'block';
  $('btnValuationDetail').onclick = () => openValuationModal(analysis.last.symbol || $('symbolInput').value);
}

function renderEbookSignals(analysis) {
  const ebook = analysis.ebook;
  if (!ebook?.available) {
    $('ebookScore').textContent = 'Data kurang';
    $('ebookScore').className = 'status neutral';
    $('ebookSignalGrid').innerHTML = '<p class="muted">Butuh minimal 50 candle untuk membaca strategi e-book berbasis OHLCV.</p>';
    $('ebookDataNeeds').innerHTML = '';
    return;
  }

  $('ebookScore').textContent = `${ebook.label} ${ebook.score}/100`;
  $('ebookScore').className = `status ${statusClass(ebook.score)}`;

  const vpaDetail = ebook.vpa.signals?.length
    ? ebook.vpa.signals.slice(0, 2).map(item => item.name).join(', ')
    : `Volume ${num(ebook.vpa.volumeRatio, 2)}x, spread ${num(ebook.vpa.spreadRatio, 2)}x.`;
  const minerviniDetail = ebook.minervini.criteria
    .filter(item => item.ok)
    .slice(0, 2)
    .map(item => item.label)
    .join('; ') || 'Belum cukup memenuhi template trend.';
  const boxerDetail = ebook.boxer.active
    ? 'Momentum breakout/surge terdeteksi.'
    : ebook.boxer.contractionBeforeBreakout ? 'Ada low-volume ebb, tunggu breakout.' : 'Belum ada price-volume surge.';

  $('ebookSignalGrid').innerHTML = [
    ebookCard('Volume Price Analysis', ebook.vpa.label, vpaDetail, ebook.vpa.source, ebook.vpa.score, 'Membaca korelasi antara pergerakan harga dan volume. Jika harga naik tapi volume turun, itu anomali (bearish). Jika harga naik diikuti volume tinggi, itu validasi (bullish).'),
    ebookCard('Weinstein Stage', ebook.stage.stage, ebook.stage.reason, ebook.stage.source, ebook.stage.score, 'Membaca fase siklus harga. Stage 1: Sideways bawah, Stage 2: Uptrend (Ideal), Stage 3: Sideways atas, Stage 4: Downtrend (Hindari).'),
    ebookCard('Minervini Trend Template', `${ebook.minervini.passed}/${ebook.minervini.total} kriteria`, minerviniDetail, ebook.minervini.source, ebook.minervini.score, '7 kriteria teknikal super ketat ala Mark Minervini untuk memastikan saham benar-benar dalam uptrend super kuat sebelum kita melakukan entry breakout.'),
    ebookCard('Boxer Day/Swing', ebook.boxer.label, boxerDetail, ebook.boxer.source, ebook.boxer.score, 'Mendeteksi ledakan volume mendadak (Price-Volume Surge) yang biasanya mendahului lonjakan harga jangka pendek (Day Trade/Swing cepat).')
  ].join('');

  $('ebookDataNeeds').innerHTML = (ebook.fundamentalGaps || []).map(item => `
    <p>
      <strong>${esc(item.name)} - ${esc(item.status)}</strong>
      <span>${esc(item.data)}</span>
      <span class="ebook-source">${esc(item.source)}</span>
    </p>
  `).join('');
}

function chartTime(candle) {
  if (Number.isFinite(candle.time)) return candle.time;
  if (candle.datetime) return Math.floor(new Date(candle.datetime).getTime() / 1000);
  return candle.date;
}

function chartDate(time) {
  if (typeof time === 'number') return new Date(time * 1000);
  if (typeof time === 'string') return new Date(`${time}T00:00:00+07:00`);
  if (time?.year) return new Date(Date.UTC(time.year, time.month - 1, time.day));
  return new Date(time);
}

function candleDateKey(candle) {
  if (candle.date) return candle.date;
  const date = chartDate(chartTime(candle));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function formatChartTick(time, range) {
  const date = chartDate(time);
  if (range === 'live') {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  }

  if (range === '1d') {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      month: 'short',
      year: '2-digit'
    }).format(date);
  }

  if (['1w', '1mo'].includes(range)) {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric'
    }).format(date);
  }

  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric'
  }).format(date);
}

function setChartRangeActive(range) {
  document.querySelectorAll('[data-chart-range]').forEach(button => {
    button.classList.toggle('active', button.dataset.chartRange === range);
  });
}

function chartConfigFor(range) {
  return {
    live: { interval: '5min', outputsize: 180, range: '5d', label: 'Live 5M - candle intraday', mode: 'day', intraday: true },
    '1d': { interval: '1day', outputsize: 5000, range: '20y', label: '1D - candle harian', mode: 'swing' },
    '1w': { interval: '1week', outputsize: 5000, range: '20y', label: '1W - candle mingguan', mode: 'swing' },
    '1mo': { interval: '1month', outputsize: 5000, range: '20y', label: '1Bln - candle bulanan', mode: 'swing' },
    '3mo': { interval: '1month', outputsize: 5000, range: '20y', label: '3Bln - candle 3 bulanan', mode: 'swing', aggregateMonths: 3 },
    '6mo': { interval: '1month', outputsize: 5000, range: '20y', label: '6Bln - candle 6 bulanan', mode: 'swing', aggregateMonths: 6 },
    '1y': { interval: '1month', outputsize: 5000, range: '20y', label: '1Th - candle tahunan', mode: 'swing', aggregateMonths: 12 }
  }[range] || { interval: '5min', outputsize: 180, range: '5d', label: 'Live 5M - candle intraday', mode: 'day', intraday: true };
}

function aggregateMonthlyCandles(candles, months) {
  if (!months || months <= 1) return candles;
  const groups = new Map();
  candles.forEach(candle => {
    const date = candle.date || candle.datetime || '';
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    if (!year || !month) return;
    const bucket = Math.floor((month - 1) / months);
    const key = `${year}-${bucket}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candle);
  });

  return [...groups.values()].map(group => {
    const first = group[0];
    const last = group.at(-1);
    return {
      ...last,
      time: chartTime(last),
      date: last.date,
      datetime: last.datetime,
      open: first.open,
      high: Math.max(...group.map(candle => candle.high)),
      low: Math.min(...group.map(candle => candle.low)),
      close: last.close,
      volume: group.reduce((sum, candle) => sum + (candle.volume || 0), 0)
    };
  });
}

function sliceChartCandles(candles, cfg) {
  let data = aggregateMonthlyCandles(candles, cfg.aggregateMonths);
  data = data.slice(-cfg.outputsize);
  return data.length >= 10 ? data : candles.slice(-Math.min(candles.length, cfg.outputsize));
}

function analyzeForChart(candles, fallback, range) {
  try {
    const mode = chartConfigFor(range).mode || 'swing';
    return analyze(candles, { mode });
  } catch {
    return { ...fallback, patterns: [], latestPatterns: [], harmonicPatterns: [] };
  }
}

function defaultChartRange() {
  return currentIntradayPayload?.candles?.length >= 30 ? 'live' : '1d';
}

function cachedChartCandles(range, dailyPayload = currentDailyPayload, intradayPayload = currentIntradayPayload) {
  const cfg = chartConfigFor(range);
  if (cfg.intraday && intradayPayload?.candles?.length) {
    return intradayPayload.candles.slice(-cfg.outputsize);
  }
  return sliceChartCandles(dailyPayload?.candles || [], cfg);
}

function renderChart(candles, analysis, options = {}) {
  const range = options.range || chartRange;
  const cfg = chartConfigFor(range);
  if (chart) chart.remove();
  chart = createChart($('chart'), {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: '#dbeafe' },
    localization: {
      locale: 'id-ID',
      timeFormatter: time => formatChartTick(time, range)
    },
    grid: { vertLines: { color: 'rgba(148,190,232,.12)' }, horzLines: { color: 'rgba(148,190,232,.12)' } },
    rightPriceScale: { borderColor: 'rgba(148,190,232,.24)' },
    timeScale: {
      borderColor: 'rgba(148,190,232,.24)',
      timeVisible: Boolean(cfg.intraday),
      secondsVisible: false,
      tickMarkFormatter: time => formatChartTick(time, range)
    }
  });

  const cs = chart.addSeries(CandlestickSeries, {
    upColor: '#4ade80',
    downColor: '#fb7185',
    wickUpColor: '#4ade80',
    wickDownColor: '#fb7185',
    borderVisible: false
  });
  cs.setData(candles.map(c => ({ time: chartTime(c), open: c.open, high: c.high, low: c.low, close: c.close })));

  const vs = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' });
  vs.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
  vs.setData(candles.map(c => ({
    time: chartTime(c),
    value: c.volume || 0,
    color: c.close >= c.open ? 'rgba(74,222,128,.28)' : 'rgba(251,113,133,.24)'
  })));

  const closes = candles.map(c => c.close);
  if (closes.length >= 20) {
    const line = chart.addSeries(LineSeries, { color: '#60a5fa', lineWidth: 2, title: 'EMA20' });
    let prev = closes.slice(0, 20).reduce((sum, value) => sum + value, 0) / 20;
    const values = [];
    const k = 2 / 21;
    for (let i = 19; i < candles.length; i++) {
      if (i > 19) prev = candles[i].close * k + prev * (1 - k);
      values.push({ time: chartTime(candles[i]), value: prev });
    }
    line.setData(values);
  }

  const setup = options.setup || analysis.swingSetup;
  if (setup) {
    cs.createPriceLine({ price: setup.stop, color: '#fb7185', lineStyle: 2, title: 'STOP' });
    cs.createPriceLine({ price: setup.target1, color: '#4ade80', lineStyle: 2, title: 'TP1' });
    cs.createPriceLine({ price: setup.target2, color: '#fbbf24', lineStyle: 2, title: 'TP2' });
  }

  const patternMarkers = (analysis.patterns || [])
    .filter(item => item.strength >= 3)
    .slice(-28)
    .map(item => ({
      time: item.time || item.date,
      position: item.bias === 'bearish' ? 'aboveBar' : 'belowBar',
      color: item.bias === 'bearish' ? '#fb7185' : item.bias === 'bullish' ? '#4ade80' : '#fbbf24',
      shape: item.bias === 'bearish' ? 'arrowDown' : item.bias === 'bullish' ? 'arrowUp' : 'circle',
      text: shortPatternName(item.name)
    }));
  if (patternMarkers.length) createSeriesMarkers(cs, patternMarkers);

  (analysis.harmonicPatterns || []).slice(-2).forEach(item => {
    const color = item.bias === 'bearish' ? '#fb7185' : '#fbbf24';
    const harmonicLine = chart.addSeries(LineSeries, {
      color,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false
    });
    harmonicLine.setData(item.points.map(point => ({ time: point.time || point.date, value: point.price })));
    createSeriesMarkers(harmonicLine, item.points.map(point => ({
      time: point.time || point.date,
      position: point.label === 'D' ? (item.bias === 'bearish' ? 'aboveBar' : 'belowBar') : 'inBar',
      color,
      shape: point.label === 'D' ? (item.bias === 'bearish' ? 'arrowDown' : 'arrowUp') : 'circle',
      text: point.label === 'D' ? `${item.bias === 'bullish' ? 'Bull' : 'Bear'} ${item.name}` : point.label
    })));
  });

  chart.timeScale().fitContent();
}

function renderIndexChart(candles = [], options = {}) {
  const range = options.range || '1d';
  const cfg = chartConfigFor(range);
  if (indexChart) indexChart.remove();
  indexChart = createChart($('ihsgChart'), {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: '#dbeafe' },
    grid: { vertLines: { color: 'rgba(148,190,232,.12)' }, horzLines: { color: 'rgba(148,190,232,.12)' } },
    rightPriceScale: { borderColor: 'rgba(148,190,232,.24)' },
    timeScale: {
      borderColor: 'rgba(148,190,232,.24)',
      timeVisible: Boolean(cfg.intraday),
      secondsVisible: false,
      tickMarkFormatter: time => formatChartTick(time, range)
    }
  });

  const cs = indexChart.addSeries(CandlestickSeries, {
    upColor: '#4ade80',
    downColor: '#fb7185',
    wickUpColor: '#4ade80',
    wickDownColor: '#fb7185',
    borderVisible: false
  });
  cs.setData(candles.map(c => ({ time: chartTime(c), open: c.open, high: c.high, low: c.low, close: c.close })));
  indexChart.timeScale().fitContent();
}

async function loadIHSG() {
  try {
    const data = await api.index();
    if (data.marketSchedule) {
      marketSchedule = data.marketSchedule;
      marketScheduleLoadedAt = Date.now();
    }
    const range = data.chartMode === 'live' ? 'live' : '1d';
    renderIndexChart(data.candles || [], { range });
    setText('ihsgLast', num(data.last?.close, 2));
    setText('ihsgChange', `${data.changePct >= 0 ? '+' : ''}${num(data.changePct, 2)}%`);
    $('ihsgChange').className = signalClass(data.changePct);
    const liveLabel = data.chartMode === 'live' ? 'Live 5M' : data.chartMode === 'daily-fallback' ? 'Daily fallback' : 'Daily';
    const phaseLabel = data.marketSchedule?.phaseLabel ? ` - ${data.marketSchedule.phaseLabel}` : '';
    setText('ihsgMeta', `${liveLabel} - ${data.provider} - ${data.dataStatus || 'delayed/eod'} - ${data.meta?.lastDataTime || 'waktu data tidak tersedia'}${phaseLabel}`);
    $('ihsgStatus').textContent = data.chartMode === 'live' ? 'IHSG live' : 'IHSG aktif';
    $('ihsgStatus').className = `status ${data.chartMode === 'daily-fallback' ? 'warn' : 'good'}`;
  } catch (err) {
    $('ihsgStatus').textContent = 'IHSG gagal dimuat';
    $('ihsgStatus').className = 'status bad';
    $('ihsgMeta').textContent = err.message || 'Data IHSG gagal dimuat.';
  }
}

function renderFundamentalStats(stats, analysis) {
  const hasStats = stats && !stats.message;
  const hasRatios = ['eps', 'per', 'pbv', 'roe', 'der'].some(key => Number.isFinite(stats?.[key]));
  const valuation = valuationView(analysis);
  $('fundamentalSource').textContent = hasRatios ? 'Lapkeu + market stats' : hasStats ? 'Pluang + proxy teknikal' : 'Proxy teknikal';
  $('fundamentalSource').className = `source-badge ${hasStats ? '' : 'warn'}`;
  $('valuationBadge').textContent = valuation.badge;
  $('valuationBadge').className = `source-badge ${valuation.className}`;

  setText('fairValue', rupiah(analysis.fairValue));
  const upsidePct = analysis?.last?.close ? ((analysis.fairValue - analysis.last.close) / analysis.last.close) * 100 : 0;
  setText('fairGap', `Potensi ${upsidePct >= 0 ? 'upside +' : ''}${num(upsidePct, 2)}% dari harga saat ini`);
  setText('valuationStatus', valuation.status);
  setText('valuationNote', valuation.note);
  setText('marketCapValue', compactRp(stats?.marketCap));
  setText('marketCapNote', hasStats ? 'kapitalisasi pasar' : 'belum tersedia');
  setText('epsValue', Number.isFinite(stats?.eps) ? rupiah(stats.eps) : '-');
  setText('epsNote', Number.isFinite(stats?.eps) ? 'EPS diluted TTM' : 'butuh data lapkeu');
  setText('perValue', Number.isFinite(stats?.per) ? `${num(stats.per, 2)}x` : '-');
  setText('perNote', Number.isFinite(stats?.per) ? 'harga / EPS TTM' : 'butuh EPS');
  setText('pbvValue', Number.isFinite(stats?.pbv) ? `${num(stats.pbv, 2)}x` : '-');
  setText('pbvNote', Number.isFinite(stats?.bookValuePerShare) ? `BVPS ${rupiah(stats.bookValuePerShare)}` : 'price to book');
  setText('roeValue', Number.isFinite(stats?.roe) ? `${num(stats.roe, 2)}%` : '-');
  setText('roeNote', Number.isFinite(stats?.roe) ? 'laba / ekuitas' : 'butuh laba & ekuitas');
  setText('derValue', Number.isFinite(stats?.der) ? `${num(stats.der, 2)}x` : '-');
  setText('derNote', stats?.derBasis === 'debt/equity' ? 'utang / ekuitas' : 'liabilitas / ekuitas');
  setText('turnoverValue', compactRp(stats?.turnover));
  setText('turnoverNote', hasStats ? 'turnover terakhir' : 'butuh data market stats');
  setText('lotValue', Number.isFinite(stats?.lot) ? `${compact(stats.lot)} lot` : '-');
  setText('volumeValue', Number.isFinite(stats?.volume) ? `${compact(stats.volume)} lembar` : '-');
  setText('averagePriceValue', Number.isFinite(stats?.averagePrice) ? rupiah(stats.averagePrice) : '-');
  setText('iepValue', Number.isFinite(stats?.iep) ? `IEP ${rupiah(stats.iep)}` : 'IEP -');
  setText('fundamentalConfidence', hasStats ? `${stats.confidenceScore}/100` : 'Proxy');
  setText('fundamentalNote', hasStats ? `${stats.confidenceLabel} - ${stats.provider}` : 'Data fundamental publik belum tersedia.');

  // Valuation Button Logic
  const symbol = analysis?.last?.symbol || document.getElementById('symbolInput').value;
  const btn = document.getElementById('btnValuationDetail');
  if (btn) {
    btn.style.display = 'block';
    btn.onclick = () => openValuationModal(symbol);
  }
}

async function loadChartRange(range) {
  if (!currentSymbol || !currentDailyAnalysis) return;
  const token = ++chartLoadToken;
  chartRange = range;
  setChartRangeActive(range);
  const cfg = chartConfigFor(range);
  setText('chartMeta', `Memuat ${cfg.label}...`);

  try {
    let payload;
    if (cfg.intraday) {
      payload = await api.series(currentSymbol, cfg.interval, cfg.outputsize, cfg.range);
      currentIntradayPayload = payload;
      currentIntradayAnalysis = payload.candles?.length >= 30 ? analyze(payload.candles, { mode: 'day' }) : null;
      if (token !== chartLoadToken) return;

      const chartAnalysis = currentIntradayAnalysis || analyzeForChart(payload.candles, currentDailyAnalysis, range);
      const setup = currentIntradayAnalysis?.daySetup || current?.daySetup || currentDailyAnalysis.swingSetup;
      renderChart(payload.candles, chartAnalysis, { range, setup });
      setText('chartMeta', `${cfg.label} - ${payload.provider} - ${payload.meta?.lastDataTime || 'waktu data tidak tersedia'}`);
      return;
    }

    const canUseDailyCache = cfg.interval === '1day' && currentDailyPayload?.candles?.length >= Math.min(cfg.outputsize, 260) && !['5y', 'all'].includes(range);
    if (canUseDailyCache) {
      payload = { ...currentDailyPayload, candles: sliceChartCandles(currentDailyPayload.candles, cfg) };
    } else {
      payload = await api.series(currentSymbol, cfg.interval, cfg.outputsize, cfg.range);
      if (cfg.ytd) payload = { ...payload, candles: sliceChartCandles(payload.candles, cfg) };
    }
    if (token !== chartLoadToken) return;

    const chartAnalysis = analyzeForChart(payload.candles, currentDailyAnalysis, range);
    const setup = currentDailyAnalysis.swingSetup;
    renderChart(payload.candles, chartAnalysis, { range, setup });
    setText('chartMeta', `${cfg.label} - ${payload.provider} - ${payload.meta?.lastDataTime || 'waktu data tidak tersedia'}`);
  } catch (err) {
    setText('chartMeta', err.message || 'Chart gagal dimuat.');
  }
}

function verdictText(a) {
  if (a.score >= 82) return `Setup kuat. Prioritaskan entry terukur, jangan mengejar candle yang terlalu jauh dari support. Best mode: ${a.bestMode}.`;
  if (a.score >= 68) return `Menarik untuk watchlist. Tunggu konfirmasi volume atau pullback sehat sebelum entry. Best mode: ${a.bestMode}.`;
  if (a.score >= 55) return `Masih netral. Cocok dipantau, tetapi sinyal belum cukup bersih untuk agresif. Best mode: ${a.bestMode}.`;
  return 'Risiko lebih dominan daripada peluang. Lebih baik tunggu struktur harga membaik.';
}

function renderAnalysis(symbol, dailyPayload, analysis, intradayAnalysis, fundamentals, options = {}) {
  const a = analysis;
  const meta = dailyPayload.meta || {};
  const usedDay = intradayAnalysis || a;
  current = { symbol, ...a, modes: { ...a.modes, day: usedDay.modes.day }, daySetup: usedDay.daySetup };
  currentSymbol = symbol;
  currentDailyPayload = dailyPayload;
  currentDailyAnalysis = a;
  currentIntradayPayload = options.intradayPayload || null;
  currentIntradayAnalysis = intradayAnalysis || null;
  const changeText = `${a.changePct >= 0 ? '+' : ''}${num(a.changePct, 2)}% dari candle sebelumnya`;
  const scoreClassName = statusClass(a.score);

  setText('analysisTitle', symbol);
  setText('analysisSubtitle', `${meta.name || symbol} - ${dailyPayload.provider} - ${meta.lastDataTime || 'waktu data tidak tersedia'}`);
  setText('symbolName', symbol);
  setText('companyName', meta.name || symbol);
  setText('sourceNote', dailyPayload.sourceReliability === 'free-unofficial' ? 'FREE FALLBACK - REALTIME TIDAK DIJAMIN' : 'DATA PROVIDER AKTIF');
  setText('lastPrice', rupiah(a.last.close));
  setText('priceChange', changeText);
  $('priceChange').className = signalClass(a.changePct);
  setText('openValue', `Open ${rupiah(a.last.open)}`);
  setText('highValue', `High ${rupiah(a.last.high)}`);
  setText('lowValue', `Low ${rupiah(a.last.low)}`);
  setText('overallLabel', a.label);
  $('overallLabel').className = `status ${scoreClassName}`;
  setText('dataStatus', dailyPayload.dataStatus || 'data tersedia');
  $('dataStatus').className = `status ${dailyPayload.sourceReliability === 'free-unofficial' ? 'warn' : 'good'}`;

  setText('trendValue', a.trend);
  setText('bestMode', a.bestMode);
  setText('dominantFactor', a.rvol >= 1.5 ? `Volume ${num(a.rvol, 2)}x` : a.breakout ? 'Breakout resistance' : `RSI ${num(a.rsi, 1)}`);
  setText('invalidationLevel', rupiah(a.swingSetup.stop));
  setText('finalVerdict', verdictText(a));

  setText('chartMeta', `${dailyPayload.provider} - ${meta.interval || '1d'} - ${meta.exchange || 'IDX'}`);
  setText('swingLabel', a.label);
  $('swingLabel').className = `status ${scoreClassName}`;
  setText('swingScore', a.score);
  $('swingReasons').innerHTML = a.reasons.slice(0, 5).map(reason => `<li>${esc(reason)}</li>`).join('');
  document.querySelector('.score-ring').style.background = `conic-gradient(var(--green) ${a.score * 3.6}deg, rgba(37,99,235,.13) 0)`;

  setText('dayScore', `${usedDay.modes.day.label} - score ${usedDay.modes.day.score}/100`);
  setText('dayEntryWeak', rupiah(usedDay.daySetup.buyOnWeakness));
  setText('dayBreakout', rupiah(usedDay.daySetup.breakoutEntry));
  setText('dayStop', rupiah(usedDay.daySetup.stop));
  setText('dayTarget1', rupiah(usedDay.daySetup.target1));
  setText('dayTarget2', rupiah(usedDay.daySetup.target2));
  setText('swingModeScore', `${a.modes.swing.label} - score ${a.modes.swing.score}/100`);
  setText('swingEntryPullback', rupiah(a.swingSetup.buyOnPullback));
  setText('swingEntryAggressive', rupiah(a.swingSetup.aggressiveEntry));
  setText('swingStop', rupiah(a.swingSetup.stop));
  setText('swingTarget1', rupiah(a.swingSetup.target1));
  setText('swingTarget2', rupiah(a.swingSetup.target2));
  setText('swingTarget3', rupiah(a.swingSetup.target3));
  setText('longModeScore', `${a.modes.long.label} - score ${a.modes.long.score}/100`);
  setText('longAccumulation', rupiah(Math.min(a.last.close, Math.max(a.e50, a.support))));
  setText('longGuard', `EMA50 ${rupiah(a.e50)} / EMA200 ${rupiah(a.e200)}`);
  setText('longInvalidation', rupiah(Math.min(a.e50, a.swingSetup.stop)));
  setText('longFairValue', rupiah(a.fairValue));
  setText('baggerModeScore', `${a.modes.bagger.label} - score ${a.modes.bagger.score}/100`);
  setText('baggerZone', rupiah(a.baggerSetup.accumulationZone));
  setText('baggerConfirm', rupiah(a.baggerSetup.confirmationLevel));
  setText('baggerInvalidation', rupiah(a.baggerSetup.invalidation));
  setText('baggerChecklist', 'Lapkeu tumbuh + ekspansi valid');

  setText('techTrend', a.trend);
  setText('rsiValue', num(a.rsi, 1));
  setText('rsiNote', a.rsi > 80 ? 'Sangat overbought' : a.rsi > 70 ? 'Overbought' : a.rsi < 35 ? 'Lemah' : 'Sehat');
  setText('macdValue', Number.isFinite(a.macd.histogram) ? num(a.macd.histogram, 2) : '-');
  setText('rvolValue', `${num(a.rvol, 2)}x`);
  setText('rvolNote', a.rvol >= 1.5 ? 'Volume spike' : 'Normal volume');
  setText('volatilityValue', `${num(a.volatilityPct, 2)}%`);
  setText('momentumValue', `${a.changePct >= 0 ? '+' : ''}${num(a.changePct, 2)}%`);

  renderFundamentalStats(fundamentals, a);
  setText('profitabilityScore', `${a.quality.profitability}/10`);
  setText('growthScore', `${a.quality.growth}/10`);
  setText('stabilityScore2', `${a.quality.stability}/10`);
  setText('liquidityScore2', `${a.quality.liquidity}/10`);

  setText('riskLevel', `Level Risiko: ${a.risk.level}`);
  $('riskBar').style.setProperty('--risk', `${clamp((a.risk.technical + a.risk.valuation + a.risk.market) / 30 * 100, 5, 100)}%`);
  setText('riskTechnical', `${a.risk.technical}/10`);
  setText('riskValuation', `${a.risk.valuation}/10`);
  setText('riskMarket', `${a.risk.market}/10`);

  setText('dayStrategy', usedDay.modes.day.score >= 68 ? 'Cari entry dekat support intraday atau breakout dengan volume. Hindari entry saat candle melebar.' : 'Tunggu volume dan struktur intraday membaik.');
  setText('swingStrategy', a.modes.swing.score >= 68 ? 'Buy on pullback lebih ideal daripada mengejar harga. Validasi dengan stop loss.' : 'Pantau sampai harga kembali di atas EMA dan volume masuk.');
  setText('longStrategy', a.modes.long.score >= 68 ? 'Akumulasi bertahap lebih masuk akal daripada all-in. Review ulang saat trend panjang patah.' : 'Belum ideal untuk long term dari sisi teknikal.');
  setText('riskStrategy', `Batasi risiko per posisi 0,5%-2%. Stop swing utama: ${rupiah(a.swingSetup.stop)}.`);

  renderCandlePatterns(a);
  renderEbookSignals(a);
  chartRange = options.preserveChartRange ? chartRange : defaultChartRange();
  setChartRangeActive(chartRange);
  const initialCandles = cachedChartCandles(chartRange, dailyPayload, currentIntradayPayload);
  const initialAnalysis = chartRange === 'live' && currentIntradayAnalysis ? currentIntradayAnalysis : a;
  const initialSetup = chartRange === 'live' ? usedDay.daySetup : a.swingSetup;
  const initialMeta = chartRange === 'live' ? currentIntradayPayload?.meta : meta;
  renderChart(initialCandles, initialAnalysis, { range: chartRange, setup: initialSetup });
  setText('chartMeta', `${chartConfigFor(chartRange).label} - ${(chartRange === 'live' ? currentIntradayPayload?.provider : dailyPayload.provider) || dailyPayload.provider} - ${initialMeta?.lastDataTime || 'waktu data tidak tersedia'}`);
  renderModePanel(current);
  if (!options.skipNews) loadNews(symbol);
}

async function run(rawSymbol) {
  const symbol = String(rawSymbol || '').trim().toUpperCase().replace(/[^A-Z0-9.:-]/g, '');
  if (!symbol) return;

  clearError();
  $('analysisLoading').classList.remove('hidden');
  location.hash = 'analysisPanel';

  try {
    const [dailyPayload, intradayPayload, fundamentals] = await Promise.all([
      api.series(symbol, '1day', 5000, '20y'),
      api.series(symbol, '5min', 180).catch(() => null),
      api.fundamentals(symbol).catch(() => null)
    ]);
    const dailyAnalysis = analyze(dailyPayload.candles, { mode: 'swing' });
    let intradayAnalysis = null;
    if (intradayPayload?.candles?.length >= 30) {
      intradayAnalysis = analyze(intradayPayload.candles, { mode: 'day' });
    }
    renderAnalysis(symbol, dailyPayload, dailyAnalysis, intradayAnalysis, fundamentals, { intradayPayload });
    $('analysisPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError(err.message || 'Analisis gagal.');
  } finally {
    $('analysisLoading').classList.add('hidden');
  }
}

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('loginError').textContent = '';
  try {
    await api.login($('password').value);
    $('loginOverlay').classList.add('hidden');
    $('logoutBtn').classList.remove('hidden');
    await Promise.all([checkStatus(), loadScanner()]);
  } catch (err) {
    $('loginError').textContent = err.message;
  }
});

$('togglePassword').onclick = () => {
  $('password').type = $('password').type === 'password' ? 'text' : 'password';
};

$('logoutBtn').onclick = async () => {
  await api.logout();
  location.reload();
};

$('searchForm').addEventListener('submit', e => {
  e.preventDefault();
  run($('symbolInput').value);
});

document.querySelectorAll('[data-symbol]').forEach(button => {
  button.onclick = () => {
    $('symbolInput').value = button.dataset.symbol;
    run(button.dataset.symbol);
  };
});

$('refreshScannerBtn').onclick = () => loadScanner();
$('toggleAutoRefreshBtn').onclick = () => {
  autoRefreshEnabled = !autoRefreshEnabled;
  $('toggleAutoRefreshBtn').textContent = autoRefreshEnabled ? 'Auto ON' : 'Auto OFF';
  $('toggleAutoRefreshBtn').className = autoRefreshEnabled ? 'ghost mini' : 'primary mini';
  scheduleAutoRefresh();
};
$('dailyBtn').onclick = generateDailyImage;
$('closeDailyBtn').onclick = () => {
  $('dailyImagePanel').classList.add('hidden');
  $('dailyImagePanel').setAttribute('aria-hidden', 'true');
};
$('dailyImagePanel').onclick = event => {
  if (event.target === $('dailyImagePanel')) $('closeDailyBtn').click();
};
$('downloadDailyBtn').onclick = () => {
  const link = document.createElement('a');
  link.download = `stock-santuy-daily-${new Date().toISOString().slice(0, 10)}.png`;
  link.href = $('dailyImage').src || $('dailyCanvas').toDataURL('image/png');
  link.click();
};
$('refreshNewsBtn').onclick = () => loadNews();
$('checkAlertBtn').onclick = checkAlert;
document.querySelectorAll('[data-mode-tab]').forEach(button => {
  button.onclick = () => setMode(button.dataset.modeTab);
});
$('chartRangeControls').addEventListener('click', event => {
  const button = event.target.closest('[data-chart-range]');
  if (button) loadChartRange(button.dataset.chartRange);
});

$('calculateBtn').onclick = () => {
  if (!current) {
    $('positionResult').textContent = 'Jalankan analisis saham terlebih dahulu.';
    return;
  }
  const capital = Number($('capitalInput').value);
  const riskPct = Number($('riskInput').value);
  if (capital <= 0 || riskPct <= 0 || riskPct > 5) {
    $('positionResult').textContent = 'Masukkan modal dan risiko 0,1%-5%.';
    return;
  }
  const maxRisk = capital * riskPct / 100;
  const riskPerShare = Math.abs(current.swingSetup.aggressiveEntry - current.swingSetup.stop);
  const shares = Math.floor(maxRisk / Math.max(riskPerShare, 1));
  const lots = Math.floor(shares / 100);
  const cost = lots * 100 * current.swingSetup.aggressiveEntry;
  $('positionResult').innerHTML = `Risiko maksimal <strong>${rupiah(maxRisk)}</strong>. Estimasi maksimal <strong>${lots} lot</strong>. Nilai pembelian sekitar <strong>${rupiah(cost)}</strong>.`;
};

// Valuation Modal Logic
$('closeValuationModal').onclick = () => {
  $('valuationModal').style.display = 'none';
};

window.onclick = (event) => {
  if (event.target == $('valuationModal')) {
    $('valuationModal').style.display = 'none';
  }
};

async function openValuationModal(symbol) {
  $('valuationModal').style.display = 'block';
  $('valuationLoading').style.display = 'flex';
  $('valuationError').style.display = 'none';
  $('valuationContent').style.display = 'none';

  try {
    const res = await api.valuation(symbol);
    if (res.error) throw new Error(res.error);
    
    const valuation = calculateValuationScenarios(res);
    
    // Populate UI
    $('valCurrentPrice').textContent = rupiah(valuation.price);
    $('valComposite').textContent = rupiah(valuation.composite);
    $('valSafePrice').textContent = rupiah(valuation.safeBuyPrice);
    $('valUpside').textContent = valuation.upside.toFixed(2) + '%';
    
    $('valStatus').textContent = valuation.status;
    $('valStatus').className = `status-badge ${valuation.upside > 10 ? 'success' : valuation.upside < -10 ? 'danger' : 'neutral'}`;
    
    $('valMos').textContent = `MoS ${valuation.marginOfSafety.toFixed(0)}%`;
    $('valConfidence').textContent = `Confidence: ${valuation.confidence}`;
    
    // Scenarios
    const maxVal = Math.max(valuation.scenarios.bull.fairValue, valuation.price, valuation.composite) * 1.2;
    
    ['bear', 'base', 'bull'].forEach(scenario => {
      const v = valuation.scenarios[scenario].fairValue;
      $(`val${scenario.charAt(0).toUpperCase() + scenario.slice(1)}`).textContent = rupiah(v);
      $(`bar${scenario.charAt(0).toUpperCase() + scenario.slice(1)}`).style.width = Math.min((v / maxVal) * 100, 100) + '%';
    });
    
    // Assumptions
    const asm = valuation.scenarios.base.assumptions;
    $('asGrowth').textContent = asm.growthRate;
    $('asDiscount').textContent = asm.discountRate;
    $('asTerminal').textContent = asm.terminalGrowth;
    $('asPer').textContent = asm.targetPer;
    $('asPbv').textContent = asm.targetPbv;
    
    // Methods Table
    $('valMethodsTable').innerHTML = valuation.scenarios.base.methods.map(m => `
      <tr>
        <td>${m.name}</td>
        <td><strong>${rupiah(m.value)}</strong></td>
        <td>${m.weight}%</td>
      </tr>
    `).join('');
    
    $('valuationLoading').style.display = 'none';
    $('valuationContent').style.display = 'block';
  } catch (err) {
    $('valuationLoading').style.display = 'none';
    $('valuationError').style.display = 'block';
    $('valuationErrorText').textContent = err.message;
  }
}

initAuth();
loadMarketSchedule();
setInterval(loadMarketSchedule, 30_000);
checkStatus();
loadScanner();
loadIHSG();
loadNews('BBCA');
checkAlert();
run('BBCA');
