import { ADX_PERIOD, ADX_TREND_THRESHOLD } from '../market/indicators/adx';
import { Indicator, IndicatorPeriods } from '../market/market.models';

/**
 * The strategies the backtest screen can run. A catalogue and not a single hard-coded rule
 * set: the screen is «pick mine and see them tested», so the list is the screen, and a new
 * entry has to cost one object here plus one function in `signals.ts`.
 */
export type StrategyId =
  | 'EMA_CROSS'
  | 'SMA_CROSS'
  | 'MACD'
  | 'RSI'
  | 'PRICE_OVER_MA'
  | 'SHA'
  | 'ICHIMOKU'
  | 'ICHIMOKU_TK'
  | 'ADX';

/**
 * Every number the screen exposes, flattened into one key space — the same shape the
 * indicator periods use, so the storage rule can be the same one: only what was moved.
 */
export type StrategyParamKey =
  | 'emaFast'
  | 'emaSlow'
  | 'smaFast'
  | 'smaSlow'
  | 'macdFast'
  | 'macdSlow'
  | 'macdSignal'
  | 'rsiPeriod'
  | 'rsiBuy'
  | 'rsiSell'
  | 'trendMa'
  | 'shaPrice'
  | 'shaCandle'
  | 'shaEntryBars'
  | 'shaExitBars'
  | 'shaBodyBuy'
  | 'shaBodySell'
  | 'ichimokuConversion'
  | 'ichimokuBase'
  | 'ichimokuSpan'
  | 'adxPeriod'
  | 'adxEntry'
  | 'adxExit'
  | 'takeProfit'
  | 'stopLoss'
  | 'volumeFilter'
  | 'tradeCost';

export type StrategyParams = Readonly<Record<StrategyParamKey, number>>;

/**
 * What a number counts. Bars are what a strategy is named after and what its pill wears; a
 * level is a value the indicator has to reach, and a percentage a share of something else —
 * the entry price, or an average.
 * Putting either in `10/40` would read as a third period.
 *
 * A streak is bars too, but bars of confirmation rather than bars of window: it is a second
 * rule laid over the indicator and not part of how the indicator is built, so it stays off
 * the pill for the same reason a level does — `10/10/3/1` would claim four periods.
 */
export type ParamUnit = 'bars' | 'level' | 'streak' | 'percent' | 'bps';

/** One editable number of a strategy. `min`/`max` keep the backtest from going empty. */
export interface StrategyParam {
  key: StrategyParamKey;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  unit: ParamUnit;
}

/**
 * What the chart draws while a strategy is ticked. The slots are the chart's own, named after
 * their textbook periods but carrying whatever the strategy says — so the drawing is one more
 * thing a strategy declares, instead of something the panel has to know per id.
 */
export interface StrategyChart {
  indicators: ReadonlyArray<Indicator>;
  periods(params: StrategyParams): Partial<IndicatorPeriods>;
}

export interface Strategy {
  id: StrategyId;
  name: string;
  /** What it is, in one line: it sits under the name in the picker. */
  summary: string;
  /**
   * When the position is meant to be open, spelled out. One line and not an entry plus an
   * exit: a strategy states a condition per bar, and the entry is simply the bar that
   * condition turns true on. Two sentences would be describing the same rule twice.
   */
  hold: string;
  params: ReadonlyArray<StrategyParam>;
  chart: StrategyChart;
}

/** How several ticked strategies resolve into one position. */
export type CombineMode = 'ALL' | 'ANY';

export const COMBINE_MODES: ReadonlyArray<{ value: CombineMode; label: string; hint: string }> = [
  { value: 'ALL', label: 'Y', hint: 'Dentro solo cuando todas lo dicen' },
  { value: 'ANY', label: 'O', hint: 'Dentro cuando lo dice cualquiera' },
];

/**
 * The first one is what a session opens on. Every period is free rather than fixed at its
 * textbook value: the numbers are the whole strategy, and a backtest you cannot move them in
 * answers one question instead of the question.
 */
