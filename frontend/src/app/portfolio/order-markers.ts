import { Candle, TradeMarker } from '../market/market.models';
import { Order } from './portfolio.models';

/**
 * Turns the fills of one symbol into markers for its chart, so the orders you actually placed
 * show up in the same shape as the ones a backtest invents — the point of the screen being that
 * the two can be looked at side by side.
 *
 * <p>An order carries the instant it filled; a chart is a row of bars. So every fill is snapped
 * back to the last bar that had already opened when it happened. Snapping <em>back</em> and not
 * to the nearest one is deliberate: a Tuesday afternoon buy belongs on Tuesday, and rounding it
 * forward would draw it on a bar that had not printed yet.
 *
 * <p>Fills older than the first bar on screen are dropped rather than pinned to bar zero, which
 * would read as "bought at the start" on every timeframe that does not go back far enough.
 * Several fills landing on one bar each keep their own marker: two buys on the same day are two
 * decisions, and merging them would hide the second one.
 */
export function orderMarkers(orders: readonly Order[], candles: readonly Candle[]): TradeMarker[] {
  if (candles.length === 0) {
    return [];
  }
  const first = candles[0].time;
  const markers: TradeMarker[] = [];
  for (const order of orders) {
    const at = Math.floor(new Date(order.executedAt).getTime() / 1000);
    if (at < first) {
      continue;
    }
    markers.push({
      time: barAt(candles, at),
      kind: order.side === 'BUY' ? 'buy' : 'sell',
      text: label(order),
    });
  }
  return markers;
}

/** The last bar that had opened by then. Binary search: a daily chart is thousands of bars. */
function barAt(candles: readonly Candle[], at: number): number {
  let low = 0;
  let high = candles.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (candles[middle].time <= at) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return candles[low].time;
}

/**
 * Units first, because that is what changed. A sell that closed at a profit says so: the number
 * is already computed on the server against the average cost, and re-deriving it here from the
 * price on screen would be a second, quieter answer to the same question.
 */
function label(order: Order): string {
  const units = order.quantity;
  if (order.side === 'BUY') {
    return `Compra ${units}`;
  }
  if (order.realizedPnl === null) {
    return `Venta ${units}`;
  }
  const sign = order.realizedPnl > 0 ? '+' : '';
  return `Venta ${units} ${sign}${order.realizedPnl.toFixed(0)}`;
}
