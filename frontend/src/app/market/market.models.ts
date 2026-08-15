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
export type Indicator = 'SMA50' | 'SMA200' | 'BOLLINGER' | 'VOLUME' | 'RSI' | 'MACD';

/**
 * Every period the user can edit, flattened into one key space. An indicator owns one or
 * more of these; the chart reads them straight from `IndicatorPeriods`.
 */
export type PeriodKey =
  | 'smaFast'
  | 'smaSlow'
  | 'bollinger'
  | 'bollingerDeviations'
  | 'volumeAverage'
  | 'rsi'
  | 'macdFast'
  | 'macdSlow'
  | 'macdSignal';

export type IndicatorPeriods = Readonly<Record<PeriodKey, number>>;

/** One editable number of an indicator. `min`/`max` keep the chart from going blank. */
export interface PeriodParam {
  key: PeriodKey;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
}

export const INDICATORS: ReadonlyArray<{
  value: Indicator;
  swatch: string;
  /** Name without periods: the current ones are appended by `periodSuffix`. */
  label: string;
  /** What the indicator says, in plain words. Ten words at most: it sits under the pill. */
  hint: string;
  /** Drawn on top of the candles instead of getting a pane of its own. */
  overlay: boolean;
  /** Editable periods, in the order the popover shows them. Empty means nothing to tune. */
  params: ReadonlyArray<PeriodParam>;
}> = [
  {
    value: 'SMA50',
    swatch: 'sma50',
    label: 'SMA',
    hint: 'Media del precio: marca la tendencia a medio plazo.',
    overlay: true,
    params: [{ key: 'smaFast', label: 'Periodo', defaultValue: 50, min: 2, max: 400 }],
  },
  {
    value: 'SMA200',
    swatch: 'sma200',
    label: 'SMA',
    hint: 'Media larga: separa mercado alcista de bajista.',
    overlay: true,
    params: [{ key: 'smaSlow', label: 'Periodo', defaultValue: 200, min: 2, max: 400 }],
  },
  {
    value: 'BOLLINGER',
    swatch: 'bollinger',
    label: 'BB',
    hint: 'Rango normal del precio: fuera de banda, está estirado.',
    overlay: true,
    params: [
      { key: 'bollinger', label: 'Periodo', defaultValue: 20, min: 2, max: 200 },
      { key: 'bollingerDeviations', label: 'Desviaciones', defaultValue: 2, min: 1, max: 4 },
    ],
  },
  {
    value: 'VOLUME',
    swatch: 'volume',
    label: 'Volumen',
    hint: 'Negociado por vela, con su media: mide el interés.',
    overlay: false,
    params: [{ key: 'volumeAverage', label: 'Media', defaultValue: 20, min: 2, max: 200 }],
  },
  {
    value: 'RSI',
    swatch: 'rsi',
    label: 'RSI',
    hint: 'Mide si el precio está sobrecomprado o sobrevendido.',
    overlay: false,
    params: [{ key: 'rsi', label: 'Periodo', defaultValue: 14, min: 2, max: 100 }],
  },
  {
    value: 'MACD',
    swatch: 'macd',
    label: 'MACD',
    hint: 'Cruce de medias: avisa de giros en la tendencia.',
    overlay: false,
    params: [
      { key: 'macdFast', label: 'Rápida', defaultValue: 12, min: 2, max: 100 },
      { key: 'macdSlow', label: 'Lenta', defaultValue: 26, min: 3, max: 200 },
      { key: 'macdSignal', label: 'Señal', defaultValue: 9, min: 2, max: 100 },
    ],
  },
];

/** The textbook periods every indicator starts on. Derived so the numbers live in one place. */
export const DEFAULT_PERIODS: IndicatorPeriods = Object.fromEntries(
  INDICATORS.flatMap(({ params }) => params.map((param) => [param.key, param.defaultValue])),
) as IndicatorPeriods;

/** `12/26/9` for MACD, `50` for an SMA, empty for indicators with nothing to tune. */
export function periodSuffix(
  params: ReadonlyArray<PeriodParam>,
  periods: IndicatorPeriods,
): string {
  return params.map((param) => periods[param.key]).join('/');
}

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