export const STRATEGIES: ReadonlyArray<Strategy> = [
  {
    id: 'EMA_CROSS',
    name: 'Cruce de EMAs',
    summary: 'La media rápida cruza la lenta: dentro al alza, fuera a la baja.',
    hold: 'la EMA rápida cierra por encima de la lenta',
    params: [
      { key: 'emaFast', label: 'Rápida', defaultValue: 10, min: 2, max: 200, unit: 'bars' },
      { key: 'emaSlow', label: 'Lenta', defaultValue: 40, min: 3, max: 400, unit: 'bars' },
    ],
    chart: {
      indicators: ['EMA20', 'EMA50'],
      periods: ({ emaFast, emaSlow }) => ({ emaFast, emaSlow }),
    },
  },
  {
    id: 'SMA_CROSS',
    name: 'Cruce de SMAs',
    summary: 'El cruce de siempre, 50 y 200 sobre medias simples.',
    hold: 'la SMA rápida cierra por encima de la lenta',
    params: [
      { key: 'smaFast', label: 'Rápida', defaultValue: 50, min: 2, max: 200, unit: 'bars' },
      { key: 'smaSlow', label: 'Lenta', defaultValue: 200, min: 3, max: 400, unit: 'bars' },
    ],
    chart: {
      indicators: ['SMA50', 'SMA200'],
      periods: ({ smaFast, smaSlow }) => ({ smaFast, smaSlow }),
    },
  },
  {
    id: 'MACD',
    name: 'MACD',
    summary: 'La línea cruza su señal: el mismo cruce, medido en la distancia entre dos medias.',
    hold: 'la línea MACD va por encima de su señal',
    params: [
      { key: 'macdFast', label: 'Rápida', defaultValue: 12, min: 2, max: 100, unit: 'bars' },
      { key: 'macdSlow', label: 'Lenta', defaultValue: 26, min: 3, max: 200, unit: 'bars' },
      { key: 'macdSignal', label: 'Señal', defaultValue: 9, min: 2, max: 100, unit: 'bars' },
    ],
    chart: {
      indicators: ['MACD'],
      periods: ({ macdFast, macdSlow, macdSignal }) => ({ macdFast, macdSlow, macdSignal }),
    },
  },
  {
    id: 'RSI',
    name: 'RSI',
    summary: 'Entra en sobreventa y aguanta hasta la sobrecompra.',
    hold: 'el RSI ha caído bajo el nivel de compra y aún no ha tocado el de venta',
    params: [
      { key: 'rsiPeriod', label: 'Periodo', defaultValue: 14, min: 2, max: 100, unit: 'bars' },
      { key: 'rsiBuy', label: 'Compra', defaultValue: 30, min: 1, max: 99, unit: 'level' },
      { key: 'rsiSell', label: 'Venta', defaultValue: 70, min: 1, max: 99, unit: 'level' },
    ],
    chart: {
      indicators: ['RSI'],
      periods: ({ rsiPeriod }) => ({ rsi: rsiPeriod }),
    },
  },
  {
    id: 'PRICE_OVER_MA',
    name: 'Precio sobre media',
    summary: 'Dentro mientras el cierre aguante sobre su media. El filtro de tendencia de siempre.',
    hold: 'el cierre está por encima de la media',
    params: [{ key: 'trendMa', label: 'Media', defaultValue: 200, min: 2, max: 400, unit: 'bars' }],
    chart: {
      indicators: ['SMA200'],
      periods: ({ trendMa }) => ({ smaSlow: trendMa }),
    },
  },
  {
    id: 'SHA',
    name: 'Heikin Ashi suavizado',
    summary: 'Cuenta velas del mismo color: entra cuando el verde se confirma, sale con el rojo.',
    hold: 'la vela suavizada ha encadenado las verdes de la entrada y aún no las rojas de la salida',
    // One and one is the colour of the body on its own — the strategy with no filter. It is
    // left there for the same reason the objective is left at zero: a confirmation is a
    // second rule laid over the first, and it should be asked for rather than found already
    // switched on. The two are separate because that is the asymmetry worth testing: three
    // greens to commit and one red to leave is a different strategy from three of each.
    params: [
      { key: 'shaPrice', label: 'Precio', defaultValue: 10, min: 2, max: 100, unit: 'bars' },
      { key: 'shaCandle', label: 'Velas', defaultValue: 10, min: 2, max: 100, unit: 'bars' },
      { key: 'shaEntryBars', label: 'Entrada', defaultValue: 1, min: 1, max: 50, unit: 'streak' },
      { key: 'shaExitBars', label: 'Salida', defaultValue: 1, min: 1, max: 50, unit: 'streak' },
      // Off at zero, like the objective and the volume gate: it is a rule laid over the colour
      // rather than part of it, and a filter that comes already switched on changes the answer
      // without being asked. The wick each is measured against is the one the move should have
      // left behind — the lower one under a green body, the upper one over a red — so 300 asks
      // for a body three times the wick pointing back the way it came. Under 100 it asks for
      // the opposite, which is the same comparison read from the other side.
      //
      // Two numbers and not one, for the same reason the streaks are two: the sides are not
      // symmetric. A rally is built by bodies that keep grinding and a break by one that
      // gaps, so the size that proves a green is not the size that proves a red — and a
      // single figure would force the strictness of whichever side you cared about onto the
      // other. Left at zero, one side can be filtered while the other stays as it was.
      {
        key: 'shaBodyBuy',
        label: 'Cuerpo ↑ %',
        defaultValue: 0,
        min: 0,
        max: 500,
        unit: 'percent',
      },
      {
        key: 'shaBodySell',
        label: 'Cuerpo ↓ %',
        defaultValue: 0,
        min: 0,
        max: 500,
        unit: 'percent',
      },
    ],
    chart: {
      indicators: ['SHA'],
      periods: ({ shaPrice, shaCandle }) => ({ shaPrice, shaCandle }),
    },
  },
  {
    id: 'ICHIMOKU',
    name: 'Ichimoku',
    summary: 'Dentro cuando el precio deja la nube por debajo y la nube sigue subiendo.',
    hold: 'el cierre está por encima de la nube y la nube es alcista',
    // The cloud is read on the bar it was drawn onto, not on the bars it was computed from:
    // the displacement is the indicator, and reading it back where it was calculated would
    // be checking the price against a level nobody could see yet.
    //
    // Two halves and not one: over the cloud is where the price stands, and Span A over
    // Span B is where the cloud is going. The first alone lets a position stay open all the
    // way down a cloud that has already turned, which is the trade Ichimoku exists to avoid.
    // The lagging span is left out — it says something about a bar twenty-six back, and a
    // stance is about this one.
    params: [
      {
        key: 'ichimokuConversion',
        label: 'Conversión',
        defaultValue: 9,
        min: 2,
        max: 100,
        unit: 'bars',
      },
      { key: 'ichimokuBase', label: 'Base', defaultValue: 26, min: 2, max: 200, unit: 'bars' },
      { key: 'ichimokuSpan', label: 'Nube', defaultValue: 52, min: 2, max: 400, unit: 'bars' },
    ],
    chart: {
      indicators: ['ICHIMOKU'],
      periods: ({ ichimokuConversion, ichimokuBase, ichimokuSpan }) => ({
        ichimokuConversion,
        ichimokuBase,
        ichimokuSpan,
      }),
    },
  },
  {
    id: 'ICHIMOKU_TK',
    name: 'Cruce Tenkan-Kijun',
    summary: 'El cruce de las dos líneas rápidas de Ichimoku, sin mirar la nube.',
    hold: 'la conversión cierra por encima de la base',
    // Apart from the cloud strategy instead of folded into it: they are two readings of the
    // same indicator and the point is being able to tell them apart — ticked together with
    // «Y» they are the full Ichimoku entry, and each on its own says what it was worth.
    //
    // The periods are the cloud strategy's own keys and not a private pair: it is the same
    // indicator drawn once, so two sets of numbers would leave the chart showing whichever
    // strategy was listed first while the other traded on figures nobody can see.
    //
    // The cloud period is not declared here because the rule never reads it. The chart still
    // draws the cloud — it is one indicator and it comes whole — but on the slot's default:
    // a number a strategy cannot use is a number it has no business owning.
    params: [
      {
        key: 'ichimokuConversion',
        label: 'Conversión',
        defaultValue: 9,
        min: 2,
        max: 100,
        unit: 'bars',
      },
      { key: 'ichimokuBase', label: 'Base', defaultValue: 26, min: 2, max: 200, unit: 'bars' },
    ],
    chart: {
      indicators: ['ICHIMOKU'],
      periods: ({ ichimokuConversion, ichimokuBase }) => ({ ichimokuConversion, ichimokuBase }),
    },
  },
  {
    id: 'ADX',
    name: 'ADX',
    summary: 'Dentro solo mientras la tendencia tenga fuerza. Un filtro, no una señal.',
    hold: 'el ADX ha superado el nivel de entrada y aún no ha caído bajo el de salida',
    // Strength and not direction: the ADX rises just as hard on the way down, so ticked on
    // its own this one buys crashes. It is meant to go next to whatever decides the side —
    // the smoothed candles, a cross — with «Y». It sits in the catalogue rather than off to
    // one side with the volume gate because «is there a trend» is something every bar
    // answers, and a state per bar is exactly what a stance is.
    //
    // Two levels, like the RSI, and for the opposite reason: the ADX slides back inside
    // perfectly healthy trends as soon as they stop accelerating — it measures the widening
    // and not the move — so one threshold would close the winners halfway up. It enters
    // strict and holds loose, and between the two figures it says nothing new.
    //
    // The entry level is the chart's own line rather than a number of its own: the pane
    // already draws 25 as the mark that separates a trend from a drift, and a strategy
    // entering somewhere else by default would be arguing with the line under it.
    params: [
      {
        key: 'adxPeriod',
        label: 'Periodo',
        defaultValue: ADX_PERIOD,
        min: 2,
        max: 100,
        unit: 'bars',
      },
      {
        key: 'adxEntry',
        label: 'Entrada',
        defaultValue: ADX_TREND_THRESHOLD,
        min: 1,
        max: 100,
        unit: 'level',
      },
      { key: 'adxExit', label: 'Salida', defaultValue: 20, min: 1, max: 100, unit: 'level' },
    ],
    chart: {
      indicators: ['ADX'],
      periods: ({ adxPeriod }) => ({ adx: adxPeriod }),
    },
  },
];

