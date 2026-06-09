import { ema, rsi, atr, macd, relativeVolume, supportResistance, mean, stochRsi, bollingerBands } from './indicators.js';
import { evaluateEbookStrategies } from './ebook-rules.js';

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const pct = (a, b) => b ? ((a - b) / b) * 100 : 0;
const lastDefined = values => [...values].reverse().find(v => v != null);
const body = c => Math.abs(c.close - c.open);
const range = c => Math.max(c.high - c.low, 1);
const upperWick = c => c.high - Math.max(c.open, c.close);
const lowerWick = c => Math.min(c.open, c.close) - c.low;
const bullish = c => c.close > c.open;
const bearish = c => c.close < c.open;
const smallBody = c => body(c) <= range(c) * 0.28;
const near = (value, target, tolerance = 0.11) => Math.abs(value - target) <= tolerance;
const between = (value, min, max) => value >= min && value <= max;

function scoreLabel(score) {
  if (score >= 82) return 'STRONG BUY';
  if (score >= 68) return 'WATCHLIST';
  if (score >= 55) return 'HOLD';
  return 'AVOID';
}

function buildModeScore({ mode, last, e9, e20, e50, e200, r, m, rv, breakout, changePct, volatilityPct, ebook, stoch, bb }) {
  let score = 45;
  const reasons = [];

  if (last.close > e20) {
    score += mode === 'day' ? 10 : 8;
    reasons.push('Harga berada di atas EMA 20.');
  } else {
    score -= 8;
    reasons.push('Harga masih di bawah EMA 20.');
  }

  if (e20 >= e50) {
    score += 10;
    reasons.push('EMA 20 berada di atas EMA 50.');
  }

  if (mode === 'day' && e9 >= e20) score += 8;
  if (mode === 'long' && e50 >= e200) {
    score += 14;
    reasons.push('EMA 50 menjaga tren panjang di atas EMA 200.');
  }

  if (r >= 48 && r <= 68) {
    score += mode === 'day' ? 7 : 12;
    reasons.push(`RSI ${r.toFixed(1)} sehat untuk momentum lanjutan.`);
  } else if (mode === 'day' && r > 68 && r <= 82) {
    score += 8;
    reasons.push(`RSI ${r.toFixed(1)} kuat untuk momentum cepat, tetapi perlu disiplin stop.`);
  } else if (r > 82) {
    score -= 8;
    reasons.push(`RSI ${r.toFixed(1)} sangat tinggi, risiko entry terlambat.`);
  }

  if ((m.histogram || 0) > 0) {
    score += 9;
    reasons.push('Histogram MACD positif.');
  }

  if (rv >= 1.5) {
    score += mode === 'day' ? 16 : 9;
    reasons.push(`Volume relatif ${rv.toFixed(2)}x mengonfirmasi aktivitas pasar.`);
  }

  if (breakout) {
    score += mode === 'day' ? 14 : 10;
    reasons.push('Harga menembus resistance terdekat.');
  }

  if (stoch && stoch.k != null && stoch.d != null) {
    if (stoch.k > stoch.d && stoch.k < 30) {
      score += mode === 'day' ? 12 : 8;
      reasons.push('Stochastic RSI Golden Cross di area Oversold (momentum balik arah naik sangat kuat).');
    } else if (stoch.k < stoch.d && stoch.k > 70) {
      score -= 15;
      reasons.push('Stochastic RSI Dead Cross di area Overbought (rawan koreksi/profit taking).');
    }
  }

  if (bb) {
    if (last.close > bb.upper && rv > 1.5) {
      score += mode === 'day' ? 8 : 5;
      reasons.push('Harga menembus Upper Bollinger Band disertai lonjakan volume (Volatilitas naik tajam).');
    } else if (last.close < bb.lower) {
      score -= 8;
      reasons.push('Harga menjebol Lower Bollinger Band ke bawah (tekanan jual kuat).');
    }
  }

  if (changePct > 0) score += mode === 'long' ? 3 : 8;
  if (mode === 'long' && volatilityPct > 8) {
    score -= 8;
    reasons.push('Volatilitas relatif tinggi untuk entry investasi.');
  }

  if (ebook?.available) {
    if (ebook.stage?.stage?.startsWith('Stage 2')) {
      score += mode === 'day' ? 3 : 8;
      reasons.push('Weinstein Stage 2: trend panjang sedang dalam fase advancing.');
    }
    if (ebook.stage?.stage?.startsWith('Stage 4')) {
      score -= mode === 'long' ? 14 : 8;
      reasons.push('Weinstein Stage 4: harga masih di bawah MA 30-minggu proxy.');
    }
    if (ebook.minervini?.passed >= 6) {
      score += mode === 'day' ? 2 : 8;
      reasons.push(`Minervini Trend Template lolos ${ebook.minervini.passed}/${ebook.minervini.total}.`);
    }
    if (ebook.vpa?.bias === 'bullish') {
      score += mode === 'day' ? 7 : 5;
      reasons.push(`VPA bullish: ${ebook.vpa.signals?.[0]?.name || 'volume memvalidasi harga'}.`);
    }
    if (ebook.vpa?.bias === 'bearish') {
      score -= mode === 'day' ? 9 : 7;
      reasons.push(`VPA warning: ${ebook.vpa.signals?.[0]?.name || 'anomali effort-result'}.`);
    }
    if (mode === 'day' && ebook.boxer?.active) {
      score += 7;
      reasons.push('Boxer price-volume surge aktif untuk momentum cepat.');
    }
  }

  score = clamp(Math.round(score), 0, 100);
  return { score, label: scoreLabel(score), reasons };
}

