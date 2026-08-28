import { Candle, IndicatorPoint, TradeMarker } from '../market/market.models';
import { Stance, combine, stanceOf } from './signals';
import { CombineMode, Strategy, StrategyParams } from './strategy.models';

/**
 * Why a position was closed. The rules are the strategy's own; the objective and the stop are
 * levels laid over them, and the three are worth telling apart on the chart — a run that only
 * ever hit its target never actually tested the rule that was supposed to get it out, and one
 * that only ever hit its stop tested the distance instead of the rules.
 */
type ExitReason = 'signal' | 'target' | 'stop';

/** What the arrow says, so the reason is readable off the chart and not only off the table. */
const EXIT_LABELS: Readonly<Record<ExitReason, string>> = {
  signal: 'Venta',
  target: 'Objetivo',
  stop: 'Stop',
};

/** One round trip. Still open at the last bar means `exitTime` is null and the rest is live. */
export interface Trade {
  entryTime: number;
  entryPrice: number;
  /** Null while the position is open; the bar it was closed on otherwise. */
  exitTime: number | null;
  /** Where it was closed, or the last close while it is still running. */
  exitPrice: number;
  /** Which rule closed it, or null while it is still open. */
  exitReason: ExitReason | null;
  bars: number;
  returnPercent: number;
  open: boolean;
}

/**
 * Everything the tester shows. Nulls mean «there was nothing to measure» and not zero: a run
 * without a single closed trade has no win rate, and printing 0 % there reads as «it lost».
 */
export interface BacktestStats {
  /** Compounded, all in, and including whatever the open position is worth right now. */
  totalReturn: number;
  /** The same window bought and held. The only number that says whether the work paid off. */
  buyHoldReturn: number;
  closedTrades: number;
  openTrade: boolean;
  /** How many of them ended up. The share alone hides whether it is 7 of 12 or 1 of 2. */
  winners: number;
  winRate: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  /** Gross gains over gross losses. `Infinity` when nothing lost, null when nothing closed. */
  profitFactor: number | null;
  /** Worst fall from a peak of the equity curve, marked to market bar by bar. Negative. */
  maxDrawdown: number;
  averageBars: number | null;
  /** Share of the tested bars spent holding: what the return was actually risked over. */
  exposure: number;
}

export interface Backtest {
  trades: Trade[];
  markers: TradeMarker[];
  /** Capital normalised to 100 at the first tested bar, so the shape is the whole point. */
  equity: IndicatorPoint[];
  stats: BacktestStats;
}

const EMPTY: Backtest = {
  trades: [],
  markers: [],
  equity: [],
  stats: {
    totalReturn: 0,
    buyHoldReturn: 0,
    closedTrades: 0,
    openTrade: false,
    winners: 0,
    winRate: null,
    averageWin: null,
    averageLoss: null,
    profitFactor: null,
    maxDrawdown: 0,
    averageBars: null,
    exposure: 0,
  },
};

/** Where the equity curve starts. A percentage of it is what gets read, never the number. */
export const STARTING_CAPITAL = 100;

/**
 * The window the volume filter measures against. Fixed rather than editable: the filter is
 * one number on the panel and a second one would turn «volumen 150 %» into a pair nobody
 * asked for. Twenty is the same month the chart's volume average draws.
 */
const VOLUME_AVERAGE_BARS = 20;

/**
 * The ticked strategies, resolved into one position per bar and then priced. Nothing here
 * knows what an EMA is: the rules live in `signals.ts` and this file does the accounting, so
 * a sixth strategy costs a function there and an entry in the catalogue, and nothing at all
 * on this side — which is also why combining them was possible without touching the maths.
 */
export function runBacktest(
  strategies: ReadonlyArray<Strategy>,
  mode: CombineMode,
  candles: Candle[],
  params: StrategyParams,
): Backtest {
  if (candles.length < 2 || !strategies.length) {
    return EMPTY;
  }
  const stances = strategies.map((strategy) => stanceOf(strategy, candles, params));
  return simulate(
    candles,
    combine(stances, mode, candles.length),
    params.takeProfit,
    params.stopLoss,
    params.volumeFilter,
    params.tradeCost,
  );
}

