import { Candle } from '../market.models';

/**
 * The two windows Vervoort published it with. The first one smooths the price the candles
 * are built from, the second one smooths the candles themselves.
 */
export const SHA_PRICE = 10;
export const SHA_CANDLE = 10;

/** One smoothed bar. No volume: what comes out is an average, and averages do not trade. */
export interface HeikinAshiBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Smoothed Heikin Ashi: exponential averages on both sides of the Heikin Ashi arithmetic.
 * A plain Heikin Ashi candle already borrows from the bar before it; smoothing the price
 * first and the result again turns that into a run of same-coloured bodies that only breaks
 * when the trend does, which is the whole reason to draw it over the real candles.
 *
 * Both averages are seeded with the simple mean of their first `period` values, the same
 * seed `exponentialMovingAverage` uses, so the series starts `price + candle - 2` bars in.
 */
export function smoothedHeikinAshi(
  candles: Candle[],
  pricePeriod = SHA_PRICE,
  candlePeriod = SHA_CANDLE,
): HeikinAshiBar[] {
  const bars = candles.map(({ time, open, high, low, close }) => ({
    time,
    open,
    high,
    low,
    close,
  }));
  return smooth(heikinAshi(smooth(bars, pricePeriod)), candlePeriod);
}

/**
 * The Heikin Ashi bar. The close is the whole bar averaged and the open is the middle of
 * the previous body, so neither matches a price that was ever traded — that is what strips
 * the noise. The first open has no body behind it and takes the bar's own midpoint.
 */
function heikinAshi(bars: HeikinAshiBar[]): HeikinAshiBar[] {
  const out: HeikinAshiBar[] = [];
  let open = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const close = (bar.open + bar.high + bar.low + bar.close) / 4;
    open = i === 0 ? (bar.open + bar.close) / 2 : (open + out[i - 1].close) / 2;
    out.push({
      time: bar.time,
      open,
      high: Math.max(bar.high, open, close),
      low: Math.min(bar.low, open, close),
      close,
    });
  }

  return out;
}

/** The same exponential average over all four prices at once, bar by bar. */
function smooth(bars: HeikinAshiBar[], period: number): HeikinAshiBar[] {
  if (bars.length < period) {
    return [];
  }

  const weight = 2 / (period + 1);
  const out: HeikinAshiBar[] = [];
  let open = 0;
  let high = 0;
  let low = 0;
  let close = 0;

  for (let i = 0; i < period; i++) {
    open += bars[i].open / period;
    high += bars[i].high / period;
    low += bars[i].low / period;
    close += bars[i].close / period;
  }
  out.push({ time: bars[period - 1].time, open, high, low, close });

  for (let i = period; i < bars.length; i++) {
    open = bars[i].open * weight + open * (1 - weight);
    high = bars[i].high * weight + high * (1 - weight);
    low = bars[i].low * weight + low * (1 - weight);
    close = bars[i].close * weight + close * (1 - weight);
    out.push({ time: bars[i].time, open, high, low, close });
  }

  return out;
}