function detectCandlePatterns(candles) {
  const patterns = [];
  const start = Math.max(2, candles.length - 90);

  for (let i = start; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1], p2 = candles[i - 2];
    const prevDown = p2 && p.close < p2.close;
    const prevUp = p2 && p.close > p2.close;
    const add = (name, bias, strength, description) => {
      patterns.push({ index: i, time: c.time, date: c.date, name, bias, strength, description });
    };

    if (bearish(p) && bullish(c) && c.open <= p.close && c.close >= p.open) {
      add('Bullish Engulfing', 'bullish', 4, 'Body candle terbaru menelan body candle bearish sebelumnya.');
    }
    if (bullish(p) && bearish(c) && c.open >= p.close && c.close <= p.open) {
      add('Bearish Engulfing', 'bearish', 4, 'Body candle bearish menelan body candle bullish sebelumnya.');
    }
    if (bearish(p) && bullish(c) && c.open < p.low && c.close > (p.open + p.close) / 2 && c.close < p.open) {
      add('Piercing Line', 'bullish', 3, 'Candle bullish menusuk lebih dari setengah body bearish sebelumnya.');
    }
    if (p2 && bearish(p2) && smallBody(p) && bullish(c) && c.close > (p2.open + p2.close) / 2) {
      add(smallBody(p) && body(p) <= range(p) * 0.12 ? 'Morning Doji Star' : 'Morning Star', 'bullish', 4, 'Reversal tiga candle setelah tekanan turun.');
    }
    if (p2 && bullish(p2) && smallBody(p) && bearish(c) && c.close < (p2.open + p2.close) / 2) {
      add('Evening Star', 'bearish', 4, 'Reversal tiga candle setelah tekanan naik.');
    }
    if (bullish(c) && lowerWick(c) >= body(c) * 2 && upperWick(c) <= body(c) * 0.8 && prevDown) {
      add('Hammer', 'bullish', 3, 'Lower wick panjang menunjukkan rejection bawah.');
    }
    if (bearish(c) && upperWick(c) >= body(c) * 2 && lowerWick(c) <= body(c) * 0.8 && prevUp) {
      add('Shooting Star', 'bearish', 3, 'Upper wick panjang menunjukkan rejection atas.');
    }
    if (body(c) <= range(c) * 0.1) {
      add('Doji', 'neutral', 2, 'Open dan close hampir sama, pasar ragu.');
    }
    if (i >= 2) {
      const a = candles[i - 2], b = candles[i - 1];
      if ([a, b, c].every(bullish) && b.close > a.close && c.close > b.close && [a, b, c].every(x => body(x) >= range(x) * 0.45)) {
        add('Three White Soldiers', 'bullish', 5, 'Tiga candle bullish berurutan dengan close makin tinggi.');
      }
      if (candles[i - 4]) {
        const c1 = candles[i - 4], c2 = candles[i - 3], c3 = candles[i - 2], c4 = candles[i - 1], c5 = c;
        const inside = [c2, c3, c4].every(x => x.high < c1.high && x.low > c1.low);
        if (bullish(c1) && [c2, c3, c4].every(bearish) && inside && bullish(c5) && c5.close > c1.close) {
          add('Rising Three Methods', 'bullish', 5, 'Continuation bullish: konsolidasi kecil lalu breakout naik.');
        }
      }
    }
  }

  return patterns;
}

