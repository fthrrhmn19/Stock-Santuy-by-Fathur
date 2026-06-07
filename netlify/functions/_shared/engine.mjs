import { evaluateEbookStrategies } from '../../../src/js/ebook-rules.js';

const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const ema = (values, period) => {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out = Array(period - 1).fill(null);
  let prev = mean(values.slice(0, period));
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
};

const rsi = (values, period = 14) => {
  if (values.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let ag = gains / period, al = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (al === 0) return 100;
  return 100 - (100 / (1 + ag / al));
};

const atr = (candles, period = 14) => {
  if (candles.length <= period) return null;
  const tr = [];
  for (let i = 1; i < candles.length; i++) {
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    ));
  }
  return mean(tr.slice(-period));
};

const macd = values => {
  const e12 = ema(values, 12);
  const e26 = ema(values, 26);
  const line = values.map((_, i) => e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null);
  const valid = line.filter(v => v != null);
  const sig = ema(valid, 9);
  const last = line.at(-1), signal = sig.at(-1);
  return { line: last, signal, histogram: last != null && signal != null ? last - signal : null };
};

const relativeVolume = (volumes, period = 20) => {
  if (volumes.length < period + 1) return null;
  const avg = mean(volumes.slice(-(period + 1), -1));
  return avg ? volumes.at(-1) / avg : null;
};

const supportResistance = (candles, lookback = 20) => {
  const data = candles.slice(-lookback);
  const prior = data.slice(0, -1);
  return {
    support: Math.min(...data.map(c => c.low)),
    resistance: Math.max(...(prior.length ? prior : data).map(c => c.high))
  };
};

export function analyzeForScan(candles, mode = 'swing') {
  if (!Array.isArray(candles) || candles.length < 30) return null;

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume || 0);
  const last = candles.at(-1);
  const prev = candles.at(-2);
  const e9 = ema(closes, 9).at(-1);
  const e20 = ema(closes, 20).at(-1);
  const e50 = ema(closes, 50).at(-1) || e20;
  const e200 = ema(closes, 200).at(-1) || e50;
  const r = rsi(closes) || 50;
  const m = macd(closes);
  const a = atr(candles) || Math.max(last.high - last.low, 1);
  const rv = relativeVolume(volumes) || 1;
  const sr = supportResistance(candles);
  const changePct = prev?.close ? ((last.close - prev.close) / prev.close) * 100 : 0;
  const breakout = last.close > sr.resistance;
  const trend = last.close > e20 && e20 >= e50 ? 'uptrend' : last.close < e20 && e20 <= e50 ? 'downtrend' : 'sideways';
  const volatilityPct = a && last.close ? (a / last.close) * 100 : 0;
  const ebook = evaluateEbookStrategies(candles);

  let score = 45;
  if (trend === 'uptrend') score += 18;
  if (last.close > e20) score += 8;
  if (e20 > e50) score += 8;
  if (mode === 'long' && e50 >= e200) score += 12;
  if (r >= 48 && r <= 68) score += mode === 'day' ? 7 : 11;
  if (mode === 'day' && r > 68 && r <= 82) score += 8;
  if (r > 82) score -= 8;
  if ((m.histogram || 0) > 0) score += 9;
  if (rv >= 1.5) score += mode === 'day' ? 16 : 9;
  if (breakout) score += mode === 'day' ? 14 : 10;
  if (changePct > 0) score += mode === 'long' ? 3 : 8;
  if (mode === 'long' && volatilityPct > 8) score -= 8;
  if (ebook?.available) {
    if (ebook.stage?.stage?.startsWith('Stage 2')) score += mode === 'day' ? 3 : 8;
    if (ebook.stage?.stage?.startsWith('Stage 4')) score -= mode === 'long' ? 14 : 8;
    if (ebook.minervini?.passed >= 6) score += mode === 'day' ? 2 : 8;
    if (ebook.vpa?.bias === 'bullish') score += mode === 'day' ? 7 : 5;
    if (ebook.vpa?.bias === 'bearish') score -= mode === 'day' ? 9 : 7;
    if (mode === 'day' && ebook.boxer?.active) score += 7;
  }

  score = clamp(Math.round(score), 0, 100);
  const label = score >= 82 ? 'Strong Buy' : score >= 68 ? 'Watchlist' : score >= 55 ? 'Hold' : 'Avoid';

  return {
    score,
    label,
    trend,
    rsi: r,
    rvol: rv,
    changePct,
    breakout,
    volatilityPct,
    price: last.close,
    support: sr.support,
    resistance: sr.resistance,
    volume: last.volume || 0,
    statusVolume: rv >= 1.5 ? 'Volume Spike' : 'Normal Volume',
    ebook
  };
}
