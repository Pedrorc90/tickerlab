import { averageDirectionalIndex } from '../market/indicators/adx';
import { HeikinAshiBar, smoothedHeikinAshi } from '../market/indicators/heikin-ashi';
import { ichimoku } from '../market/indicators/ichimoku';
import { macd } from '../market/indicators/macd';
import { exponentialMovingAverage, simpleMovingAverage } from '../market/indicators/moving-average';
import { relativeStrengthIndex } from '../market/indicators/rsi';
import { Candle, IndicatorPoint } from '../market/market.models';
import { CombineMode, Strategy, StrategyParams } from './strategy.models';

/**
 * What a strategy says about the bars: on which of them the position should be open. A stance
 * per bar and not a list of crossings, because that is what makes two strategies combinable —
 * «both are in» is a question you can ask of a state and cannot ask of an event: two crossings
 * almost never land on the same bar, and waiting for them to would trade about once a decade.
 *
 * The entry is then simply the bar `held` turns true on, which is the same bar the old cross
 * signalled — with one difference at the very start, and it is deliberate: a strategy already
 * true on the first bar it can speak about is in, instead of sitting out until the next flip.
 * Otherwise a filter that has been true all along would silently veto everything.
 */
export interface Stance {
  /**
   * The first bar the strategy can say anything about. An average of forty bars says nothing
   * about the first thirty-nine, and measuring buy & hold over bars the rules were blind to
   * would be comparing two different tests.
   */
  from: number;
  /** Index-aligned with the candles. Anything before `from` is false and means «no opinion». */
  held: boolean[];
}

/** Nothing measurable: the window is shorter than the periods asked of it. */
function silent(candles: Candle[]): Stance {
  return { from: candles.length, held: candles.map(() => false) };
}

export function stanceOf(strategy: Strategy, candles: Candle[], params: StrategyParams): Stance {
  switch (strategy.id) {
    case 'EMA_CROSS':
      return above(
        candles,
        exponentialMovingAverage(candles, params.emaFast),
        exponentialMovingAverage(candles, params.emaSlow),
      );
    case 'SMA_CROSS':
      return above(
        candles,
        simpleMovingAverage(candles, params.smaFast),
        simpleMovingAverage(candles, params.smaSlow),
      );
    case 'MACD':
      return macdStance(candles, params);
    case 'RSI':
      return rsiStance(candles, params);
    case 'PRICE_OVER_MA':
      return overPrice(candles, simpleMovingAverage(candles, params.trendMa));
    case 'SHA':
      return shaStance(candles, params);
    case 'ICHIMOKU':
      return ichimokuStance(candles, params);
    case 'ICHIMOKU_TK':
      return tenkanKijunStance(candles, params);
    case 'ADX':
      return adxStance(candles, params);
  }
}

/**
 * How several ticked strategies resolve into one position. `from` is the last of theirs: until
 * every one of them can speak, a Y would be vetoed by silence and an O would be answered by
 * whichever happened to have the shortest period, and neither is the combination being tested.
 */
export function combine(stances: ReadonlyArray<Stance>, mode: CombineMode, bars: number): Stance {
  if (!stances.length) {
    return { from: bars, held: Array.from({ length: bars }, () => false) };
  }

  const from = Math.max(...stances.map((stance) => stance.from));
  const held = Array.from({ length: bars }, (_, i) =>
    i < from
      ? false
      : mode === 'ALL'
        ? stances.every((stance) => stance.held[i])
        : stances.some((stance) => stance.held[i]),
  );

  return { from, held };
}

/** One line over another, bar by bar: every cross strategy is this and a pair of periods. */
function above(candles: Candle[], fast: IndicatorPoint[], slow: IndicatorPoint[]): Stance {
  const fastByTime = byTime(fast);
  const slowByTime = byTime(slow);
  return stanceFrom(candles, (candle) => {
    const fastValue = fastByTime.get(candle.time);
    const slowValue = slowByTime.get(candle.time);
    return fastValue === undefined || slowValue === undefined ? null : fastValue > slowValue;
  });
}

/** The close over its average. The same shape as a cross, with the price as the fast line. */
function overPrice(candles: Candle[], average: IndicatorPoint[]): Stance {
  const averageByTime = byTime(average);
  return stanceFrom(candles, (candle) => {
    const value = averageByTime.get(candle.time);
    return value === undefined ? null : candle.close > value;
  });
}