/**
 * The objective is written apart from the catalogue on purpose: it is measured against the
 * entry price, which is something no rule knows about, and with several strategies ticked
 * there is no single one it could belong to. It sits over whatever the combination decided.
 * Zero is the strategies on their own, which is why it is the default: an objective is a
 * second rule laid on top, and it should be asked for rather than assumed.
 */
export const TAKE_PROFIT: StrategyParam = {
  key: 'takeProfit',
  label: 'Objetivo %',
  defaultValue: 0,
  min: 0,
  max: 500,
  unit: 'percent',
};

/**
 * The objective read from the other side, and written apart from the catalogue for the same
 * reason: it is measured against the entry price, which no rule knows about, and with several
 * strategies ticked there is no single one it could belong to. Zero is off — a stop is a
 * second rule laid over the strategies, and one that arrives already switched on answers a
 * question nobody asked.
 *
 * A distance and not a price: the same numbers run over years of candles and over a basket of
 * fifty symbols, so a level in euros would mean something on one chart and one trade and
 * nothing anywhere else. As a share of the entry it says the same thing everywhere.
 */
export const STOP_LOSS: StrategyParam = {
  key: 'stopLoss',
  label: 'Stop %',
  defaultValue: 0,
  min: 0,
  max: 100,
  unit: 'percent',
};

