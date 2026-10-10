import { Candle } from '../market/market.models';
import { SMA_FAST, SMA_SLOW, simpleMovingAverage } from '../market/indicators/moving-average';

/**
 * Bars since the 50-day last went above the 200-day, counted on the candles handed in: 0 is
 * the cross happening on the last bar. Null when it is not above now, and also when it has
 * been above for the whole history — the cross is then older than the data and any number
 * would be a guess. A bar where they are equal is not above, so a cross is the first bar
 * strictly over.
 */
export function daysSinceGoldenCross(candles: Candle[]): number | null {
  const slow = simpleMovingAverage(candles, SMA_SLOW);
  if (!slow.length) {
    return null;
  }

  // Looked up by time because the 50-day starts 150 bars before the 200-day does.
  const fast = new Map(simpleMovingAverage(candles, SMA_FAST).map((point) => [point.time, point.value]));
  const over = (i: number): boolean => (fast.get(slow[i].time) ?? Number.NaN) > slow[i].value;

  const last = slow.length - 1;
  if (!over(last)) {
    return null;
  }

  let start = last;
  while (start > 0 && over(start - 1)) {
    start--;
  }
  return start === 0 ? null : last - start;
}
