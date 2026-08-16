import { Candle, IndicatorPoint } from '../market.models';

/** The two moving averages every chart shows: the medium trend and the long one. */
export const SMA_FAST = 50;
export const SMA_SLOW = 200;

/** The exponential pair: shorter on purpose, they are there to turn before the SMAs do. */
export const EMA_FAST = 20;
export const EMA_SLOW = 50;

/** Simple moving average of the close: the trend line drawn over the candles. */
export function simpleMovingAverage(candles: Candle[], period: number): IndicatorPoint[] {
  return rollingMean(candles, period, (candle) => candle.close);
}

/**
 * The same average over the traded volume. It turns the volume pane into a signal:
 * a bar well above its own average is what "unusual volume" actually means.
 */
export function volumeMovingAverage(candles: Candle[], period: number): IndicatorPoint[] {
  return rollingMean(candles, period, (candle) => candle.volume);
}

/**
 * Exponential moving average of the close: the same trend line, weighted towards the last
 * bars, so it bends earlier than the simple one. Seeded with the simple average of the first
 * `period` closes — the textbook seed, and it keeps the series starting on the same bar
 * as its simple twin.
 */
export function exponentialMovingAverage(candles: Candle[], period: number): IndicatorPoint[] {
  if (candles.length < period) {
    return [];
  }

  const weight = 2 / (period + 1);
  const points: IndicatorPoint[] = [];
  let average = 0;

  for (let i = 0; i < period; i++) {
    average += candles[i].close / period;
  }
  points.push({ time: candles[period - 1].time, value: average });

  for (let i = period; i < candles.length; i++) {
    average = candles[i].close * weight + average * (1 - weight);
    points.push({ time: candles[i].time, value: average });
  }

  return points;
}

/**
 * Kept as a rolling sum so the cost stays linear.
 * The first `period - 1` bars produce no value.
 */
function rollingMean(
  candles: Candle[],
  period: number,
  pick: (candle: Candle) => number,
): IndicatorPoint[] {
  if (candles.length < period) {
    return [];
  }

  const points: IndicatorPoint[] = [];
  let sum = 0;

  for (let i = 0; i < candles.length; i++) {
    sum += pick(candles[i]);
    if (i >= period) {
      sum -= pick(candles[i - period]);
    }
    if (i >= period - 1) {
      points.push({ time: candles[i].time, value: sum / period });
    }
  }

  return points;
}
