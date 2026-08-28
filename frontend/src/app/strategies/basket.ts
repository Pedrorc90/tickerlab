import { Timeframe } from '../market/market.models';
import { MarketService } from '../market/market.service';
import { runBacktest } from './backtest';
import { CombineMode, Strategy, StrategyParams } from './strategy.models';

/**
 * The same configuration run over a whole list. One ticker is an anecdote: with five rules and
 * three periods each, some combination always looks brilliant on some chart, and the screen has
 * no way of telling that apart from a strategy. Over thirty tickers it does — what survives is
 * how many of them it beat buying and holding, and by how much in the middle of the pack.
 */

/**
 * Histories asked for at once. One call per symbol is all the backend offers, and the six is
 * about Yahoo rather than about the browser: fired all at once, a list of forty comes back
 * with holes, and a hole is indistinguishable on screen from a strategy that did nothing.
 */
const CONCURRENCY = 6;

/**
 * Where a basket stops. Fifty is roughly half a minute of loading, and past that the wait
 * stops looking like work and starts looking like a hang. The rest of the list is dropped and
 * said so, rather than quietly tested down to whatever the tab could manage.
 */
export const BASKET_LIMIT = 50;

/** One symbol's run. `edge` is the only column that answers «was the work worth it». */
export interface BasketRow {
  symbol: string;
  name: string | null;
  totalReturn: number;
  buyHoldReturn: number;
  /** Strategy minus buy & hold, in points. Negative means the candles beat the rules. */
  edge: number;
  closedTrades: number;
  openTrade: boolean;
  exposure: number;
}

/**
 * What the basket says as a whole. Medians and not averages: one symbol that went up tenfold
 * would carry an average on its own, and the question is what the strategy does on a normal
 * ticker of the list, not what it did on the best one.
 */
export interface BasketStats {
  tested: number;
  medianReturn: number;
  medianBuyHold: number;
  medianExposure: number;
  /** How many beat buying and holding. Over `tested`, because the share alone hides the size. */
  beat: number;
  /** How many never took a single trade: a rule nobody triggered is not a rule that lost. */
  idle: number;
  best: BasketRow;
  worst: BasketRow;
}

export interface BasketRun {
  list: string;
  /** What it was run on. The screen hides the run when the candles above change shape. */
  timeframe: Timeframe;
  rows: BasketRow[];
  /**
   * Symbols with no usable history, or with less of it than the periods need. Counted apart
   * and never as a zero: «did not run» and «ran and made nothing» are different answers, and
   * folding the first into the second drags the median toward a number nobody measured.
   */
  skipped: string[];
  /** Left out because the list is longer than a basket. Named so the run does not look whole. */
  dropped: string[];
  stats: BasketStats | null;
}

export interface BasketSymbol {
  symbol: string;
  name: string | null;
}

export async function runBasket(
  market: MarketService,
  list: string,
  symbols: ReadonlyArray<BasketSymbol>,
  timeframe: Timeframe,
  strategies: ReadonlyArray<Strategy>,
  mode: CombineMode,
  params: StrategyParams,
  onProgress: (done: number, total: number) => void,
): Promise<BasketRun> {
  const tested = symbols.slice(0, BASKET_LIMIT);
  const dropped = symbols.slice(BASKET_LIMIT).map(({ symbol }) => symbol);
  const rows: BasketRow[] = [];
  const skipped: string[] = [];

  let next = 0;
  let done = 0;
  onProgress(0, tested.length);

  const worker = async (): Promise<void> => {
    while (next < tested.length) {
      const entry = tested[next++];
      const row = await runOne(market, entry, timeframe, strategies, mode, params);
      if (row) {
        rows.push(row);
      } else {
        skipped.push(entry.symbol);
      }
      onProgress(++done, tested.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, tested.length) }, () => worker()),
  );

  // The workers finish out of order, so the rows come back shuffled. Sorted by edge here and
  // not in the view: it is the order the table opens on, and it is what the run is about.
  rows.sort((a, b) => b.edge - a.edge);

  return { list, timeframe, rows, skipped, dropped, stats: statsOf(rows) };
}

/**
 * Null when the symbol has nothing to say: no history, or not enough of it for the periods
 * asked of it. A run of zero trades is not one of those — it is a real answer, it keeps its
 * row, and it is counted as idle.
 */
async function runOne(
  market: MarketService,
  { symbol, name }: BasketSymbol,
  timeframe: Timeframe,
  strategies: ReadonlyArray<Strategy>,
  mode: CombineMode,
  params: StrategyParams,
): Promise<BasketRow | null> {
  let candles;
  try {
    candles = (await market.loadCandles(symbol, timeframe)).candles;
  } catch {
    return null;
  }

  const { stats, equity } = runBacktest(strategies, mode, candles, params);
  if (!equity.length) {
    return null;
  }

  return {
    symbol,
    name,
    totalReturn: stats.totalReturn,
    buyHoldReturn: stats.buyHoldReturn,
    edge: stats.totalReturn - stats.buyHoldReturn,
    closedTrades: stats.closedTrades,
    openTrade: stats.openTrade,
    exposure: stats.exposure,
  };
}

function statsOf(rows: BasketRow[]): BasketStats | null {
  if (!rows.length) {
    return null;
  }

  const byReturn = [...rows].sort((a, b) => a.totalReturn - b.totalReturn);

  return {
    tested: rows.length,
    medianReturn: median(rows.map((row) => row.totalReturn)),
    medianBuyHold: median(rows.map((row) => row.buyHoldReturn)),
    medianExposure: median(rows.map((row) => row.exposure)),
    beat: rows.filter((row) => row.edge > 0).length,
    idle: rows.filter((row) => !row.closedTrades && !row.openTrade).length,
    best: byReturn[byReturn.length - 1],
    worst: byReturn[0],
  };
}

/** The middle of the pack, or the two middles averaged when there is no single one. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
