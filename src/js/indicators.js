export const mean = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
export function ema(values, period){if(values.length<period)return[];const k=2/(period+1);const out=Array(period-1).fill(null);let prev=mean(values.slice(0,period));out.push(prev);for(let i=period;i<values.length;i++){prev=values[i]*k+prev*(1-k);out.push(prev)}return out}
export function sma(values,period){return values.map((_,i)=>i<period-1?null:mean(values.slice(i-period+1,i+1)))}
export function rsiArray(values, period=14) {
  if (values.length <= period) return [];
  const out = Array(period).fill(null);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let ag = gains / period, al = losses / period;
  out.push(al === 0 ? 100 : 100 - (100 / (1 + ag / al)));
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    out.push(al === 0 ? 100 : 100 - (100 / (1 + ag / al)));
  }
  return out;
}
export function rsi(values,period=14){const arr=rsiArray(values,period);return arr.length?arr.at(-1):null}
export function stochRsi(values, rsiPeriod=14, stochPeriod=14, kPeriod=3, dPeriod=3) {
  const rsiVals = rsiArray(values, rsiPeriod);
  if (rsiVals.length <= stochPeriod) return {k:null, d:null};
  const stoch = rsiVals.map((r, i) => {
    if (i < stochPeriod - 1 || r == null) return null;
    const window = rsiVals.slice(i - stochPeriod + 1, i + 1).filter(v=>v!=null);
    if (!window.length) return null;
    const highest = Math.max(...window);
    const lowest = Math.min(...window);
    if (highest === lowest) return 0;
    return ((r - lowest) / (highest - lowest)) * 100;
  });
  const k = sma(stoch.filter(v => v !== null), kPeriod);
  const d = sma(k.filter(v => v !== null), dPeriod);
  return { k: k.length ? k.at(-1) : null, d: d.length ? d.at(-1) : null };
}
export function bollingerBands(values, period=20, stdDev=2) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  const avg = mean(slice);
  const variance = mean(slice.map(v => Math.pow(v - avg, 2)));
  const sd = Math.sqrt(variance);
  return { upper: avg + stdDev * sd, middle: avg, lower: avg - stdDev * sd };
}
export function atr(candles,period=14){if(candles.length<=period)return null;const tr=[];for(let i=1;i<candles.length;i++){tr.push(Math.max(candles[i].high-candles[i].low,Math.abs(candles[i].high-candles[i-1].close),Math.abs(candles[i].low-candles[i-1].close)))}return mean(tr.slice(-period))}
export function macd(values){const e12=ema(values,12),e26=ema(values,26);const line=values.map((_,i)=>e12[i]!=null&&e26[i]!=null?e12[i]-e26[i]:null);const valid=line.filter(v=>v!=null);const sig=ema(valid,9);const last=line.at(-1),signal=sig.at(-1);return{line:last,signal,histogram:last!=null&&signal!=null?last-signal:null}}
export function relativeVolume(volumes,period=20){if(volumes.length<period+1)return null;const avg=mean(volumes.slice(-(period+1),-1));return avg?volumes.at(-1)/avg:null}
export function supportResistance(candles,lookback=20){
  if(candles.length<5)return{support:candles.at(-1).low,resistance:candles.at(-1).high};
  const data=candles.slice(-Math.max(lookback,60));
  let support=Math.min(...candles.slice(-lookback).map(c=>c.low));
  let resistance=Math.max(...candles.slice(-lookback).slice(0,-1).map(c=>c.high));
  let highs=[],lows=[];
  for(let i=2;i<data.length-2;i++){
    if(data[i].high>data[i-1].high&&data[i].high>data[i-2].high&&data[i].high>data[i+1].high&&data[i].high>data[i+2].high) highs.push(data[i].high);
    if(data[i].low<data[i-1].low&&data[i].low<data[i-2].low&&data[i].low<data[i+1].low&&data[i].low<data[i+2].low) lows.push(data[i].low);
  }
  if(highs.length) resistance=Math.min(Math.max(...highs.slice(-3)),resistance);
  if(lows.length) support=Math.max(Math.min(...lows.slice(-3)),support);
  return {support,resistance};
}