function detectPivots(candles, depth = 4) {
  const pivots = [];
  for (let i = depth; i < candles.length - depth; i++) {
    const slice = candles.slice(i - depth, i + depth + 1);
    const high = Math.max(...slice.map(c => c.high));
    const low = Math.min(...slice.map(c => c.low));
    if (candles[i].high === high) pivots.push({ index: i, time: candles[i].time, date: candles[i].date, price: candles[i].high, type: 'high' });
    if (candles[i].low === low) pivots.push({ index: i, time: candles[i].time, date: candles[i].date, price: candles[i].low, type: 'low' });
  }

  return pivots.reduce((out, pivot) => {
    const prev = out.at(-1);
    if (!prev || prev.type !== pivot.type) return [...out, pivot];
    const stronger = pivot.type === 'high' ? pivot.price > prev.price : pivot.price < prev.price;
    if (stronger) out[out.length - 1] = pivot;
    return out;
  }, []);
}

function detectHarmonicPatterns(candles) {
  const pivots = detectPivots(candles).slice(-24);
  const patterns = [];
  const add = (points, name, bias, ratios, score) => {
    const d = points[4];
    patterns.push({
      date: d.date,
      name,
      bias,
      score,
      ratios,
      description: `${bias === 'bullish' ? 'Bullish' : 'Bearish'} ${name} XABCD mendekati rasio Fibonacci harmonic.`,
      points: points.map((point, i) => ({ ...point, label: ['X', 'A', 'B', 'C', 'D'][i] }))
    });
  };

  for (let i = 0; i <= pivots.length - 5; i++) {
    const points = pivots.slice(i, i + 5);
    if (!points.every((point, idx) => idx === 0 || point.type !== points[idx - 1].type)) continue;

    const [x, a, b, c, d] = points;
    const bullishShape = x.type === 'low' && a.type === 'high' && b.type === 'low' && c.type === 'high' && d.type === 'low';
    const bearishShape = x.type === 'high' && a.type === 'low' && b.type === 'high' && c.type === 'low' && d.type === 'high';
    if (!bullishShape && !bearishShape) continue;

    const xa = Math.abs(a.price - x.price);
    const ab = Math.abs(b.price - a.price);
    const bc = Math.abs(c.price - b.price);
    const cd = Math.abs(d.price - c.price);
    const ad = Math.abs(a.price - d.price);
    if (!xa || !ab || !bc) continue;

    const ratios = {
      abXa: ab / xa,
      bcAb: bc / ab,
      cdBc: cd / bc,
      adXa: ad / xa,
      xdXa: Math.abs(d.price - x.price) / xa
    };
    const bias = bullishShape ? 'bullish' : 'bearish';
    const recencyScore = d.index >= candles.length - 18 ? 2 : 0;

    if (near(ratios.abXa, 0.618, 0.12) && between(ratios.bcAb, 0.382, 0.886) && between(ratios.cdBc, 1.13, 1.75) && near(ratios.adXa, 0.786, 0.16)) {
      add(points, 'Gartley', bias, ratios, 8 + recencyScore);
    }
    if (between(ratios.abXa, 0.32, 0.55) && between(ratios.bcAb, 0.382, 0.886) && between(ratios.cdBc, 1.45, 2.8) && near(ratios.adXa, 0.886, 0.18)) {
      add(points, 'Bat', bias, ratios, 8 + recencyScore);
    }
    if (near(ratios.abXa, 0.786, 0.14) && between(ratios.bcAb, 0.382, 0.886) && between(ratios.cdBc, 1.45, 2.35) && between(ratios.adXa, 1.18, 1.72)) {
      add(points, 'Butterfly', bias, ratios, 8 + recencyScore);
    }
    if (between(ratios.abXa, 0.32, 0.68) && between(ratios.bcAb, 0.382, 0.886) && between(ratios.cdBc, 2.0, 3.85) && between(ratios.adXa, 1.35, 1.9)) {
      add(points, 'Crab', bias, ratios, 8 + recencyScore);
    }
  }

  return patterns.sort((a, b) => a.points.at(-1).index - b.points.at(-1).index || b.score - a.score).slice(-5);
}