/**
 * The other rule laid over the catalogue, and apart from it for the same reason: volume is
 * not what any of these strategies is about, and with several ticked there is no single one
 * it could belong to. It gates the opening and nothing else — a share of the volume average,
 * so 100 is an ordinary session and 200 is twice one.
 *
 * Only the entry, because volume is a burst and not a state: it dries up as soon as a trend
 * settles into itself, so held bar by bar it would close almost every position two or three
 * bars in and leave a test of the filter instead of a test of the rules. Zero is off.
 */
export const VOLUME_FILTER: StrategyParam = {
  key: 'volumeFilter',
  label: 'Volumen %',
  defaultValue: 0,
  min: 0,
  max: 400,
  unit: 'percent',
};

/**
 * What a round trip costs, in basis points over the position: 10 is 0.1 %. Laid over the
 * catalogue like the objective and the stop, and charged once per closed trade, entry and
 * exit together — a single field reads as the price of the whole operation.
 *
 * Basis points and not euros, though a broker charges a flat fee: this curve starts at 100
 * and is read as a percentage, so money would need a real capital to divide by. Divide it
 * yourself — 1 $ a side on a 2.000 EUR position is 10 points the round trip, 2 EUR a side is
 * 20 — and a smaller position is simply a bigger number here.
 *
 * Zero is off, like the other two: it is what every test already run was measured with, and a
 * cost that arrived switched on would redraw those numbers without saying so.
 */
