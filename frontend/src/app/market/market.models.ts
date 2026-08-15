/** Chart granularity. Mirrors the backend `Timeframe` enum. */
export type Timeframe = 'DAY' | 'WEEK' | 'MONTH';

export const TIMEFRAMES: ReadonlyArray<{ value: Timeframe; label: string }> = [
  { value: 'DAY', label: 'Día' },
  { value: 'WEEK', label: 'Semana' },
  { value: 'MONTH', label: 'Mes' },
];

/** One price bar. `time` is epoch seconds, as lightweight-charts expects. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleSeries {
  symbol: string;
  name: string;
  currency: string | null;
  exchange: string | null;
  timeframe: Timeframe;
  candles: Candle[];
}

export interface SymbolMatch {
  symbol: string;
  name: string;
  exchange: string | null;
  sector: string | null;
  industry: string | null;
}
