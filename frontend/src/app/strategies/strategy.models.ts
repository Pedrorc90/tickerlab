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
  | 'ICHIMOKU_TK_KUMO'
  | 'ADX'
  | 'GAP_UP';

/**
 * Every number the screen exposes, flattened into one key space — the same shape the
 * indicator periods use, so the storage rule can be the same one: only what was moved.
 */
export type StrategyParamKey =
  | 'emaFast'
  | 'emaSlow'
  | 'emaExit'
  | 'smaFast'
  | 'smaSlow'
  | 'smaExit'
  | 'macdFast'
  | 'macdSlow'
  | 'macdSignal'
  | 'rsiPeriod'
  | 'rsiBuy'
  | 'rsiSell'
  | 'trendMa'
  | 'trendMaType'
  | 'shaPrice'
  | 'shaCandle'
  | 'shaEntryBars'
  | 'shaExitBars'
  | 'shaBodyBuy'
  | 'shaBodySell'
  | 'shaBodyExit'
  | 'ichimokuConversion'
  | 'ichimokuBase'
  | 'ichimokuSpan'
  | 'ichimokuKumo'
  | 'ichimokuPullback'
  | 'adxPeriod'
  | 'adxEntry'
  | 'adxExit'
  | 'gapPercent'
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
 *
 * A window is the length of an average that is not one of the ones the strategy is named
 * after: real bars of a real indicator, but belonging to a rule laid on top. Off the pill
 * for the same reason — `10/40/20` reads as a cross of three lines, and switched off it
 * would read as a cross with a zero in it.
 */
export type ParamUnit = 'bars' | 'level' | 'streak' | 'percent' | 'bps' | 'choice' | 'window';

/**
 * The one param that is not a quantity: a choice between named alternatives, stored as the
 * index of the one picked so it travels through the same number-shaped key space and the same
 * «only what was moved» storage as everything else. Two of them are a pair of buttons; the
 * bounds are the ends of the list, so a value saved before an option was removed clamps back
 * onto a real one.
 */
export type ParamChoices = ReadonlyArray<string>;

/**
 * The line a param draws, named after the chart's own colour rather than the slot: the panel
 * paints a dot with it next to the label, so «Lenta» is read against the line it moves instead
 * of against the other number beside it. Only the averages have one — every param here is a
 * line over the candles, which is what makes the dot mean something.
 *
 * A function where the answer is itself a param: «Precio sobre media» draws a simple average
 * or an exponential one depending on what was picked, and the dot has to change with it.
 */
export type SwatchKey = 'smaFast' | 'smaSlow' | 'emaFast' | 'emaSlow' | 'maExit';

/** One editable number of a strategy. `min`/`max` keep the backtest from going empty. */
export interface StrategyParam {
  key: StrategyParamKey;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  unit: ParamUnit;
  /** Only for `choice`: the alternatives, in order. The stored number is an index into it. */
  choices?: ParamChoices;
  /** The colour of the line this number moves, when it moves one. */
  swatch?: SwatchKey | ((params: StrategyParams) => SwatchKey);
  /**
   * Starts a line of its own in the panel and carries down everything after it. Declared on
   * the number instead of counted by the panel: where a strategy stops naming its periods and
   * starts naming its filters is something only the strategy knows, and a rail this narrow
   * runs out at about four boxes — past that the figure inside stops being readable.
   */
  newLine?: boolean;
}

/**
 * What the chart draws while a strategy is ticked. The slots are the chart's own, named after
 * their textbook periods but carrying whatever the strategy says — so the drawing is one more
 * thing a strategy declares, instead of something the panel has to know per id.
 */