export const TRADE_COST: StrategyParam = {
  key: 'tradeCost',
  label: 'Coste pb',
  defaultValue: 0,
  min: 0,
  max: 200,
  unit: 'bps',
};

/** Every param by key, so a stored number can be checked against its own bounds. */
export const STRATEGY_PARAMS: ReadonlyMap<string, StrategyParam> = new Map(
  [...STRATEGIES.flatMap(({ params }) => params), TAKE_PROFIT, STOP_LOSS, VOLUME_FILTER, TRADE_COST].map(
    (param) => [param.key as string, param],
  ),
);

/** The numbers every strategy starts on. Derived so they live in one place. */
export const DEFAULT_STRATEGY_PARAMS: StrategyParams = Object.fromEntries(
  [...STRATEGY_PARAMS.values()].map((param) => [param.key, param.defaultValue]),
) as StrategyParams;

/** `10/40` — what the pill wears next to the name. Periods only; a level is not one. */
export function paramSuffix(strategy: Strategy, params: StrategyParams): string {
  return strategy.params
    .filter(({ unit }) => unit === 'bars')
    .map((param) => params[param.key])
    .join('/');
}

/**
 * The chart slots the ticked strategies ask for, merged in the order they were declared.
 * Two of them can want the same slot — the SMA cross and the trend filter are both a long
 * simple average — and the first one wins rather than the last: the panel lists them in
 * catalogue order, so «the first» is the one higher up the screen, which is the one whose
 * number the eye will go looking for on the chart.
 */
export function chartSetup(
  ticked: ReadonlyArray<Strategy>,
  params: StrategyParams,
): { indicators: ReadonlySet<Indicator>; periods: Partial<IndicatorPeriods> } {
  const indicators = new Set<Indicator>();
  const periods: Record<string, number> = {};

  for (const strategy of ticked) {
    for (const indicator of strategy.chart.indicators) {
      indicators.add(indicator);
    }
    for (const [key, value] of Object.entries(strategy.chart.periods(params))) {
      if (!(key in periods) && value !== undefined) {
        periods[key] = value;
      }
    }
  }

  return { indicators, periods: periods as Partial<IndicatorPeriods> };
}
