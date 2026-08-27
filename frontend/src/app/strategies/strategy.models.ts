/**
 * The strategies the backtest screen can run. A catalogue and not a single hard-coded rule
 * set: the screen is «pick one of mine and see it tested», so the list is the screen, and a
 * second entry has to cost one object here plus one signal function in `backtest.ts`.
 */
export type StrategyId = 'EMA_CROSS';

/**
 * Every number a strategy exposes, flattened into one key space — the same shape the
 * indicator periods use, so the storage rule can be the same one: only what was moved.
 */
export type StrategyParamKey = 'emaFast' | 'emaSlow' | 'takeProfit';

export type StrategyParams = Readonly<Record<StrategyParamKey, number>>;

/**
 * What a number counts. Bars are what the strategy is named after and what the pill wears;
 * a percentage is a level the price has to reach, and putting it in `10/40` would read as a
 * third period.
 */
export type ParamUnit = 'bars' | 'percent';

/** One editable number of a strategy. `min`/`max` keep the backtest from going empty. */
export interface StrategyParam {
  key: StrategyParamKey;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  unit: ParamUnit;
}

export interface Strategy {
  id: StrategyId;
  name: string;
  /** What it is, in one line: it sits under the name in the picker. */
  summary: string;
  /** When it buys and when it sells, spelled out. Nothing about a backtest should be implied. */
  entry: string;
  exit: string;
  params: ReadonlyArray<StrategyParam>;
}

/**
 * The first one is what a session opens on. Both periods are free rather than fixed at 10/40:
 * the pair is the whole strategy, and a backtest you cannot move the periods of answers one
 * question instead of the question.
 */
export const STRATEGIES: ReadonlyArray<Strategy> = [
  {
    id: 'EMA_CROSS',
    name: 'Cruce de EMAs',
    summary: 'La media rápida cruza la lenta: dentro al alza, fuera a la baja.',
    entry: 'La EMA rápida cierra por encima de la lenta.',
    exit: 'La EMA rápida cierra por debajo de la lenta, o antes si el cierre gana el objetivo.',
    params: [
      { key: 'emaFast', label: 'Rápida', defaultValue: 10, min: 2, max: 200, unit: 'bars' },
      { key: 'emaSlow', label: 'Lenta', defaultValue: 40, min: 3, max: 400, unit: 'bars' },
      // Zero is the strategy on its own, which is why it is the default: an objective is a
      // second rule laid over the cross, and it should be asked for rather than assumed.
      {
        key: 'takeProfit',
        label: 'Objetivo %',
        defaultValue: 0,
        min: 0,
        max: 500,
        unit: 'percent',
      },
    ],
  },
];

/** The periods every strategy starts on. Derived so the numbers live in one place. */
export const DEFAULT_STRATEGY_PARAMS: StrategyParams = Object.fromEntries(
  STRATEGIES.flatMap(({ params }) => params.map((param) => [param.key, param.defaultValue])),
) as StrategyParams;

/** `10/40` — what the pill wears next to the name. Periods only; a level is not one. */
export function paramSuffix(strategy: Strategy, params: StrategyParams): string {
  return strategy.params
    .filter(({ unit }) => unit === 'bars')
    .map((param) => params[param.key])
    .join('/');
}