/**
 * Each bar's volume as a share of its own average, or null where there is no average to
 * compare it with. Null in two cases, and both mean «do not filter» rather than «do not
 * enter»: the first bars, which have no full window behind them yet, and an instrument that
 * reports no volume at all — plenty of indices do, and vetoing every entry on one of those
 * would hand back an empty backtest that looks like the rules never fired.
 */
function relativeVolumes(candles: Candle[]): Array<number | null> {
  const out: Array<number | null> = [];
  let window = 0;

  for (let i = 0; i < candles.length; i++) {
    window += candles[i].volume;
    if (i >= VOLUME_AVERAGE_BARS) {
      window -= candles[i - VOLUME_AVERAGE_BARS].volume;
    }
    const average = window / VOLUME_AVERAGE_BARS;
    out.push(
      i + 1 < VOLUME_AVERAGE_BARS || average <= 0 ? null : (candles[i].volume / average) * 100,
    );
  }

  return out;
}

/**
 * Turns a stance per bar into trades, an equity curve and the numbers on the panel. Long only
 * and all in: one position at a time, opened and closed at the close of the deciding bar, and
 * charged `tradeCost` basis points on every round trip. Zero is the old behaviour and still
 * the default, and it flatters the result — so whatever it is set to is stated on screen: a
 * backtest that hides its own rules is a number nobody can use.
 *
 * `takeProfit` and `stopLoss` are percentages over the entry, and they belong here rather than
 * in the rules: a level is measured against a price the rules know nothing about, and written
 * this way every strategy — and every combination of them — gets the same objective and the
 * same stop for free. Zero is off on either. The stop is read on the close like every other
 * decision here, so a bar that pierced it and closed back above never happened: filling
 * intra-day would assume an order nobody placed, and it would flatter the stop instead of
 * charging for it.
 *
 * `volumeFilter` is here for the same reason and reads the other way round: the objective can
 * close a trade the rules wanted open, and the filter can refuse one they wanted taken. It
 * never closes anything, so a position already running is the rules' business alone.
 */
function simulate(
  candles: Candle[],
  { from, held }: Stance,
  takeProfit: number,
  stopLoss: number,
  volumeFilter: number,
  tradeCost: number,
): Backtest {
  if (from >= candles.length - 1) {
    return EMPTY;
  }

  /**
   * The whole round trip charged once, as a factor over the position: 20 points leave 0.998
   * of it. It multiplies the exit rather than being subtracted at the end, so a strategy that
   * trades twice as often pays twice as much — which is the entire point of charging it.
   */
  const costFactor = 1 - tradeCost / 10_000;
  /** What a trade actually returned: the move, minus the cost of having taken it. */
  const netPercent = (exit: number, entry: number) => ((exit / entry) * costFactor - 1) * 100;

  const relative = relativeVolumes(candles);
  /** No filter asked for, or no average to hold the bar against: the entry stands. */
  const confirmed = (i: number) =>
    volumeFilter <= 0 || relative[i] === null || (relative[i] as number) >= volumeFilter;

  const trades: Trade[] = [];
  const equity: IndicatorPoint[] = [];

  /** The capital of every trade already closed. The open one is marked on top of it. */
  let closed = STARTING_CAPITAL;
  let peak = STARTING_CAPITAL;
  let maxDrawdown = 0;
  let barsHeld = 0;
  let entryIndex: number | null = null;

  /**
   * Set when the objective or the stop closed a trade the rules still wanted open. Without it
   * the next bar would walk straight back in and hit the same level again, turning one
   * objective into a weekly toll on a position nobody re-entered — and one stop into the same
   * fall charged for over and over on the way down. The condition has to go false and come
   * back before it counts as a new trade.
   */
  let awaitingReset = false;

  for (let i = from; i < candles.length; i++) {
    const { time, close } = candles[i];
    const wanted = held[i];

    if (!wanted) {
      awaitingReset = false;
    }

    // Measured on the close, like every other decision here: the bar may well have traded
    // through the level intra-day, but filling there assumes an order nobody placed, and the
    // close is the last price that is known to have happened.
    // Gross on purpose: the stop and the objective are levels the price has to reach, and the
    // broker's cut is not something the market ever traded through.
    const gain = entryIndex === null ? 0 : (close / candles[entryIndex].close - 1) * 100;
    const reason: ExitReason | null =
      entryIndex === null
        ? null
        : !wanted
          ? 'signal'
          : gain <= -stopLoss && stopLoss > 0
            ? 'stop'
            : gain >= takeProfit && takeProfit > 0
              ? 'target'
              : null;

    // The exit is settled before a new entry is taken: the same bar cannot hold two positions,
    // and a bar that closes one has nothing left to say about opening another.
    if (reason !== null && entryIndex !== null) {
      const entry = candles[entryIndex];
      closed *= (close / entry.close) * costFactor;
      trades.push({
        entryTime: entry.time,
        entryPrice: entry.close,
        exitTime: time,
        exitPrice: close,
        exitReason: reason,
        bars: i - entryIndex,
        returnPercent: netPercent(close, entry.close),
        open: false,
      });
      entryIndex = null;
      awaitingReset = reason !== 'signal';
    } else if (wanted && entryIndex === null && !awaitingReset && confirmed(i)) {
      entryIndex = i;
    }

    if (entryIndex !== null) {
      barsHeld++;
    }

    // Marked to market, so a position that gave everything back before closing shows the fall
    // it actually went through instead of the one it ended on.
    const holding = entryIndex === null ? 1 : (close / candles[entryIndex].close) * costFactor;
    const value = closed * holding;
    equity.push({ time, value });
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, (value / peak - 1) * 100);
  }

  if (entryIndex !== null) {
    const entry = candles[entryIndex];
    const last = candles[candles.length - 1];
    trades.push({
      entryTime: entry.time,
      entryPrice: entry.close,
      exitTime: null,
      exitPrice: last.close,
      exitReason: null,
      bars: candles.length - 1 - entryIndex,
      returnPercent: netPercent(last.close, entry.close),
      open: true,
    });
  }

  return {
    trades,
    markers: markersOf(trades),
    equity,
    stats: statsOf(trades, equity, candles, from, barsHeld, maxDrawdown),
  };
}

