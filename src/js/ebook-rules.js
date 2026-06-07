const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const mean = values => {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
};
const pct = (a, b) => b ? ((a - b) / b) * 100 : 0;
const range = candle => Math.max((candle?.high || 0) - (candle?.low || 0), 1);
const closePosition = candle => clamp(((candle.close - candle.low) / range(candle)) || 0, 0, 1);
const isBullish = candle => candle.close > candle.open;
const isBearish = candle => candle.close < candle.open;

const lastDefined = values => [...values].reverse().find(Number.isFinite);

function smaSeries(values, period) {
  if (!Array.isArray(values) || values.length < period) return [];
  return values.map((_, index) => {
    if (index < period - 1) return null;
    return mean(values.slice(index - period + 1, index + 1));
  });
}

function highest(candles, count, key = 'high', excludeLast = false) {
  const end = excludeLast ? -1 : undefined;
  const sample = candles.slice(-count, end);
  return sample.length ? Math.max(...sample.map(candle => candle[key]).filter(Number.isFinite)) : null;
}

function lowest(candles, count, key = 'low') {
  const sample = candles.slice(-count);
  return sample.length ? Math.min(...sample.map(candle => candle[key]).filter(Number.isFinite)) : null;
}

function priorAverage(candles, count, mapper) {
  return mean(candles.slice(-(count + 1), -1).map(mapper));
}

function recentTrend(candles, lookback = 12) {
  if (candles.length < lookback + 1) return 'flat';
  const recent = candles.slice(-(lookback + 1));
  const first = recent[0].close;
  const last = recent.at(-1).close;
  const change = pct(last, first);
  if (change > 3) return 'up';
  if (change < -3) return 'down';
  return 'flat';
}

function evaluateVpa(candles) {
  const last = candles.at(-1);
  const prev = candles.at(-2) || last;
  const avgVolume = priorAverage(candles, 20, candle => candle.volume || 0) || 1;
  const avgSpread = priorAverage(candles, 20, range) || range(last);
  const volumeRatio = (last.volume || 0) / avgVolume;
  const spreadRatio = range(last) / avgSpread;
  const closePos = closePosition(last);
  const changePct = pct(last.close, prev.close);
  const resistance = highest(candles, 30, 'high', true) || last.high;
  const trend = recentTrend(candles);
  const signals = [];

  const add = (name, bias, score, detail) => signals.push({ name, bias, score, detail });

  if (isBullish(last) && spreadRatio >= 1.15 && volumeRatio >= 1.45 && closePos >= 0.65) {
    add('Volume validates bullish spread', 'bullish', 82, 'Wide candle naik, close kuat, dan volume di atas rata-rata.');
  }

  if (last.close > resistance && volumeRatio >= 1.45 && closePos >= 0.6) {
    add('Breakout volume confirmation', 'bullish', 86, 'Breakout resistance ikut divalidasi volume.');
  }

  if (trend === 'down' && isBearish(last) && volumeRatio >= 1.7 && closePos >= 0.45 && (last.close - last.low) / range(last) >= 0.35) {
    add('Stopping volume watch', 'bullish', 76, 'Tekanan turun mulai diserap; tunggu konfirmasi candle berikutnya.');
  }

  if (trend === 'up' && isBullish(last) && spreadRatio <= 0.78 && volumeRatio <= 0.78 && closePos <= 0.58) {
    add('No demand warning', 'bearish', 72, 'Kenaikan kecil terjadi pada volume rendah, demand belum meyakinkan.');
  }

  if (volumeRatio >= 1.8 && spreadRatio <= 0.78 && closePos <= 0.5) {
    add('Effort-result anomaly', 'bearish', 78, 'Volume besar tidak menghasilkan kenaikan sepadan; waspadai supply.');
  }

  const bull = signals.filter(signal => signal.bias === 'bullish').reduce((sum, signal) => sum + signal.score, 0);
  const bear = signals.filter(signal => signal.bias === 'bearish').reduce((sum, signal) => sum + signal.score, 0);
  const bias = bull > bear ? 'bullish' : bear > bull ? 'bearish' : 'neutral';
  const score = clamp(Math.round(50 + (bull - bear) / 12), 0, 100);

  return {
    label: bias === 'bullish' ? 'VPA bullish' : bias === 'bearish' ? 'VPA warning' : 'VPA netral',
    bias,
    score,
    volumeRatio,
    spreadRatio,
    closePosition: closePos,
    signals,
    source: 'Anna Coulling VPA hlm 40, 43, 74, 108-110; Wyckoff Structures hlm 36, 80, 84'
  };
}

