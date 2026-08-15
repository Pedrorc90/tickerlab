import { Candle } from '../market.models';

/** One bar of the three lines. `middle` is the plain moving average of the close. */
export interface BollingerPoint {
  time: number;
  upper: number;
  middle: number;
  lower: number;
}

/**
 * Rolling mean and standard deviation of the close in one pass: the sum of squares keeps
 * the cost linear. `Math.max` guards the variance from the rounding noise a rolling sum
 * leaves behind — a flat window can land a hair below zero and `sqrt` would return NaN.
 * The first `period - 1` bars produce no value.
 */
export function bollingerBands(
  candles: Candle[],
  period: number,
  deviations: number,
): BollingerPoint[] {
  if (candles.length < period) {
    return [];
  }

  const points: BollingerPoint[] = [];
  let sum = 0;
  let sumOfSquares = 0;

  for (let i = 0; i < candles.length; i++) {
    const { close } = candles[i];
    sum += close;
    sumOfSquares += close * close;

    if (i >= period) {
      const dropped = candles[i - period].close;
      sum -= dropped;
      sumOfSquares -= dropped * dropped;
    }

    if (i >= period - 1) {
      const middle = sum / period;
      const variance = Math.max(0, sumOfSquares / period - middle * middle);
      const offset = deviations * Math.sqrt(variance);
      points.push({
        time: candles[i].time,
        upper: middle + offset,
        middle,
        lower: middle - offset,
      });
    }
  }

  return points;
}
