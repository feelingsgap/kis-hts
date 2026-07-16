// 차트 보조지표 계산 (auto-trading chart_indicators.py와 동일 방식)
type Num = number | null;

export function sma(closes: number[], period: number): Num[] {
  const n = closes.length;
  const r: Num[] = new Array(n).fill(null);
  if (n < period) return r;
  let s = 0;
  for (let i = 0; i < period; i++) s += closes[i];
  r[period - 1] = s / period;
  for (let i = period; i < n; i++) {
    s += closes[i] - closes[i - period];
    r[i] = s / period;
  }
  return r;
}

export function ema(closes: number[], period: number): Num[] {
  const n = closes.length;
  const r: Num[] = new Array(n).fill(null);
  if (n < period) return r;
  const k = 2 / (period + 1);
  let e = 0;
  for (let i = 0; i < period; i++) e += closes[i];
  e /= period;
  r[period - 1] = e;
  for (let i = period; i < n; i++) {
    e = closes[i] * k + e * (1 - k);
    r[i] = e;
  }
  return r;
}

// 볼린저 밴드: SMA(period) ± mult·σ (모집단 표준편차)
export function bollinger(closes: number[], period = 20, mult = 2): {
  upper: Num[];
  mid: Num[];
  lower: Num[];
} {
  const n = closes.length;
  const upper: Num[] = new Array(n).fill(null);
  const mid: Num[] = new Array(n).fill(null);
  const lower: Num[] = new Array(n).fill(null);
  if (n < period) return { upper, mid, lower };
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const mean = sum / period;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (closes[j] - mean) ** 2;
    v /= period;
    const sig = Math.sqrt(v);
    mid[i] = mean;
    upper[i] = mean + mult * sig;
    lower[i] = mean - mult * sig;
  }
  return { upper, mid, lower };
}

// RSI (Wilder smoothing)
export function rsi(closes: number[], period = 14): Num[] {
  const n = closes.length;
  const r: Num[] = new Array(n).fill(null);
  if (n <= period) return r;
  let ag = 0;
  let al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    ag += Math.max(d, 0);
    al += Math.max(-d, 0);
  }
  ag /= period;
  al /= period;
  r[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    r[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return r;
}

// MACD (12, 26, 9)
export function macd(closes: number[], fast = 12, slow = 26, sig = 9): {
  line: Num[];
  signal: Num[];
  hist: Num[];
} {
  const n = closes.length;
  const line: Num[] = new Array(n).fill(null);
  const signal: Num[] = new Array(n).fill(null);
  const hist: Num[] = new Array(n).fill(null);
  if (n < slow) return { line, signal, hist };
  const fk = 2 / (fast + 1);
  const sk = 2 / (slow + 1);
  const gk = 2 / (sig + 1);
  let fe = 0;
  for (let i = 0; i < fast; i++) fe += closes[i];
  fe /= fast;
  let se = 0;
  for (let i = 0; i < slow; i++) se += closes[i];
  se /= slow;
  for (let i = fast; i < slow; i++) fe = closes[i] * fk + fe * (1 - fk);
  let mv = fe - se;
  line[slow - 1] = mv;
  const buf: number[] = [mv];
  for (let i = slow; i < n; i++) {
    fe = closes[i] * fk + fe * (1 - fk);
    se = closes[i] * sk + se * (1 - sk);
    mv = fe - se;
    line[i] = mv;
    buf.push(mv);
  }
  if (buf.length >= sig) {
    let ge = 0;
    for (let i = 0; i < sig; i++) ge += buf[i];
    ge /= sig;
    const start = slow - 1 + sig - 1;
    signal[start] = ge;
    hist[start] = (line[start] ?? 0) - ge;
    for (let j = start + 1; j < n; j++) {
      const m = line[j];
      if (m == null) break;
      ge = m * gk + ge * (1 - gk);
      signal[j] = ge;
      hist[j] = m - ge;
    }
  }
  return { line, signal, hist };
}
