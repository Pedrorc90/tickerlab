/** Chart granularity. Mirrors the backend `Timeframe` enum. */
export type Timeframe = 'DAY' | 'WEEK' | 'MONTH';

export const TIMEFRAMES: ReadonlyArray<{ value: Timeframe; label: string }> = [
  { value: 'DAY', label: 'Día' },
  { value: 'WEEK', label: 'Semana' },
  { value: 'MONTH', label: 'Mes' },
];

/**
 * Indicators the user can switch off. Candles are not one of them: without candles
 * there is no chart. Order here is the order the panes keep on screen.
 */
export type Indicator = 'VOLUME' | 'RSI';

export const INDICATORS: ReadonlyArray<{
  value: Indicator;
  swatch: string;
  label: string;
  hint: string;
}> = [
  { value: 'VOLUME', swatch: 'volume', label: 'Volumen', hint: 'cuántas acciones se negociaron' },
  {
    value: 'RSI',
    swatch: 'rsi',
    label: 'RSI(14)',
    hint: 'verde manda la compra, rojo la venta; sobre 70 recalentado, bajo 30 castigado',
  },
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