export interface StrategyChart {
  /**
   * A function where the choice of slot is itself a param — one strategy drawing an EMA or an
   * SMA is drawing two different lines, and which one is a question only the numbers answer.
   * A plain array everywhere else: nine of the ten always draw the same thing, and wrapping
   * them in a function would be nine closures returning a constant.
   */
  indicators: ReadonlyArray<Indicator> | ((params: StrategyParams) => ReadonlyArray<Indicator>);
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
    // The cross says when to buy and, left alone, also when to sell — and it sells late by
    // construction: the two lines have to trade places, which is bars after the price stopped
    // going the way it was. «Salida» is the line that closes it early: the position is let go
    // on the first close under an average of its own, without waiting for the lines to meet.
    //
    // A period of its own rather than one of the two already there: the point is a line the
    // price rides and the slow one is nowhere near it, so closing on that is closing on the
    // cross itself. Zero is off, like every other rule laid over a strategy.
    //
    // Once it fires, a new cross is what opens the position again — the fast line has to fall
    // under the slow one and climb back over it. Reading «still crossed» would reopen on the
    // next bar and make the whole field a way of skipping the odd red candle.
    params: [
      {
        key: 'emaFast',
        label: 'Rápida',
        defaultValue: 10,
        min: 2,
        max: 200,
        unit: 'bars',
        swatch: 'emaFast',
      },
      {
        key: 'emaSlow',
        label: 'Lenta',
        defaultValue: 40,
        min: 3,
        max: 400,
        unit: 'bars',
        swatch: 'emaSlow',
      },
      {
        key: 'emaExit',
        label: 'Salida',
        defaultValue: 0,
        min: 0,
        max: 400,
        unit: 'window',
        swatch: 'maExit',
      },
    ],
    // The exit line joins the chart only once it is switched on: at zero there is no rule to
    // draw, and a slot lit with a period of nothing would be a flat line at the bottom.
    chart: {
      indicators: ({ emaExit }) => (emaExit ? ['EMA20', 'EMA50', 'EMA_EXIT'] : ['EMA20', 'EMA50']),
      periods: ({ emaFast, emaSlow, emaExit }) =>
        emaExit ? { emaFast, emaSlow, emaExit } : { emaFast, emaSlow },
    },
  },
  {
    id: 'SMA_CROSS',
    name: 'Cruce de SMAs',
    summary: 'El cruce de siempre, 50 y 200 sobre medias simples.',
    hold: 'la SMA rápida cierra por encima de la lenta',
    // The same exit as the EMA cross, over simple averages and with a period of its own: 20
    // bars under a 50/200 is a different line from 20 under a 10/40, and one key shared by
    // both would move the two strategies at once.
    params: [
      {
        key: 'smaFast',
        label: 'Rápida',
        defaultValue: 50,
        min: 2,
        max: 200,
        unit: 'bars',
        swatch: 'smaFast',
      },
      {
        key: 'smaSlow',
        label: 'Lenta',
        defaultValue: 200,
        min: 3,
        max: 400,
        unit: 'bars',
        swatch: 'smaSlow',
      },
      {
        key: 'smaExit',
        label: 'Salida',
        defaultValue: 0,
        min: 0,
        max: 400,
        unit: 'window',
        swatch: 'maExit',
      },
    ],
    chart: {
      indicators: ({ smaExit }) =>
        smaExit ? ['SMA50', 'SMA200', 'SMA_EXIT'] : ['SMA50', 'SMA200'],
      periods: ({ smaFast, smaSlow, smaExit }) =>
        smaExit ? { smaFast, smaSlow, smaExit } : { smaFast, smaSlow },
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
    // Which average is asked, not only how long: the same 200 bars weighted exponentially is a
    // line that sits somewhere else entirely, and «is the price over its average» is the same
    // question of both. Exponential by default — it is the one that turns with the price, and
    // the filter is there to say when the trend gave up rather than to be gentle about it.
    params: [
      {
        key: 'trendMa',
        label: 'Media',
        defaultValue: 200,
        min: 2,
        max: 400,
        unit: 'bars',
        swatch: ({ trendMaType }) => (trendMaType ? 'emaSlow' : 'smaSlow'),
      },
      {
        key: 'trendMaType',
        label: 'Tipo',
        defaultValue: 1,
        min: 0,
        max: 1,
        unit: 'choice',
        choices: ['SMA', 'EMA'],
      },
    ],
    // The slot follows the choice, so the line drawn is the line the rule read. Sharing the
    // cross strategies' slots rather than owning a pair of its own is what lets the eye check
    // it against them — and if one of those is ticked too it keeps its own periods, which is
    // the same first-one-wins `chartSetup` has always applied.
    chart: {
      indicators: ({ trendMaType }) => (trendMaType ? ['EMA50'] : ['SMA200']),
      periods: ({ trendMa, trendMaType }) =>
        trendMaType ? { emaSlow: trendMa } : { smaSlow: trendMa },
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
        newLine: true,
      },
      {
        key: 'shaBodySell',
        label: 'Cuerpo ↓ %',
        defaultValue: 0,
        min: 0,
        max: 500,
        unit: 'percent',
      },
      // The same measurement as «Cuerpo ↑ %» read from the other end: the figure a green body
      // stops being one at. Entering asks for a body that dwarfs the wick under it; this asks
      // what is left when it no longer does. A green dragging a wick three times its body is
      // the run arguing with itself, and on smoothed candles that lands a bar or two before
      // the first red does — which is the whole point of asking.
      //
      // Two levels over one reading, like the RSI and the ADX: 166 to enter and 33 to leave
      // is one number with a band in the middle where the greens say nothing new and the
      // position is left alone. It is not the red gate under another name — that one decides
      // whether a red counts, and this one closes on a green.
      //
      // Zero is off, and here it has to be more than anywhere else: this is the only figure
      // in the catalogue that can sell on a green bar.
      {
        key: 'shaBodyExit',
        label: 'Agotamiento %',
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
    id: 'ICHIMOKU_TK_KUMO',
    name: 'Cruce sobre la nube',
    summary: 'El cruce de Tenkan y Kijun, pero solo el que se produce sobre una nube despejada.',
    hold: 'el cruce al alza se dio sobre la nube y la conversión no ha vuelto bajo la base',
    // The third reading of the same indicator, and the only one in the catalogue that is an
    // entry rather than a state: what it asks about is the bar the lines crossed on. «Cruce
    // Tenkan-Kijun» is in whenever the conversion is above the base — including the stretch
    // it was already above on while the cloud sat overhead — and where the crossing itself
    // landed is something only that one bar can answer. Hence a memory: once taken, the
    // position is held on the same condition the plain cross holds on, and let go when the
    // conversion closes back under the base.
    //
    // Three rules are the strategy and have no number: the cross upward, the close over the
    // cloud, and the base line over it too. The last is «not inside the cloud» read the way
    // the textbook reads it — a cross drawn between the spans is the classic no-signal, and
    // the lines lag the price enough that they are often still in there on the bar the close
    // finally clears the top.
    //
    // The other two arrived as preferences rather than rules, so they are numbers switched
    // off at zero, like the volume gate: what a filter is worth should be read off the curve
    // and not assumed by the catalogue.
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
      // How bullish the cloud has to be, as a share of the price — not «Span A over Span B»,
      // which a cloud that has been flat for thirty bars satisfies by a rounding error. A
      // distance means the same thing on a 3 EUR stock and on a 300 EUR one, and at 0 the
      // question is not asked at all.
      {
        key: 'ichimokuKumo',
        label: 'Kumo %',
        defaultValue: 0,
        min: 0,
        max: 20,
        unit: 'percent',
        newLine: true,
      },
      // The dip the cross is meant to come out of: the deepest fall from a high inside the
      // last «Base» bars. The window is the base period rather than a fourth number because
      // that is the stretch the Kijun itself is measured over — the correction worth asking
      // about is the one the line the price crossed already knows about.
      {
        key: 'ichimokuPullback',
        label: 'Corrección %',
        defaultValue: 0,
        min: 0,
        max: 50,
        unit: 'percent',
      },
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
  {
    id: 'GAP_UP',
    name: 'Hueco al abrir',
    summary:
      'Compra la sesión que abre con hueco al alza y la suelta antes de cerrarla. Pide una temporalidad intradía y un `Objetivo %`: sin él es aguantar al cierre, que es justo lo que la medida dice que no funciona.',
    hold: 'la sesión abrió con hueco al alza y todavía no ha llegado su última vela',
    // The one strategy in the catalogue that is not a reading of the price but a reading of
    // the clock: it opens on the first bar of a session and is flat before that session ends,
    // never overnight. Measured over 547 gappers of August 2026, holding one to the close
    // sums +97 points and −1.544 without its twenty best trades — four lottery tickets and
    // 527 losers. The same entries with the objective at +6 % sum +382, and +262 with those
    // twenty gone: the edge is not in picking the gap, it is in having a sell order resting
    // above it. Hence the summary: ticked alone this is the losing half of the finding.
    //
    // A stop is deliberately not part of the rule, and the numbers are the argument: 81 % of
    // those gappers traded 2 % under their open at some point in the day, winners included,
    // so a tight stop is thrown out of nearly everything before it can work. `Stop %` is
    // there like it is for every other strategy; what is not here is a default that hides it.
    //
    // Zero is any gap up at all rather than off: the size is the filter, the gap itself is
    // the rule, and a rule that can be switched off is not one. A flat open is not a gap.
    //
    // The exit is the session and not the objective, so the two can be told apart on the
    // panel: a trade closed by `signal` ran out of day, one closed by `target` got paid.
    params: [
      { key: 'gapPercent', label: 'Hueco %', defaultValue: 0, min: 0, max: 100, unit: 'percent' },
    ],
    // Nothing to draw: the rule is the open against yesterday's close, and both are already
    // on the chart as candles. An indicator here would be decoration.
    chart: {
      indicators: [],
      periods: () => ({}),
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
  [
    ...STRATEGIES.flatMap(({ params }) => params),
    TAKE_PROFIT,
    STOP_LOSS,
    VOLUME_FILTER,
    TRADE_COST,
  ].map((param) => [param.key as string, param]),
);

/** The numbers every strategy starts on. Derived so they live in one place. */
export const DEFAULT_STRATEGY_PARAMS: StrategyParams = Object.fromEntries(
  [...STRATEGY_PARAMS.values()].map((param) => [param.key, param.defaultValue]),
) as StrategyParams;

/**
 * The colour of the line a param moves, or null when it moves none. Resolved here rather than
 * in the panel so the two shapes a swatch can take stay the catalogue's business.
 */
export function swatchOf(param: StrategyParam, params: StrategyParams): SwatchKey | null {
  const swatch = param.swatch;
  if (!swatch) {
    return null;
  }
  return typeof swatch === 'function' ? swatch(params) : swatch;
}

/** `10/40` — what the pill wears next to the name. Periods only; a level is not one. */
export function paramSuffix(strategy: Strategy, params: StrategyParams): string {
  return strategy.params
    .filter(({ unit }) => unit === 'bars')
    .map((param) => params[param.key])
    .join('/');
}

/**
 * The numbers of a strategy grouped into the lines the panel draws them on. Declared order is
 * kept and a line runs until the next one asks to start: the split is a reading of what the
 * numbers are — how the indicator is built, then what is laid over it — and not a count of how
 * many fit, which is why it is written next to them rather than measured here.
 *
 * A strategy that asks for nothing comes back as one line, so the panel has a single shape to
 * draw and no special case for the eight of them that never needed the break.
 */
export function paramLines(strategy: Strategy): ReadonlyArray<ReadonlyArray<StrategyParam>> {
  const lines: StrategyParam[][] = [];

  for (const param of strategy.params) {
    if (!lines.length || param.newLine) {
      lines.push([]);
    }
    lines[lines.length - 1].push(param);
  }

  return lines;
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
    const slots = strategy.chart.indicators;
    for (const indicator of typeof slots === 'function' ? slots(params) : slots) {
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
