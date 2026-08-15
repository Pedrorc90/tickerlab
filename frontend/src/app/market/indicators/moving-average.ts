import { Candle, IndicatorPoint } from '../market.models';

/** The two moving averages every chart shows: the medium trend and the long one. */
export const SMA_FAST = 50;
export const SMA_SLOW = 200;

/**
 * Simple moving average of the close, kept as a rolling sum so the cost stays linear.
 * The first `period - 1` bars produce no value.
 */
export function simpleMovingAverage(candles: Candle[], period: number): IndicatorPoint[] {
  if (candles.length < period) {
    return [];
  }

  const points: IndicatorPoint[] = [];
  let sum = 0;

  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) {
      sum -= candles[i - period].close;
    }
    if (i >= period - 1) {
      points.push({ time: candles[i].time, value: sum / period });
    }
  }

  return points;
}