/** An arrow per boundary. The open trade has an entry to draw and no exit yet. */
function markersOf(trades: Trade[]): TradeMarker[] {
  return trades.flatMap((trade) => {
    const entry: TradeMarker = { time: trade.entryTime, kind: 'buy', text: 'Compra' };
    if (trade.exitTime === null) {
      return [entry];
    }
    const sign = trade.returnPercent >= 0 ? '+' : '';
    const label = EXIT_LABELS[trade.exitReason ?? 'signal'];
    return [
      entry,
      {
        time: trade.exitTime,
        kind: 'sell',
        text: `${label} ${sign}${trade.returnPercent.toFixed(1)}%`,
      },
    ];
  });
}

function statsOf(
  trades: Trade[],
  equity: IndicatorPoint[],
  candles: Candle[],
  from: number,
  barsHeld: number,
  maxDrawdown: number,
): BacktestStats {
  const closedTrades = trades.filter((trade) => !trade.open);
  const wins = closedTrades.filter((trade) => trade.returnPercent > 0);
  const losses = closedTrades.filter((trade) => trade.returnPercent <= 0);
  const grossWin = sum(wins.map((trade) => trade.returnPercent));
  const grossLoss = -sum(losses.map((trade) => trade.returnPercent));
  const bars = candles.length - from;
  const first = candles[from].close;
  const last = candles[candles.length - 1].close;

  return {
    totalReturn: (equity[equity.length - 1].value / STARTING_CAPITAL - 1) * 100,
    buyHoldReturn: (last / first - 1) * 100,
    closedTrades: closedTrades.length,
    openTrade: trades.some((trade) => trade.open),
    winners: wins.length,
    winRate: closedTrades.length ? (wins.length / closedTrades.length) * 100 : null,
    averageWin: wins.length ? grossWin / wins.length : null,
    averageLoss: losses.length ? -grossLoss / losses.length : null,
    profitFactor: !closedTrades.length ? null : grossLoss === 0 ? Infinity : grossWin / grossLoss,
    maxDrawdown,
    averageBars: closedTrades.length
      ? sum(closedTrades.map((trade) => trade.bars)) / closedTrades.length
      : null,
    exposure: bars > 0 ? (barsHeld / bars) * 100 : 0,
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
