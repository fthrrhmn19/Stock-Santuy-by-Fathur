import assert from 'node:assert/strict';
import { analyze } from '../src/js/analysis.js';
import { evaluateEbookStrategies } from '../src/js/ebook-rules.js';

function candle(index, close, volume = 1_000_000) {
  const open = index === 0 ? close * 0.995 : close * 0.99;
  return {
    date: new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10),
    open,
    high: Math.max(open, close) * 1.015,
    low: Math.min(open, close) * 0.985,
    close,
    volume
  };
}

const rising = Array.from({ length: 260 }, (_, index) => {
  const close = 100 + index * 1.15 + Math.sin(index / 6) * 2;
  return candle(index, close, 1_000_000 + index * 1_500);
});

const risingEbook = evaluateEbookStrategies(rising);
assert.equal(risingEbook.available, true);
assert.match(risingEbook.stage.stage, /Stage 2/);
assert.ok(risingEbook.minervini.passed >= 6, 'rising series should pass most Minervini criteria');

const risingAnalysis = analyze(rising, { mode: 'swing' });
assert.ok(risingAnalysis.ebook.score >= 70, 'rising series should receive a strong ebook score');
assert.ok(risingAnalysis.modes.long.score >= 70, 'ebook Stage/Trend should support long-term score');

const downtrend = Array.from({ length: 80 }, (_, index) => candle(index, 250 - index * 1.2, 900_000));
downtrend.push({
  date: '2024-03-25',
  open: 155,
  high: 158,
  low: 136,
  close: 149,
  volume: 2_800_000
});

const vpa = evaluateEbookStrategies(downtrend).vpa;
assert.ok(vpa.signals.some(signal => signal.name === 'Stopping volume watch'), 'high-volume lower-wick selloff should trigger stopping volume watch');

console.log('analysis tests passed');
