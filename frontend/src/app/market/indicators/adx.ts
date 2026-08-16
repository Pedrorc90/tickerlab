import { Candle } from '../market.models';

/** Wilder's own period, and the one every platform defaults to. */
export const ADX_PERIOD = 14;

/** Above this the trend is worth trading; below 20 the price is going sideways. */
export const ADX_TREND_THRESHOLD = 25;

/** One bar of the directional system. `adx` only exists once enough DI values piled up. */
export interface AdxPoint {
  time: number;
  plusDi: number;
  minusDi: number;
  adx: number | null;
}

/**
 * Average Directional Index with the +DI/-DI pair it comes from. Each bar is scored by which
 * side of it stuck out further than yesterday's: a wider high is buying pressure, a lower low
 * is selling pressure, and only the larger of the two counts — a bar that widened both ways
 * says nothing about direction.
 *
 * Everything is smoothed the way Wilder did it (accumulate `period` bars, then keep a running
 * average that drops a `1/period` slice each step). The DIs start at `candles[period]`; the ADX
 * is a second smoothing on top, so it only starts `period` bars later still.
 */
export function averageDirectionalIndex(candles: Candle[], period = ADX_PERIOD): AdxPoint[] {
  if (candles.length <= period) {
    return [];
  }

  let trueRange = 0;
  let plusMovement = 0;
  let minusMovement = 0;
  for (let i = 1; i <= period; i++) {
    trueRange += barTrueRange(candles[i], candles[i - 1]);
    plusMovement += plusDirectionalMovement(candles[i], candles[i - 1]);
    minusMovement += minusDirectionalMovement(candles[i], candles[i - 1]);
  }

  const points: AdxPoint[] = [];
  const directionalIndexes: number[] = [];
  let adx: number | null = null;

  for (let i = period; i < candles.length; i++) {
    if (i > period) {
      // Wilder's smoothing on the running totals: shed one average bar, add the new one.
      trueRange = trueRange - trueRange / period + barTrueRange(candles[i], candles[i - 1]);
      plusMovement =
        plusMovement - plusMovement / period + plusDirectionalMovement(candles[i], candles[i - 1]);
      minusMovement =
        minusMovement -
        minusMovement / period +
        minusDirectionalMovement(candles[i], candles[i - 1]);
    }

    // A flat stretch can leave no range at all to divide by.
    const plusDi = trueRange === 0 ? 0 : (100 * plusMovement) / trueRange;
    const minusDi = trueRange === 0 ? 0 : (100 * minusMovement) / trueRange;
    const spread = plusDi + minusDi;
    directionalIndexes.push(spread === 0 ? 0 : (100 * Math.abs(plusDi - minusDi)) / spread);

    if (directionalIndexes.length === period) {
      adx = directionalIndexes.reduce((total, value) => total + value, 0) / period;
    } else if (adx !== null) {
      adx = (adx * (period - 1) + directionalIndexes[directionalIndexes.length - 1]) / period;
    }

    points.push({ time: candles[i].time, plusDi, minusDi, adx });
  }

  return points;
}

function barTrueRange(candle: Candle, previous: Candle): number {
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previous.close),
    Math.abs(candle.low - previous.close),
  );
}

function plusDirectionalMovement(candle: Candle, previous: Candle): number {
  const up = candle.high - previous.high;
  const down = previous.low - candle.low;
  return up > down && up > 0 ? up : 0;
}

function minusDirectionalMovement(candle: Candle, previous: Candle): number {
  const up = candle.high - previous.high;
  const down = previous.low - candle.low;
  return down > up && down > 0 ? down : 0;
}
