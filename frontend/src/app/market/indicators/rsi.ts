import { Candle, IndicatorPoint } from '../market.models';

/** Standard RSI period. 14 is what TradingView and every textbook use by default. */
export const RSI_PERIOD = 14;

/** Above this the market is considered overbought, below `RSI_OVERSOLD` oversold. */
export const RSI_OVERBOUGHT = 70;
export const RSI_OVERSOLD = 30;

/**
 * Relative Strength Index using Wilder's smoothing: the first average is a plain mean of
 * the first `period` moves, and every later one carries the previous average forward.
 * The first `period` bars produce no value, so the returned array is shorter than the input.
 */
export function relativeStrengthIndex(candles: Candle[], period = RSI_PERIOD): IndicatorPoint[] {
  if (candles.length <= period) {
    return [];
  }

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change >= 0) {
      gainSum += change;
    } else {
      lossSum -= change;
    }
  }

  let averageGain = gainSum / period;
  let averageLoss = lossSum / period;

  const points: IndicatorPoint[] = [{ time: candles[period].time, value: toRsi(averageGain, averageLoss) }];

  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
    points.push({ time: candles[i].time, value: toRsi(averageGain, averageLoss) });
  }

  return points;
}

/** A flat run with no losses pins the index at 100 rather than dividing by zero. */
function toRsi(averageGain: number, averageLoss: number): number {
  if (averageLoss === 0) {
    return averageGain === 0 ? 50 : 100;
  }
  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}