export function analyze(candles, options = {}) {
  const minCandles = options.mode === 'day' ? 30 : 50;
  if (!Array.isArray(candles) || candles.length < minCandles) {
    throw new Error(`Minimal ${minCandles} candle diperlukan untuk analisis yang layak.`);
  }

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume || 0);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const last = candles.at(-1);
  const prev = candles.at(-2);
  const e9 = lastDefined(ema(closes, 9));
  const e20 = lastDefined(ema(closes, 20));
  const e50 = lastDefined(ema(closes, 50)) || e20;
  const e200 = lastDefined(ema(closes, 200)) || e50;
  const r = rsi(closes) || 50;
  const m = macd(closes);
  const a = atr(candles) || Math.max(last.high - last.low, 1);
  const rv = relativeVolume(volumes) || 1;
  const sr = supportResistance(candles, Math.min(30, candles.length));
  const changePct = pct(last.close, prev.close);
  const rangePct = last.close ? ((last.high - last.low) / last.close) * 100 : 0;
  const volatilityPct = last.close ? (a / last.close) * 100 : 0;
  const avgClose = mean(closes.slice(-60));
  const avgVolume = mean(volumes.slice(-20));
  const breakout = last.close > sr.resistance;
  const patterns = detectCandlePatterns(candles);
  const latestPatterns = patterns.slice(-5);
  const harmonicPatterns = detectHarmonicPatterns(candles);
  const ebook = evaluateEbookStrategies(candles);
  const trend = last.close > e20 && e20 >= e50 ? 'Uptrend' : last.close < e20 && e20 <= e50 ? 'Downtrend' : 'Sideways';
  const technicalFairValue = [
    e20 * 0.35,
    e50 * 0.3,
    avgClose * 0.2,
    sr.support * 0.075,
    sr.resistance * 0.075
  ].filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
  const fairGapPct = pct(last.close, technicalFairValue);

  const stoch = stochRsi(closes);
  const bb = bollingerBands(closes);

  const scoreContext = { last, e9, e20, e50, e200, r, m, rv, breakout, changePct, volatilityPct, ebook, stoch, bb };
  const day = buildModeScore({ mode: 'day', ...scoreContext });
  const swing = buildModeScore({ mode: 'swing', ...scoreContext });
  const long = buildModeScore({ mode: 'long', ...scoreContext });
  const baggerScore = clamp(Math.round(
    long.score * 0.46
    + swing.score * 0.24
    + (trend === 'Uptrend' ? 10 : 0)
    + (fairGapPct < -8 ? 8 : 0)
    + (rv >= 1.4 ? 7 : 0)
    + (volatilityPct <= 7 ? 5 : -3)
  ), 0, 100);
  const bagger = {
    score: baggerScore,
    label: baggerScore >= 82 ? 'POTENTIAL BAGGER' : baggerScore >= 70 ? 'BAGGER WATCH' : 'MONITOR',
    reasons: [
      baggerScore >= 70 ? 'Trend dan likuiditas cukup menarik untuk dipantau sebagai kandidat multi-bagger.' : 'Sinyal multi-bagger belum kuat dari data harga.',
      fairGapPct < -8 ? 'Harga relatif di bawah fair value teknikal proxy.' : 'Belum terlihat diskon teknikal yang kuat.',
      rv >= 1.4 ? 'Ada peningkatan aktivitas volume.' : 'Volume belum menunjukkan akumulasi besar.',
      'Validasi tetap perlu memakai laporan keuangan, aksi korporasi, dan berita ekspansi.'
    ]
  };
  const best = [
    { mode: 'Day Trade', ...day },
    { mode: 'Swing Trade', ...swing },
    { mode: 'Long Term', ...long },
    { mode: 'Potential Bagger', ...bagger }
  ].sort((aScore, bScore) => bScore.score - aScore.score)[0];

  const stopDay = Math.max(sr.support, last.close - a * 0.8);
  const stopSwing = Math.max(sr.support * 0.98, last.close - a * 1.8);
  const riskDay = Math.max(last.close - stopDay, a * 0.25);
  const riskSwing = Math.max(last.close - stopSwing, a * 0.5);
  const riskTechnical = clamp(Math.round(volatilityPct * 1.6 + (r > 78 ? 2 : 0) + (trend === 'Downtrend' ? 2 : 0)), 1, 10);
  const riskValuation = clamp(Math.round(5 + fairGapPct / 8), 1, 10);
  const riskMarket = clamp(Math.round(5 + (rangePct > volatilityPct ? 1 : 0) - (rv > 1.5 ? 1 : 0)), 1, 10);
  const timing = clamp(Math.round((day.score + swing.score) / 20 - riskTechnical / 3 + 4), 1, 10);
  const overall = Math.round((day.score * 0.28 + swing.score * 0.42 + long.score * 0.3));

  return {
    last,
    prev,
    e9,
    e20,
    e50,
    e200,
    rsi: r,
    macd: m,
    atr: a,
    rvol: rv,
    avgVolume,
    support: sr.support,
    resistance: sr.resistance,
    score: overall,
    label: scoreLabel(overall),
    reasons: swing.reasons,
    trend,
    changePct,
    volatilityPct,
    rangePct,
    breakout,
    patterns,
    latestPatterns,
    harmonicPatterns,
    ebook,
    fairValue: technicalFairValue,
    fairGapPct,
    bestMode: best.mode,
    modes: { day, swing, long, bagger },
    baggerSetup: {
      accumulationZone: Math.min(last.close, Math.max(e50, sr.support)),
      confirmationLevel: sr.resistance + a * 0.1,
      invalidation: Math.min(e50, stopSwing),
      expansionChecklist: [
        'Pertumbuhan laba/pendapatan di laporan keuangan terbaru',
        'Capex, kontrak baru, akuisisi, atau pembukaan lini bisnis',
        'Volume akumulasi dan trend panjang tetap bertahan',
        'Utang dan arus kas tidak memburuk'
      ]
    },
    daySetup: {
      buyOnWeakness: Math.max(e9, last.close - a * 0.35),
      breakoutEntry: sr.resistance + a * 0.05,
      stop: stopDay,
      target1: last.close + riskDay * 1.2,
      target2: last.close + riskDay * 1.8
    },
    swingSetup: {
      buyOnPullback: Math.max(e20, last.close - a * 0.65),
      aggressiveEntry: last.close,
      stop: stopSwing,
      target1: last.close + riskSwing * 1.5,
      target2: last.close + riskSwing * 2.2,
      target3: last.close + riskSwing * 3
    },
    risk: {
      technical: riskTechnical,
      valuation: riskValuation,
      market: riskMarket,
      level: riskTechnical + riskValuation + riskMarket >= 22 ? 'TINGGI' : riskTechnical + riskValuation + riskMarket >= 15 ? 'SEDANG' : 'RENDAH'
    },
    quality: {
      profitability: clamp(Math.round((long.score - volatilityPct) / 12), 1, 10),
      growth: clamp(Math.round((swing.score + Math.max(changePct, 0)) / 12), 1, 10),
      stability: clamp(Math.round(10 - volatilityPct / 1.6), 1, 10),
      liquidity: clamp(Math.round(Math.log10(Math.max(avgVolume || 1, 1)) - 1), 1, 10)
    },
    timing
  };
}