function evaluateWeinsteinStage(candles) {
  const closes = candles.map(candle => candle.close);
  const ma50 = smaSeries(closes, 50);
  const ma150 = smaSeries(closes, 150);
  const ma200 = smaSeries(closes, 200);
  const last = candles.at(-1);
  const sma50 = lastDefined(ma50);
  const sma150 = lastDefined(ma150);
  const sma200 = lastDefined(ma200);
  const sma150Past = ma150.at(-51);
  const resistance = highest(candles, 150, 'high', true);
  const support = lowest(candles, 150, 'low');

  if (!Number.isFinite(sma150) || !Number.isFinite(sma150Past)) {
    return {
      stage: 'Data kurang',
      score: 50,
      reason: 'Butuh minimal sekitar 150 candle harian untuk proxy 30-week moving average.',
      source: 'Stan Weinstein hlm 24-31, 42-43'
    };
  }

  const slopePct = pct(sma150, sma150Past);
  const aboveMa = last.close > sma150;
  const risingMa = slopePct > 1;
  const fallingMa = slopePct < -1;
  const breakoutReady = resistance ? last.close >= resistance * 0.97 : false;
  let stage = 'Stage 1 / base';
  let score = 60;
  let reason = 'Harga berada dekat MA 30-minggu proxy; fase masih pembentukan base.';

  if (aboveMa && risingMa && last.close > (sma50 || sma150) && breakoutReady) {
    stage = 'Stage 2 / advancing';
    score = 86;
    reason = 'Harga di atas MA 30-minggu proxy yang naik dan mendekati/menembus resistance.';
  } else if (!aboveMa && fallingMa) {
    stage = 'Stage 4 / declining';
    score = 24;
    reason = 'Harga di bawah MA 30-minggu proxy yang menurun.';
  } else if (aboveMa && !risingMa && last.close < (sma50 || last.close)) {
    stage = 'Stage 3 / topping';
    score = 44;
    reason = 'Harga masih di area atas, tetapi momentum mulai melemah terhadap MA cepat.';
  }

  return {
    stage,
    score,
    reason,
    ma30WeekProxy: sma150,
    ma200: sma200 || null,
    slopePct,
    resistance,
    support,
    source: 'Stan Weinstein hlm 24-31, 42-43'
  };
}

function evaluateMinervini(candles) {
  const closes = candles.map(candle => candle.close);
  const ma50 = smaSeries(closes, 50);
  const ma150 = smaSeries(closes, 150);
  const ma200 = smaSeries(closes, 200);
  const last = candles.at(-1);
  const sma50 = lastDefined(ma50);
  const sma150 = lastDefined(ma150);
  const sma200 = lastDefined(ma200);
  const sma200Past = ma200.at(-22);
  const high52 = highest(candles, 252);
  const low52 = lowest(candles, 252);

  const criteria = [
    { label: 'Harga di atas MA150 dan MA200', ok: last.close > sma150 && last.close > sma200 },
    { label: 'MA150 di atas MA200', ok: sma150 > sma200 },
    { label: 'MA200 mulai naik', ok: Number.isFinite(sma200Past) && sma200 > sma200Past },
    { label: 'MA50 di atas MA150 dan MA200', ok: sma50 > sma150 && sma50 > sma200 },
    { label: 'Harga di atas MA50', ok: last.close > sma50 },
    { label: 'Harga minimal 25% di atas low 52 minggu', ok: low52 ? last.close >= low52 * 1.25 : false },
    { label: 'Harga dalam 25% dari high 52 minggu', ok: high52 ? last.close >= high52 * 0.75 : false }
  ].map(item => ({ ...item, ok: Boolean(item.ok) }));

  const passed = criteria.filter(item => item.ok).length;
  const score = clamp(Math.round((passed / criteria.length) * 100), 0, 100);

  return {
    label: passed >= 6 ? 'Trend Template lolos' : passed >= 4 ? 'Trend Template parsial' : 'Trend Template gagal',
    score,
    passed,
    total: criteria.length,
    criteria,
    dataNeeded: ['Relative strength ranking vs IHSG/universe belum tersedia dari API gratis.'],
    source: 'Mark Minervini Trend Template hlm 94'
  };
}

