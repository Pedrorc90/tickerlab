import { Candle, IndicatorPoint } from '../market.models';

/** The two moving averages every chart shows: the medium trend and the long one. */
export const SMA_FAST = 50;
export const SMA_SLOW = 200;

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
