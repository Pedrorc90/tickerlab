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
export type Indicator = 'SMA50' | 'SMA200' | 'VOLUME' | 'RSI' | 'MACD';

export const INDICATORS: ReadonlyArray<{
  value: Indicator;
  swatch: string;
  label: string;
  hint: string;
  /** Drawn on top of the candles instead of getting a pane of its own. */
  overlay: boolean;
}> = [
  { value: 'SMA50', swatch: 'sma50', label: 'SMA 50', hint: 'tendencia media', overlay: true },
  { value: 'SMA200', swatch: 'sma200', label: 'SMA 200', hint: 'tendencia de fondo', overlay: true },
  { value: 'VOLUME', swatch: 'volume', label: 'Volumen', hint: 'acciones negociadas', overlay: false },
  { value: 'RSI', swatch: 'rsi', label: 'RSI(14)', hint: 'fuerza compradora', overlay: false },
  { value: 'MACD', swatch: 'macd', label: 'MACD', hint: 'giros de tendencia', overlay: false },
];

/** One point of a computed indicator. `time` matches the candle it came from. */
export interface IndicatorPoint {
  time: number;
  value: number;
}

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