function evaluateBoxer(candles) {
  const last = candles.at(-1);
  const prev = candles.at(-2) || last;
  const avgVolume = priorAverage(candles, 20, candle => candle.volume || 0) || 1;
  const avgSpread = priorAverage(candles, 20, range) || range(last);
  const priorFiveVolume = mean(candles.slice(-6, -1).map(candle => candle.volume || 0)) || avgVolume;
  const priorFiveSpread = mean(candles.slice(-6, -1).map(range)) || avgSpread;
  const volumeRatio = (last.volume || 0) / avgVolume;
  const spreadRatio = range(last) / avgSpread;
  const resistance = highest(candles, 20, 'high', true) || last.high;
  const priceChange = pct(last.close, prev.close);
  const contractionBeforeBreakout = priorFiveVolume <= avgVolume * 0.9 && priorFiveSpread <= avgSpread * 0.92;
  const priceVolumeSurge = priceChange >= 2.5 && volumeRatio >= 1.6 && closePosition(last) >= 0.65;
  const breakout = last.close > resistance && volumeRatio >= 1.35;
  const flagThenBreakout = contractionBeforeBreakout && breakout;
  const active = priceVolumeSurge || flagThenBreakout;

  return {
    label: active ? 'Price-volume surge aktif' : contractionBeforeBreakout ? 'Low-volume ebb watch' : 'Belum ada surge',
    score: active ? 82 : contractionBeforeBreakout ? 64 : 48,
    active,
    priceVolumeSurge,
    flagThenBreakout,
    contractionBeforeBreakout,
    volumeRatio,
    spreadRatio,
    source: 'Harry Boxer hlm 25, 44-48, 60'
  };
}

function fundamentalGaps() {
  return [
    {
      name: 'Magic Formula',
      status: 'Butuh data',
      source: 'Joel Greenblatt hlm 64-70',
      data: 'Earnings yield dan return on capital membutuhkan EBIT/EPS, enterprise value, modal kerja, dan aset tetap.'
    },
    {
      name: 'Growth & scuttlebutt quality',
      status: 'Butuh validasi',
      source: 'Philip Fisher hlm 15-18, 100; Peter Lynch Indonesia hlm 39-43, 58, 72',
      data: 'Butuh pertumbuhan sales/laba beberapa tahun, margin, utang, manajemen, dan bukti ekspansi.'
    },
    {
      name: 'Rasio fundamental Indonesia',
      status: 'Butuh lapkeu',
      source: 'Rasio Penting Dalam Menilai Perusahaan hlm 1-2',
      data: 'EPS, PER, PBV, ROE, DER, operating cash flow, dan pertumbuhan minimal multi-tahun.'
    }
  ];
}

export function evaluateEbookStrategies(candles = []) {
  const clean = candles
    .filter(candle => Number.isFinite(candle?.open) && Number.isFinite(candle?.high) && Number.isFinite(candle?.low) && Number.isFinite(candle?.close))
    .map(candle => ({ ...candle, volume: Number.isFinite(candle.volume) ? candle.volume : 0 }));

  if (clean.length < 50) {
    return {
      available: false,
      score: 50,
      message: 'Butuh minimal 50 candle untuk membaca strategi e-book berbasis OHLCV.',
      fundamentalGaps: fundamentalGaps()
    };
  }

  const vpa = evaluateVpa(clean);
  const stage = evaluateWeinsteinStage(clean);
  const minervini = evaluateMinervini(clean);
  const boxer = evaluateBoxer(clean);
  const score = clamp(Math.round(
    vpa.score * 0.28
    + stage.score * 0.28
    + minervini.score * 0.26
    + boxer.score * 0.18
  ), 0, 100);

  return {
    available: true,
    score,
    label: score >= 78 ? 'E-book setup kuat' : score >= 62 ? 'E-book watchlist' : score >= 48 ? 'E-book netral' : 'E-book risk warning',
    vpa,
    stage,
    minervini,
    boxer,
    fundamentalGaps: fundamentalGaps()
  };
}
