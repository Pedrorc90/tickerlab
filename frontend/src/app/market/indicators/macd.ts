import { Candle } from '../market.models';

/** The textbook MACD settings: 12/26 for the two EMAs, 9 for the signal line. */
export const MACD_FAST = 12;
export const MACD_SLOW = 26;
export const MACD_SIGNAL = 9;

export interface MacdPoint {
  time: number;
  /** Fast EMA minus slow EMA. */
  macd: number;
  /** EMA of the MACD line. */
  signal: number;
  /** macd - signal: the bars that cross zero when the two lines cross. */
  histogram: number;
}

/**
 * Moving Average Convergence Divergence. The signal line is an EMA *of the MACD line*,
 * so it only starts once the MACD line itself has enough points — the result skips
 * roughly `slow + signal` bars from the start.
 */
export function macd(
  candles: Candle[],
  fast = MACD_FAST,
  slow = MACD_SLOW,
  signalPeriod = MACD_SIGNAL,
): MacdPoint[] {
  const closes = candles.map((candle) => candle.close);
  const fastEma = exponentialMovingAverage(closes, fast);
  const slowEma = exponentialMovingAverage(closes, slow);

  const line: number[] = [];
  const times: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const quick = fastEma[i];
    const slowValue = slowEma[i];
    if (quick === undefined || slowValue === undefined) {
      continue;
    }
    line.push(quick - slowValue);
    times.push(candles[i].time);
  }

  const signalEma = exponentialMovingAverage(line, signalPeriod);

  const points: MacdPoint[] = [];
  for (let i = 0; i < line.length; i++) {
    const signal = signalEma[i];
    if (signal === undefined) {
      continue;
    }
    points.push({ time: times[i], macd: line[i], signal, histogram: line[i] - signal });
  }

  return points;
}

/**
 * EMA aligned to the input array: the first `period - 1` slots stay undefined, and the
 * first real value is a plain mean so the average has somewhere to start from.
 */
function exponentialMovingAverage(values: number[], period: number): (number | undefined)[] {
  const result: (number | undefined)[] = new Array<number | undefined>(values.length).fill(undefined);
  if (values.length < period) {
    return result;
  }

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }

  let previous = sum / period;
  result[period - 1] = previous;

  const multiplier = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    previous = (values[i] - previous) * multiplier + previous;
    result[i] = previous;
  }

  return result;
}
