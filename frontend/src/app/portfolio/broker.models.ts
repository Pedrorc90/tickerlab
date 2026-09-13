/** Mirrors the backend `dev.tickerlab.broker` DTOs. Nothing here is computed in the browser. */

export type Broker = 'DEGIRO' | 'IBKR';

export type TransactionKind =
  | 'BUY'
  | 'SELL'
  | 'CORPORATE_ACTION'
  | 'DIVIDEND'
  | 'WITHHOLDING'
  | 'FEE'
  | 'INTEREST'
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'FX'
  | 'OTHER';

/** How each kind reads on screen. Spanish, because the statement it came from is. */
export const KIND_LABEL: Record<TransactionKind, string> = {
  BUY: 'Compra',
  SELL: 'Venta',
  CORPORATE_ACTION: 'Canje',
  DIVIDEND: 'Dividendo',
  WITHHOLDING: 'Retención',
  FEE: 'Comisión',
  INTEREST: 'Interés',
  DEPOSIT: 'Ingreso',
  WITHDRAWAL: 'Retirada',
  FX: 'Cambio de divisa',
  OTHER: 'Otro',
};

/** Cash left in one currency. A list of them: one account really does hold two. */
export interface Balance {
  currency: string;
  amount: number;
}

/**
 * What is still held of one instrument, or what a closed one left behind. Rebuilt by the server
 * from the imported rows — there is no stored position here, unlike a paper portfolio.
 */
export interface Holding {
  isin: string;
  product: string | null;
  /** Null until the user says what ticker this ISIN is. Nothing derives it: see `mapSymbol`. */
  symbol: string | null;
  quantity: number;
  /** Null once the position is closed: there are no shares left to average. */
  avgCost: number | null;
  priceCurrency: string | null;
  cost: number;
  /** Everything ever put in, never reduced by a sale — unlike `cost`, which the sells draw down. */
  invested: number;
  /** Everything ever taken out: the sales, plus any cash a corporate action settled against it. */
  proceeds: number;
  realizedPnl: number;
  /** The result against what went in. Null when nothing was ever invested. */
  realizedPercent: number | null;
  currency: string;
  openedAt: string | null;
  /** False when the imports do not reach back far enough to explain the line. */
  complete: boolean;
  /**
   * What the account is funded in, read off its deposits. Not the same as `currency`: a euro
   * DeGiro account books its US fills in dollars, so `cost` above is dollars and this is euros.
   */
  baseCurrency: string;
  /**
   * What the held shares took out of `baseCurrency`, at the rate each fill settled at in the
   * statement. Null when a fill of the position had no currency leg to read it from.
   */
  costBase: number | null;
  /** The quote as the market prints it, in `priceCurrency` and unconverted. */
  lastPrice: number | null;
  /**
   * Value and open result in `baseCurrency`, the quote converted at today's rate and set against
   * `costBase`. Null when the ISIN has no ticker yet, when nothing could quote it, or when the
   * cost has no base — the line then prints dashes rather than pretending nothing moved.
   */
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPercent: number | null;
}

/**
 * Everything of one kind that moved, in one currency: dividends collected, tax withheld,
 * commissions paid, money put in. The half of real accounting the trades export cannot give.
 */
export interface Flow {
  kind: TransactionKind;
  currency: string;
  amount: number;
}

export interface BrokerAccount {
  id: string;
  name: string;
  broker: Broker;
  transactions: number;
  firstMovement: string | null;
  lastMovement: string | null;
  balances: Balance[];
  flows: Flow[];
  holdings: Holding[];
  /** True when any holding is incomplete, which makes every total below an understatement. */
  incompleteHistory: boolean;
  createdAt: string;
}

export interface Transaction {
  id: string;
  kind: TransactionKind;
  executedAt: string;
  isin: string | null;
  product: string | null;
  symbol: string | null;
  quantity: number | null;
  price: number | null;
  priceCurrency: string | null;
  amount: number;
  currency: string;
  fees: number;
  fxRate: number | null;
  externalId: string | null;
  sourceFile: string;
}

/** What an upload did. `skipped` is the number that proves adding a period is safe. */
export interface ImportResult {
  parsed: number;
  imported: number;
  skipped: number;
  ignored: number;
  from: string | null;
  to: string | null;
  account: BrokerAccount;
}

const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF' };

/**
 * Money with the currency it is actually in — the one thing this screen may not do the way the
 * paper portfolio does, where every figure is dollars by construction. A total printed in the
 * wrong currency is not a formatting slip here, it is a wrong number.
 */
export function formatMoney(value: number | null, currency: string | null): string {
  if (value === null || value === undefined) {
    return '—';
  }
  const amount = value.toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount} ${SYMBOLS[currency ?? ''] ?? currency ?? ''}`.trim();
}

/** With the sign always shown: +120 and -120 must not read alike at a glance. */
export function formatSignedMoney(value: number | null, currency: string | null): string {
  if (value === null || value === undefined) {
    return '—';
  }
  return `${value > 0 ? '+' : ''}${formatMoney(value, currency)}`;
}

/** A price carries four decimals, the way the statement prints it. */
export function formatPrice(value: number | null, currency: string | null): string {
  if (value === null || value === undefined) {
    return '—';
  }
  const amount = value.toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  return `${amount} ${SYMBOLS[currency ?? ''] ?? currency ?? ''}`.trim();
}

/** A percentage, always signed: +53,1 % and -53,1 % must not read alike at a glance. */
export function formatPercent(value: number | null): string {
  if (value === null || value === undefined) {
    return '—';
  }
  const shown = value.toLocaleString('es-ES', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${value > 0 ? '+' : ''}${shown} %`;
}

/** Money without decimals, for the cramped tiles of the closed wall. */
export function formatRound(value: number | null, currency: string | null): string {
  if (value === null || value === undefined) {
    return '—';
  }
  const amount = Math.round(value).toLocaleString('es-ES');
  return `${amount} ${SYMBOLS[currency ?? ''] ?? currency ?? ''}`.trim();
}

export function formatUnits(value: number | null): string {
  return value === null || value === undefined ? '—' : value.toLocaleString('es-ES');
}

/**
 * The noise a broker puts in a product name. Stripped for the tiles of the closed wall, where a
 * cell is under 200px wide and "ADR ON ALIBABA GROUP HOLDING LIMITED" arrives as three lines of
 * shouting with the one word that matters buried in the middle.
 *
 * <p>Only ever for display, and only where the full name is one hover away: the tidied string is
 * not an identity and nothing is ever looked up by it.
 */
const NAME_NOISE = [
  /^ADR ON\s+/i,
  /\s+(ORD\s+)?SHS$/i,
  /,?\s+(INC|CORP|CORPORATION|LTD|LIMITED|PLC|SA|AG|NV|CO|GROUP|HOLDINGS?)\.?$/i,
  /,?\s+CLASS\s+[A-Z]$/i,
];

/** A product name cut down to what identifies it, for a narrow tile. */
export function shortName(product: string | null, isin: string): string {
  let name = (product ?? isin).trim();
  // Repeated because the suffixes stack: "Rubrik, Inc. Class A" sheds the class, then the Inc.
  for (let pass = 0; pass < 3; pass++) {
    for (const noise of NAME_NOISE) {
      name = name.replace(noise, '');
    }
  }
  return name.trim() || product || isin;
}

/** Day only. A statement is read by day; the minute a fill happened is detail for the book. */
export function formatDay(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
