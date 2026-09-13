/** Chart granularity. Mirrors the backend `Timeframe` enum. */
export type Timeframe = 'QUARTER_HOUR' | 'HOUR' | 'DAY' | 'WEEK' | 'MONTH';

/**
 * `short` is what the buttons wear: three initials read as one control, where three words read
 * as a sentence and take a third of the bar to say what a letter says. The full word stays for
 * the tooltip and for anything that has room to spell it out.
 */
export const TIMEFRAMES: ReadonlyArray<{ value: Timeframe; label: string; short: string }> = [
  { value: 'QUARTER_HOUR', label: '15 minutos', short: '15m' },
  { value: 'HOUR', label: 'Hora', short: '1H' },
  { value: 'DAY', label: 'Día', short: 'D' },
  { value: 'WEEK', label: 'Semana', short: 'S' },
  { value: 'MONTH', label: 'Mes', short: 'M' },
];

/**
 * How the price itself is drawn. Indicators are untouched by it: every one of them reads
 * the same candles whatever shape the price takes.
 */
export type ChartType = 'CANDLES' | 'BARS' | 'LINE' | 'AREA';

export const CHART_TYPES: ReadonlyArray<{ value: ChartType; label: string }> = [
  { value: 'CANDLES', label: 'Velas' },
  { value: 'BARS', label: 'Barras' },
  { value: 'LINE', label: 'Línea' },
  { value: 'AREA', label: 'Área' },
];

/**
 * Indicators the user can switch off. Candles are not one of them: without candles
 * there is no chart. Order here is the order the panes keep on screen.
 */
export type Indicator =
  | 'SMA50'
  | 'SMA200'
  | 'EMA20'
  | 'EMA50'
  | 'EMA_EXIT'
  | 'SMA_EXIT'
  | 'BOLLINGER'
  | 'SHA'
  | 'ICHIMOKU'
  | 'RS'
  | 'VOLUME'
  | 'RSI'
  | 'MACD'
  | 'ATR'
  | 'ADX';

/**
 * Every period the user can edit, flattened into one key space. An indicator owns one or
 * more of these; the chart reads them straight from `IndicatorPeriods`.
 */
export type PeriodKey =
  | 'smaFast'
  | 'smaSlow'
  | 'emaFast'
  | 'emaSlow'
  | 'emaExit'
  | 'smaExit'
  | 'bollinger'
  | 'bollingerDeviations'
  | 'shaPrice'
  | 'shaCandle'
  | 'ichimokuConversion'
  | 'ichimokuBase'
  | 'ichimokuSpan'
  | 'volumeAverage'
  | 'rsi'
  | 'macdFast'
  | 'macdSlow'
  | 'macdSignal'
  | 'atr'
  | 'adx';

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
  /**
   * A slot only a strategy ever switches on: it is here so the chart knows how to draw it and
   * what period it carries, not so it can be picked from the legend. Ticking «media de salida»
   * by hand on the market screen would be choosing a rule without the strategy it belongs to.
   */
  strategyOnly?: boolean;
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
    value: 'EMA20',
    swatch: 'ema20',
    label: 'EMA',
    hint: 'Media que pesa lo reciente: gira antes que la SMA.',
    overlay: true,
    params: [{ key: 'emaFast', label: 'Periodo', defaultValue: 20, min: 2, max: 400 }],
  },
  {
    value: 'EMA50',
    swatch: 'ema50',
    label: 'EMA',
    hint: 'La misma media, más lenta: soporte en tendencia.',
    overlay: true,
    params: [{ key: 'emaSlow', label: 'Periodo', defaultValue: 50, min: 2, max: 400 }],
  },
  // The line that closes a cross early, one per kind of average: the exit of an EMA cross is
  // an EMA and that of an SMA cross an SMA, and a single shared slot would have to be told
  // which. Their periods are the strategies' own keys, so what is drawn is what was tested.
  {
    value: 'EMA_EXIT',
    swatch: 'maExit',
    label: 'Salida',
    hint: 'La media que cierra el cruce sin esperar a que se deshaga.',
    overlay: true,
    strategyOnly: true,
    params: [{ key: 'emaExit', label: 'Periodo', defaultValue: 20, min: 2, max: 400 }],
  },
  {
    value: 'SMA_EXIT',
    swatch: 'maExit',
    label: 'Salida',
    hint: 'La misma salida, sobre media simple.',
    overlay: true,
    strategyOnly: true,
    params: [{ key: 'smaExit', label: 'Periodo', defaultValue: 20, min: 2, max: 400 }],
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
    value: 'SHA',
    swatch: 'sha',
    label: 'SHA',
    hint: 'Velas promediadas: deja el ruido fuera y solo la tendencia.',
    // Drawn over the real candles rather than in place of them: the point of the smoothing
    // is what it leaves out, and that only reads next to the bars it left out.
    overlay: true,
    params: [
      { key: 'shaPrice', label: 'Precio', defaultValue: 10, min: 2, max: 100 },
      { key: 'shaCandle', label: 'Velas', defaultValue: 10, min: 2, max: 100 },
    ],
  },
  {
    value: 'ICHIMOKU',
    swatch: 'ichimoku',
    label: 'Ichimoku',
    hint: 'Tendencia, soporte y nube: el cuadro entero.',
    overlay: true,
    // The displacement is not a fourth number: it is the base period, the way Hosoda tied
    // them together, so moving the base moves the cloud and the lagging span with it.
    params: [
      { key: 'ichimokuConversion', label: 'Conversión', defaultValue: 9, min: 2, max: 100 },
      { key: 'ichimokuBase', label: 'Base', defaultValue: 26, min: 2, max: 200 },
      { key: 'ichimokuSpan', label: 'Nube', defaultValue: 52, min: 2, max: 400 },
    ],
  },
  {
    value: 'RS',
    swatch: 'rs',
    label: 'RS',
    hint: 'Fuerza frente al S&P 500: si sube, lo bate.',
    // Drawn over the price on a scale of its own, the way IBD does it: the shape is read
    // against the candles below, so splitting them into two panes loses the comparison.
    overlay: true,
    // The benchmark is fixed and the ratio has no window to average, so there is nothing
    // to tune: this is the one indicator whose pill carries no numbers.
    params: [],
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
  {
    value: 'ATR',
    swatch: 'atr',
    label: 'ATR',
    hint: 'Recorrido típico de una vela: mide la volatilidad.',
    overlay: false,
    params: [{ key: 'atr', label: 'Periodo', defaultValue: 14, min: 2, max: 100 }],
  },
  {
    value: 'ADX',
    swatch: 'adx',
    label: 'ADX',
    hint: 'Fuerza de la tendencia, con quién manda: compra o venta.',
    overlay: false,
    params: [{ key: 'adx', label: 'Periodo', defaultValue: 14, min: 2, max: 100 }],
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

/**
 * One trade boundary drawn on the price pane. It carries what happened, not how it looks:
 * the colours belong to the palette, so the chart is the one that turns `kind` into a hue.
 */
export interface TradeMarker {
  time: number;
  kind: 'buy' | 'sell';
  /** Rides next to the arrow. Short by force: it is drawn against the bars. */
  text: string;
}
