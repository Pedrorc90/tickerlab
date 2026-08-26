import { Candle, IndicatorPoint } from '../market.models';

/** The three windows Hosoda published it with: nine, twenty-six and fifty-two. */
export const ICHIMOKU_CONVERSION = 9;
export const ICHIMOKU_BASE = 26;
export const ICHIMOKU_SPAN = 52;

/**
 * How far the deltas between bars are looked back at to keep projecting them. Sixty is a
 * multiple of both the five-bar week and the twelve-bar year, so cycling that many puts the
 * weekend gaps and the month lengths back exactly where they belong, whatever the timeframe.
 */
const PROJECTION_CYCLE = 60;

/** One bar of the cloud. Both spans are already displaced forward. */
export interface CloudPoint {
  time: number;
  spanA: number;
  spanB: number;
}

/**
 * The five lines. `cloud` sits `base` bars ahead of the candles it was computed from —
 * the last of those bars are past the series, on times projected by `projectTimes` — and
 * `lagging` sits the same distance behind, which is the whole point of the indicator:
 * support and resistance are read before the price gets there.
 */
export interface IchimokuLines {
  conversion: IndicatorPoint[];
  base: IndicatorPoint[];
  cloud: CloudPoint[];
  lagging: IndicatorPoint[];
}

export function ichimoku(
  candles: Candle[],
  conversionPeriod = ICHIMOKU_CONVERSION,
  basePeriod = ICHIMOKU_BASE,
  spanPeriod = ICHIMOKU_SPAN,
): IchimokuLines {
  const conversion = midpoints(candles, conversionPeriod);
  const base = midpoints(candles, basePeriod);
  const spanB = midpoints(candles, spanPeriod);

  // Span A is the average of the two lines above, so it only exists where both do.
  const spanA = new Map<number, number>();
  const baseByTime = new Map(base.map((point) => [point.time, point.value]));
  for (const point of conversion) {
    const other = baseByTime.get(point.time);
    if (other !== undefined) {
      spanA.set(point.time, (point.value + other) / 2);
    }
  }

  return {
    conversion,
    base,
    cloud: buildCloud(candles, spanA, spanB, basePeriod),
    lagging: candles
      .slice(basePeriod)
      .map((candle, index) => ({ time: candles[index].time, value: candle.close })),
  };
}

/**
 * Both spans on the same timeline, shifted `displacement` bars to the right. A span only
 * makes the cloud where the other one has a value too: a half-drawn cloud has no upper or
 * lower side to read.
 */
function buildCloud(
  candles: Candle[],
  spanA: Map<number, number>,
  spanB: IndicatorPoint[],
  displacement: number,
): CloudPoint[] {
  const future = projectTimes(candles, displacement);
  const spanBByTime = new Map(spanB.map((point) => [point.time, point.value]));
  const points: CloudPoint[] = [];

  for (let i = 0; i < candles.length; i++) {
    const a = spanA.get(candles[i].time);
    const b = spanBByTime.get(candles[i].time);
    if (a === undefined || b === undefined) {
      continue;
    }
    const ahead = i + displacement;
    const shifted =
      ahead < candles.length ? candles[ahead].time : future[ahead - candles.length];
    if (shifted !== undefined) {
      points.push({ time: shifted, spanA: a, spanB: b });
    }
  }

  return points;
}

/**
 * Timestamps for bars that have not happened yet. The chart has no calendar, so the rhythm
 * of the recent past is repeated instead: whatever gaps the last `PROJECTION_CYCLE` bars
 * left — a weekend, a short February — come round again in the same order.
 */
function projectTimes(candles: Candle[], count: number): number[] {
  const deltas: number[] = [];
  for (let i = Math.max(1, candles.length - PROJECTION_CYCLE); i < candles.length; i++) {
    deltas.push(candles[i].time - candles[i - 1].time);
  }
  if (!deltas.length) {
    return [];
  }

  const times: number[] = [];
  let time = candles[candles.length - 1].time;
  for (let i = 0; i < count; i++) {
    time += deltas[i % deltas.length];
    times.push(time);
  }
  return times;
}

/**
 * Midpoint of the last `period` bars: the highest high and the lowest low, halved. Not a
 * moving average — it ignores where the closes fell and only asks how far the range reached,
 * which is why the lines come out flat and stepped instead of curved.
 *
 * The window is scanned bar by bar rather than kept in a deque: at these periods the plain
 * scan costs less than the bookkeeping that would save it.
 */
function midpoints(candles: Candle[], period: number): IndicatorPoint[] {
  const points: IndicatorPoint[] = [];

  for (let i = period - 1; i < candles.length; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      highest = Math.max(highest, candles[j].high);
      lowest = Math.min(lowest, candles[j].low);
    }
    points.push({ time: candles[i].time, value: (highest + lowest) / 2 });
  }

  return points;
}
