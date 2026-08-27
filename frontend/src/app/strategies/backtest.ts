import { exponentialMovingAverage } from '../market/indicators/moving-average';
import { Candle, IndicatorPoint, TradeMarker } from '../market/market.models';
import { Strategy, StrategyParams } from './strategy.models';

/**
 * What the rules say on one bar. A strategy produces these and nothing else — the accounting
 * below is the same whatever drew them, which is what keeps a second strategy to one function.
 */
type SignalKind = 'ENTER' | 'EXIT';

/**
 * Why a position was closed. The cross is the strategy's own rule; the objective is a level
 * laid over it, and the two are worth telling apart on the chart — a run that only ever hit
 * its target never actually tested the rule that was supposed to get it out.
 */
type ExitReason = 'signal' | 'target';

interface SignalPoint {
  index: number;
  kind: SignalKind;
}

/**
 * The bars a strategy could actually act on, plus its signals. `from` is not zero: an average
 * of forty bars says nothing about the first thirty-nine, and measuring buy & hold over bars
 * the strategy was blind to would be comparing two different tests.
 */
interface Signals {
  from: number;
  points: SignalPoint[];
}

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

export function runBacktest(
  strategy: Strategy,
  candles: Candle[],
  params: StrategyParams,
): Backtest {
  if (candles.length < 2) {
    return EMPTY;
  }
  switch (strategy.id) {
    case 'EMA_CROSS':
      return simulate(
        candles,
        emaCrossSignals(candles, params.emaFast, params.emaSlow),
        params.takeProfit,
      );
  }
}

/**
 * Every bar where the fast average changes sides. The crossing bar is the one that trades:
 * both averages are made of closes, so the cross is only known once that close is in, and
 * taking it is the earliest honest fill. Anything sooner is reading a bar before it happened.
 *
 * The first bar both averages exist on sets the side without emitting anything — a cross needs
 * a previous side to have crossed from, and already being above is not one.
 */
function emaCrossSignals(candles: Candle[], fast: number, slow: number): Signals {
  const fastByTime = new Map(
    exponentialMovingAverage(candles, fast).map(({ time, value }) => [time, value]),
  );
  const slowByTime = new Map(
    exponentialMovingAverage(candles, slow).map(({ time, value }) => [time, value]),
  );

  const points: SignalPoint[] = [];
  let from = -1;
  let above: boolean | null = null;

  for (let i = 0; i < candles.length; i++) {
    const fastValue = fastByTime.get(candles[i].time);
    const slowValue = slowByTime.get(candles[i].time);
    if (fastValue === undefined || slowValue === undefined) {
      continue;
    }
    if (from < 0) {
      from = i;
    }
    const nowAbove = fastValue > slowValue;
    if (above !== null && nowAbove !== above) {
      points.push({ index: i, kind: nowAbove ? 'ENTER' : 'EXIT' });
    }
    above = nowAbove;
  }

  return { from: from < 0 ? candles.length : from, points };
}

/**
 * Turns signals into trades, an equity curve and the numbers on the panel. Long only and all
 * in: one position at a time, opened and closed at the close of the signalling bar, with no
 * stop and no commission. Both of those flatter the result, and both are stated on screen —
 * a backtest that hides its own rules is a number nobody can use.
 *
 * `takeProfit` is a percentage over the entry, and it belongs here rather than in the signals:
 * a level is measured against a price the rules know nothing about, and written this way every
 * strategy added later gets the same objective for free. Zero switches it off.
 */
function simulate(candles: Candle[], { from, points }: Signals, takeProfit: number): Backtest {
  if (from >= candles.length - 1) {
    return EMPTY;
  }

  const trades: Trade[] = [];
  const equity: IndicatorPoint[] = [];
  const bySignal = new Map(points.map((point) => [point.index, point.kind]));

  /** The capital of every trade already closed. The open one is marked on top of it. */
  let closed = STARTING_CAPITAL;
  let peak = STARTING_CAPITAL;
  let maxDrawdown = 0;
  let barsHeld = 0;
  let entryIndex: number | null = null;

  for (let i = from; i < candles.length; i++) {
    const { time, close } = candles[i];
    const signal = bySignal.get(i);

    // Measured on the close, like every other decision here: the bar may well have traded
    // through the level intra-day, but filling there assumes an order nobody placed, and the
    // close is the last price that is known to have happened.
    const gain = entryIndex === null ? 0 : (close / candles[entryIndex].close - 1) * 100;
    const reason: ExitReason | null =
      entryIndex === null
        ? null
        : signal === 'EXIT'
          ? 'signal'
          : gain >= takeProfit && takeProfit > 0
            ? 'target'
            : null;

    // The exit is settled before a new entry is taken: the same bar cannot hold two positions,
    // and the rules never ask it to — a cross has one side.
    if (reason !== null && entryIndex !== null) {
      const entry = candles[entryIndex];
      closed *= close / entry.close;
      trades.push({
        entryTime: entry.time,
        entryPrice: entry.close,
        exitTime: time,
        exitPrice: close,
        exitReason: reason,
        bars: i - entryIndex,
        returnPercent: gain,
        open: false,
      });
      entryIndex = null;
    } else if (signal === 'ENTER' && entryIndex === null) {
      entryIndex = i;
    }

    if (entryIndex !== null) {
      barsHeld++;
    }

    // Marked to market, so a position that gave everything back before closing shows the fall
    // it actually went through instead of the one it ended on.
    const held = entryIndex === null ? 1 : close / candles[entryIndex].close;
    const value = closed * held;
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
      returnPercent: (last.close / entry.close - 1) * 100,
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
    const label = trade.exitReason === 'target' ? 'Objetivo' : 'Venta';
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
