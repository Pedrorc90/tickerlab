import { Candle, IndicatorPoint } from '../market.models';

/** What every stock is measured against: the S&P 500 tracker, as IBD does it. */
export const RS_BENCHMARK = 'SPY';

/**
 * Where the line is pinned on its first bar. The ratio itself is a meaningless number —
 * what says something is its slope — so it is rebased to a round one the eye can read:
 * 120 means the stock has beaten the index by 20% since the start of the series.
 */
const RS_BASE = 100;

/**
 * Relative strength line: the stock divided by the index, rebased to `RS_BASE`. Rising means
 * the stock is outrunning the market, falling means it is lagging — whichever way the price
 * itself happens to be going, which is the whole point of drawing it.
 *
 * Bars are matched by timestamp rather than by position: the two series rarely line up bar for
 * bar (a halted session, a recent IPO, an index that traded on a day the stock did not), and
 * pairing them by index would quietly shift the whole line against the price above it.
 */
export function relativeStrengthLine(candles: Candle[], benchmark: Candle[]): IndicatorPoint[] {
  if (!candles.length || !benchmark.length) {
    return [];
  }

  const benchmarkClose = new Map(benchmark.map((candle) => [candle.time, candle.close]));

  const points: IndicatorPoint[] = [];
  let base = 0;

  for (const candle of candles) {
    const close = benchmarkClose.get(candle.time);
    // No matching bar, or a zero close the ratio cannot survive: skip it rather than
    // interpolate. A gap in the line is honest; a made-up point is not.
    if (!close) {
      continue;
    }
    const ratio = candle.close / close;
    // The first pair the two series share is the anchor, whatever bar it lands on.
    if (!base) {
      base = ratio;
    }
    points.push({ time: candle.time, value: (ratio / base) * RS_BASE });
  }

  return points;
}