function macdStance(candles: Candle[], params: StrategyParams): Stance {
  const points = new Map(
    macd(candles, params.macdFast, params.macdSlow, params.macdSignal).map((point) => [
      point.time,
      point,
    ]),
  );
  return stanceFrom(candles, (candle) => {
    const point = points.get(candle.time);
    return point === undefined ? null : point.macd > point.signal;
  });
}

/**
 * The only one with a memory: between the two levels the RSI says nothing new, so the stance
 * is whatever it already was. Written as «buy under, hold until the sell level» rather than
 * «in while under 30», which would be in for a day and out for a year — the point of the
 * oscillator is that it is bought oversold and given room to work.
 *
 * The exit is read before the entry so that a bar reaching both levels at once — possible
 * once the two are dragged past each other — closes instead of opening. Being out is the
 * state that needs no explaining.
 */
function rsiStance(candles: Candle[], params: StrategyParams): Stance {
  const values = byTime(relativeStrengthIndex(candles, params.rsiPeriod));
  let holding = false;
  return stanceFrom(candles, (candle) => {
    const value = values.get(candle.time);
    if (value === undefined) {
      return null;
    }
    if (holding && value >= params.rsiSell) {
      holding = false;
    } else if (!holding && value <= params.rsiBuy) {
      holding = true;
    }
    return holding;
  });
}

/**
 * The colour of the smoothed body, held for a run: green is in, red is out, and how many of
 * each it takes is the strategy. The comparison is the bar's own open against its own close,
 * never the previous bar's — a Heikin Ashi open is already the middle of the body before it,
 * so the memory is baked into the arithmetic and reaching back would count a bar twice.
 *
 * The streak is consecutive: one bar of the other colour puts the count back to zero rather
 * than pausing it. What is being asked for is a run that did not break, so a break is the
 * one thing that has to end it — counting bars since the first green would let a body that
 * flickered red twice confirm on the same bar as one that never did.
 *
 * A body that fails the size filter is neither colour: it puts both counts back to zero
 * rather than counting for the other side. It is no evidence of the opposite trend, but it
 * does break the run — and a run allowed to survive the bar that broke it is not a run.
 *
 * Which filter a bar is held to is decided by its own colour, so the two sizes never meet:
 * a green is only ever asked the buy figure and a red only the sell one. That is what lets
 * one side be tightened while the other is left off entirely.
 *
 * The second one with a memory, and for the same reason as the RSI: between the two streaks
 * the bars say nothing new, so the stance is whatever it already was. The exit is read first
 * so a red bar closes the position on the bar it completes the run, without waiting out the
 * green count it just reset.
 */
function shaStance(candles: Candle[], params: StrategyParams): Stance {
  const bars = new Map<number, HeikinAshiBar>(
    smoothedHeikinAshi(candles, params.shaPrice, params.shaCandle).map((bar) => [bar.time, bar]),
  );
  let holding = false;
  let greens = 0;
  let reds = 0;

  return stanceFrom(candles, (candle) => {
    const bar = bars.get(candle.time);
    if (bar === undefined) {
      return null;
    }
    const green = bar.close > bar.open;
    const minimum = green ? params.shaBodyBuy : params.shaBodySell;
    if (!bodyOverWick(bar, green, minimum)) {
      greens = 0;
      reds = 0;
    } else if (green) {
      greens++;
      reds = 0;
    } else {
      reds++;
      greens = 0;
    }
    if (holding && reds >= params.shaExitBars) {
      holding = false;
    } else if (!holding && greens >= params.shaEntryBars) {
      holding = true;
    }
    return holding;
  });
}

/**
 * The body against the wick the move should have left behind: the one under a green body,
 * the one over a red. That is the asymmetry the smoothed candles are read for — a bar that
 * ran all the way to its extreme has nothing hanging off the side it came from, and a body
 * dwarfed by that wick is a trend being argued with rather than a trend.
 *
 * A share and not a difference, so the number means the same thing at any price: 300 asks
 * for a body three times the wick, and under 100 it asks for the opposite — the same
 * comparison read from the other side. Multiplied instead of divided because a wickless bar
 * is the strongest one there is and dividing by it would throw the reading away.
 *
 * The minimum arrives already chosen rather than being looked up here: this reads one bar,
 * and which of the two figures applies to it is a question about the strategy. Zero is off,
 * and it has to be — a rule laid over the colour is the sort of thing that should be asked
 * for rather than found already switched on.
 */
function bodyOverWick(bar: HeikinAshiBar, green: boolean, minimum: number): boolean {
  if (minimum <= 0) {
    return true;
  }
  const body = Math.abs(bar.close - bar.open);
  const wick = green
    ? Math.min(bar.open, bar.close) - bar.low
    : bar.high - Math.max(bar.open, bar.close);
  return body * 100 >= wick * minimum;
}

