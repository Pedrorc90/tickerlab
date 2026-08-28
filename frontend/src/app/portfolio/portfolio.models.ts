/** Mirrors the backend `dev.tickerlab.portfolio` DTOs. Nothing here is computed in the browser. */

export type OrderSide = 'BUY' | 'SELL';

/** Where the fill price came from: the screener sweep, or the last daily close. */
export type PriceSource = 'SWEEP' | 'CLOSE';

/**
 * One line of the holdings table, already valued by the server. Every field downstream of the
 * price is null when the sweep could not quote the symbol — the screen prints a dash there,
 * the way the screener does, instead of showing a P&L of zero that reads as "it has not moved".
 */
export interface Position {
  symbol: string;
  /** Company name as the screener knows it; null for anything outside its universe. */
  name: string | null;
  quantity: number;
  avgCost: number;
  cost: number;
  price: number | null;
  marketValue: number | null;
  openPnl: number | null;
  openPnlPercent: number | null;
  /** Share of the portfolio total, in percent. */
  weight: number | null;
  openedAt: string;
}

export interface Portfolio {
  id: string;
  name: string;
  initialCash: number;
  cash: number;
  holdingsValue: number;
  totalValue: number;
  /** Money, not a rate: what the pot is worth minus what it started with. */
  totalReturn: number;
  totalReturnPercent: number | null;
  /** What the current holdings are up or down, still at risk. */
  openPnl: number;
  /** The sum of every sell ever made, cashed in and no longer at risk. */
  realizedPnl: number;
  /** False when a position could not be quoted, which makes every total an understatement. */
  fullyPriced: boolean;
  positions: Position[];
  createdAt: string;
}

/** One line of the order book. Never recomputed: the row is what it was when it filled. */
export interface Order {
  id: string;
  symbol: string;
  name: string | null;
  side: OrderSide;
  quantity: number;
  price: number;
  amount: number;
  /** Null on a buy: a purchase realises nothing. */
  realizedPnl: number | null;
  priceSource: PriceSource;
  executedAt: string;
}

/**
 * How the money reads. Pure functions and not pipes, the same way the screener writes its
 * columns: the summary tiles, the holdings table and the order book all print the same figures
 * and have to print them identically.
 */
export function formatMoney(value: number | null): string {
  if (value === null) {
    return '—';
  }
  return `${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
}

/** With the sign always shown: a P&L of 120 and one of -120 must not read alike at a glance. */
export function formatSignedMoney(value: number | null): string {
  if (value === null) {
    return '—';
  }
  return `${value > 0 ? '+' : ''}${formatMoney(value)}`;
}

/** Units are whole shares, so no decimals — but still grouped, because 1200 is not 12000. */
export function formatUnits(value: number): string {
  return value.toLocaleString('es-ES');
}

/** Day and time: two fills of the same ticker on one day are a different thing from one. */
export function formatWhen(iso: string): string {
  const when = new Date(iso);
  return when.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
