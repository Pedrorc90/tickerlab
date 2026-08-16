import { Candle, IndicatorPoint } from '../market.models';

/** Standard ATR period, same 14 Wilder published it with. */
export const ATR_PERIOD = 14;

/**
 * Average True Range using Wilder's smoothing. True range is the widest of today's own
 * span and the two gaps against yesterday's close, so an opening gap counts as movement
 * instead of being missed. The first range needs a previous close and the first average
 * is a plain mean of `period` ranges, so the series starts at `candles[period]`.
 *
 * Values come out in price units, not a 0-100 scale: the pane needs its own axis.
 */
export function averageTrueRange(candles: Candle[], period = ATR_PERIOD): IndicatorPoint[] {
  if (candles.length <= period) {
    return [];
  }

  let sum = 0;
  for (let i = 1; i <= period; i++) {
    sum += trueRange(candles[i], candles[i - 1]);
  }

  let average = sum / period;
  const points: IndicatorPoint[] = [{ time: candles[period].time, value: average }];

  for (let i = period + 1; i < candles.length; i++) {
    average = (average * (period - 1) + trueRange(candles[i], candles[i - 1])) / period;
    points.push({ time: candles[i].time, value: average });
  }

  return points;
}

function trueRange(candle: Candle, previous: Candle): number {
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previous.close),
    Math.abs(candle.low - previous.close),
  );
}