/**
 * The cloud under the close, and rising. The cloud is looked up by the bar it was drawn onto
 * rather than the bar it was computed from: `ichimoku` already displaces it, so the value
 * found at a candle's own time is the one that was visible there — the level the price had
 * to clear on that bar, decided `base` bars earlier.
 *
 * Both halves are read off the same point: over the cloud is where the price stands, and
 * Span A over Span B is where the cloud is going. The first on its own would hold all the
 * way down a cloud that had already turned, and the last stretch of it is the part with no
 * candles under it yet — the displacement means a red cloud is visible before the price
 * reaches it, which is the whole reason to look.
 *
 * Nothing to say until both spans exist, which is `span` bars for Span B plus the `base` it
 * is pushed forward by: it is the longest silence of the catalogue and it is honest, since
 * the cloud over the first bars was never drawn.
 */
function ichimokuStance(candles: Candle[], params: StrategyParams): Stance {
  const cloud = new Map(
    ichimoku(
      candles,
      params.ichimokuConversion,
      params.ichimokuBase,
      params.ichimokuSpan,
    ).cloud.map((point) => [point.time, point]),
  );

  return stanceFrom(candles, (candle) => {
    const point = cloud.get(candle.time);
    if (point === undefined) {
      return null;
    }
    return candle.close > Math.max(point.spanA, point.spanB) && point.spanA > point.spanB;
  });
}

/**
 * The conversion line over the base line: the same shape as any other cross, over the two
 * lines Ichimoku turns fastest. Neither is displaced — the shift belongs to the cloud and to
 * the lagging span — so both are read on the bar that produced them, and `above` is enough.
 *
 * They are midpoints of a range and not averages of closes, so they sit flat for stretches
 * and cross in steps rather than curves: the conversion can hold the exact value of the base
 * for several bars, which is why the comparison is strict. Equal is not above, and a flat
 * pair is not a signal.
 */
function tenkanKijunStance(candles: Candle[], params: StrategyParams): Stance {
  const lines = ichimoku(candles, params.ichimokuConversion, params.ichimokuBase);
  return above(candles, lines.conversion, lines.base);
}

/**
 * The third one with a memory, and it needs one for the opposite reason to the RSI's: the ADX
 * measures how fast a trend is widening rather than how far it has gone, so it slides back the
 * moment a move settles into a steady climb. Read against a single level it would close the
 * position in the middle of the very trend it was opened for — so it enters on the strict
 * figure and is only let go on the loose one, and between the two nothing happens.
 *
 * Strength with no side to it: +DI and -DI are left unread on purpose. A market falling hard
 * scores exactly as high as one rising hard, which is why this belongs ticked next to
 * something that says which way — on its own it is a machine for buying crashes.
 *
 * The exit is read first, as everywhere else: with the two levels dragged past each other a
 * bar can answer both, and being out is the state that needs no explaining.
 *
 * `adx` stays null until the second smoothing has enough directional indexes to average, and
 * those bars answer nothing rather than false: two periods of silence is what the indicator
 * actually costs, and `from` should say so.
 */
function adxStance(candles: Candle[], params: StrategyParams): Stance {
  const values = new Map(
    averageDirectionalIndex(candles, params.adxPeriod).map((point) => [point.time, point.adx]),
  );
  let holding = false;

  return stanceFrom(candles, (candle) => {
    const value = values.get(candle.time);
    if (value === undefined || value === null) {
      return null;
    }
    if (holding && value < params.adxExit) {
      holding = false;
    } else if (!holding && value >= params.adxEntry) {
      holding = true;
    }
    return holding;
  });
}

/**
 * Walks the candles once and turns «true, false or nothing to say» into a stance. `from` is
 * the first bar that answered: indicators skip the bars they cannot be computed over, and
 * which ones those are is the indicator's business, not this file's.
 */
function stanceFrom(candles: Candle[], verdict: (candle: Candle) => boolean | null): Stance {
  const held = candles.map(() => false);
  let from = -1;

  for (let i = 0; i < candles.length; i++) {
    const answer = verdict(candles[i]);
    if (answer === null) {
      continue;
    }
    if (from < 0) {
      from = i;
    }
    held[i] = answer;
  }

  return from < 0 ? silent(candles) : { from, held };
}

function byTime(points: IndicatorPoint[]): Map<number, number> {
  return new Map(points.map(({ time, value }) => [time, value]));
}
