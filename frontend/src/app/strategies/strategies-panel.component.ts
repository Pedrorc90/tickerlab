import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';
import {
  CandleSeries,
  ChartType,
  DEFAULT_PERIODS,
  Indicator,
  IndicatorPeriods,
} from '../market/market.models';
import { PriceChartComponent } from '../market/price-chart.component';
import { formatPercent, formatPrice } from '../screener/screener.models';
import { STARTING_CAPITAL, runBacktest } from './backtest';
import {
  DEFAULT_STRATEGY_PARAMS,
  STRATEGIES,
  Strategy,
  StrategyParam,
  StrategyParams,
  paramSuffix,
} from './strategy.models';

/** Which strategy was last run. UI state, so it stays in the browser. */
const STRATEGY_KEY = 'tickerlab.strategy';

/** Its periods. Same rule as the indicator ones: only what was moved off the default. */
const PARAMS_KEY = 'tickerlab.strategyParams';

/**
 * The chart draws the strategy and only the strategy: the two averages it crosses, over the
 * candles, and nothing the legend of the other screen has switched on. The slots are named
 * after their textbook periods but carry whatever `emaFast`/`emaSlow` say, which is exactly
 * what the strategy params are called.
 */
const STRATEGY_INDICATORS: ReadonlySet<Indicator> = new Set<Indicator>(['EMA20', 'EMA50']);

/** The equity sparkline's box. Drawn with `preserveAspectRatio="none"`, so it is a grid, not px. */
const SPARK_WIDTH = 240;
const SPARK_HEIGHT = 44;

/** Enough points to keep the shape and few enough to keep the path string small. */
const SPARK_POINTS = 400;

const DATE_FORMAT = new Intl.DateTimeFormat('es-ES', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});

/** Every param by key, so a stored number can be checked against its own bounds. */
const STRATEGY_PARAMS = new Map<string, StrategyParam>(
  STRATEGIES.flatMap(({ params }) => params.map((param) => [param.key as string, param])),
);

function storedStrategy(): Strategy {
  const saved = localStorage.getItem(STRATEGY_KEY);
  return STRATEGIES.find(({ id }) => id === saved) ?? STRATEGIES[0];
}

/**
 * Same rule the indicator periods follow: what is stored is only what was moved off its
 * default, so a param added in a later version starts on its textbook value instead of being
 * missing from every map saved before it existed. Stored numbers are clamped again on the way
 * in — the bounds may have tightened since, and a value outside them empties the backtest.
 */
function storedParams(): StrategyParams {
  try {
    const saved = JSON.parse(localStorage.getItem(PARAMS_KEY) ?? '{}') as Record<string, unknown>;
    const moved = Object.entries(saved).flatMap(([key, value]) => {
      const param = STRATEGY_PARAMS.get(key);
      if (!param || typeof value !== 'number' || !Number.isInteger(value)) {
        return [];
      }
      return [[key, Math.min(param.max, Math.max(param.min, value))] as const];
    });
    return { ...DEFAULT_STRATEGY_PARAMS, ...Object.fromEntries(moved) };
  } catch {
    return DEFAULT_STRATEGY_PARAMS;
  }
}

@Component({
  selector: 'app-strategies-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PriceChartComponent],
  template: `
    <section class="setup">
      <div class="picker" role="group" aria-label="Estrategia">
        @for (option of strategies; track option.id) {
          <button
            type="button"
            class="strategy"
            [class.active]="strategy().id === option.id"
            [title]="option.summary"
            (click)="select(option)"
          >
            {{ option.name }}
            <span class="strategy-periods">{{ suffix(option) }}</span>
          </button>
        }
      </div>

      @for (param of strategy().params; track param.key) {
        <label class="param">
          {{ param.label }}
          <input
            #box
            type="number"
            [min]="param.min"
            [max]="param.max"
            [value]="params()[param.key]"
            (change)="box.value = setParam(param, box.value)"
          />
        </label>
      }

      <!-- The rules and what the simulation leaves out, side by side: a backtest that does not
           say what it charged is a number nobody can compare with anything. -->
      <p class="rules">
        <span class="rule"><span class="dot buy"></span>{{ strategy().entry }}</span>
        <span class="rule"><span class="dot sell"></span>{{ strategy().exit }}</span>
        <span class="caveat">Al cierre, todo dentro y todo fuera · sin stop ni comisiones</span>
      </p>
    </section>

    <main class="chart-area">
      <app-price-chart
        [series]="series()"
        [chartType]="chartType()"
        [indicators]="chartIndicators"
        [periods]="chartPeriods()"
        [markers]="backtest().markers"
      />
    </main>

    <section class="tester" aria-label="Resultado del backtest">
      <div class="summary">
        <header class="summary-head">
          <div class="headline">
            <span class="headline-label">Rentabilidad</span>
            <span
              class="headline-value"
              [class.up]="stats().totalReturn > 0"
              [class.down]="stats().totalReturn < 0"
            >
              {{ percent(stats().totalReturn) }}
            </span>
            <span class="headline-note">
              comprar y mantener {{ percent(stats().buyHoldReturn) }}
            </span>
          </div>

          @if (spark(); as curve) {
            <svg
              class="equity"
              [attr.viewBox]="'0 0 ' + sparkWidth + ' ' + sparkHeight"
              preserveAspectRatio="none"
              aria-label="Curva de capital"
            >
              <line
                class="equity-base"
                x1="0"
                [attr.y1]="curve.base"
                [attr.x2]="sparkWidth"
                [attr.y2]="curve.base"
              />
              <path
                class="equity-line"
                [class.up]="stats().totalReturn > 0"
                [class.down]="stats().totalReturn < 0"
                [attr.d]="curve.path"
              />
            </svg>
          }
        </header>

        <dl class="stats">
          <div class="stat">
            <dt>Operaciones</dt>
            <dd>
              {{ stats().closedTrades }}
              @if (stats().openTrade) {
                <span class="stat-note">+1 abierta</span>
              }
            </dd>
          </div>
          <div class="stat"><dt>Aciertos</dt><dd>{{ hits() }}</dd></div>
          <div class="stat">
            <dt>Ganancia media</dt>
            <dd class="up">{{ percent(stats().averageWin) }}</dd>
          </div>
          <div class="stat">
            <dt>Pérdida media</dt>
            <dd class="down">{{ percent(stats().averageLoss) }}</dd>
          </div>
          <div class="stat"><dt>Factor</dt><dd>{{ factor(stats().profitFactor) }}</dd></div>
          <div class="stat">
            <dt>Caída máxima</dt>
            <dd class="down">{{ percent(stats().maxDrawdown) }}</dd>
          </div>
          <div class="stat"><dt>Exposición</dt><dd>{{ ratio(stats().exposure, '%') }}</dd></div>
          <div class="stat">
            <dt>Duración media</dt>
            <dd>{{ ratio(stats().averageBars, ' velas') }}</dd>
          </div>
        </dl>
      </div>

      <div class="trades">
        <table>
          <thead>
            <tr>
              <th class="num">#</th>
              <th>Entrada</th>
              <th class="num">Precio</th>
              <th>Salida</th>
              <th class="num">Precio</th>
              <th class="num">Velas</th>
              <th class="num">Resultado</th>
            </tr>
          </thead>
          <tbody>
            @for (trade of recentFirst(); track trade.entryTime; let i = $index) {
              <tr [class.running]="trade.open">
                <td class="num">{{ trades().length - i }}</td>
                <td>{{ date(trade.entryTime) }}</td>
                <td class="num">{{ price(trade.entryPrice) }}</td>
                <td>{{ trade.exitTime === null ? 'abierta' : date(trade.exitTime) }}</td>
                <td class="num">{{ price(trade.exitPrice) }}</td>
                <td class="num">{{ trade.bars }}</td>
                <td
                  class="num"
                  [class.up]="trade.returnPercent > 0"
                  [class.down]="trade.returnPercent < 0"
                >
                  {{ percent(trade.returnPercent) }}
                </td>
              </tr>
            } @empty {
              <tr>
                <td class="empty" colspan="7">
                  {{
                    series()
                      ? 'Las medias no llegan a cruzarse en este histórico.'
                      : 'Busca un ticker para probar la estrategia.'
                  }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    <!-- The watchlists, handed in from the shell rather than built here: they are already bound
         to the ticker and the search box up there, and a second instance would be a second
         source of truth for the same three lists. -->
    <aside class="dock">
      <ng-content />
    </aside>
  `,
  styles: `
    :host {
      display: grid;
      /* Setup on top, candles taking whatever is left, tester anchored at the bottom: the
         chart is the only part that should grow, and the numbers never leave the screen.
         The watchlists dock down the right at the same width they have on the chart screen. */
      grid-template-rows: auto 1fr auto;
      grid-template-columns: minmax(0, 1fr) 15rem;
      min-height: 0;
      overflow: hidden;
      background: var(--bg-app);
    }

    /* Spans chart and tester so the list is as tall as it is on the chart screen. Its own grid
       rather than a plain box: that is what makes the panel projected into it fill the dock,
       which no rule of this component could reach — the content belongs to the shell's view. */
    .dock {
      grid-column: 2;
      grid-row: 2 / -1;
      display: grid;
      min-height: 0;
      overflow: hidden;
    }

    /* Crosses both columns, the way the screener's filter bar does: the strategy and its
       periods head the whole screen, not the chart alone. */
    .setup {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem 0.75rem;
      padding: 0.5rem 0.9rem;
      background: var(--bg-panel);
      border-bottom: 1px solid var(--border);
    }

    .picker {
      display: flex;
      gap: 0.25rem;
      padding: 0.2rem;
      background: var(--bg-raised);
      border: 1px solid var(--border);
      border-radius: 6px;
    }

    .strategy {
      display: inline-flex;
      align-items: baseline;
      gap: 0.35rem;
      padding: 0.3rem 0.6rem;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: var(--text-secondary);
      font: inherit;
      font-size: 0.85rem;
      cursor: pointer;
    }

    .strategy:hover {
      color: var(--text);
    }

    .strategy.active {
      background: var(--accent);
      color: var(--on-accent);
    }

    .strategy-periods {
      font-size: 0.75rem;
      opacity: 0.75;
      font-variant-numeric: tabular-nums;
    }

    .param {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      color: var(--text-label);
      font-size: 0.8rem;
    }

    .param input {
      width: 3.6rem;
      padding: 0.2rem 0.4rem;
      border: 1px solid var(--border-control);
      border-radius: 4px;
      background: var(--bg-app);
      color: var(--text-input);
      font: inherit;
      font-size: 0.8rem;
    }

    .param input:focus {
      border-color: var(--border-focus);
      outline: none;
    }

    .rules {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.35rem 0.9rem;
      margin: 0 0 0 auto;
      color: var(--text-secondary);
      font-size: 0.78rem;
    }

    .rule {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }

    /* The same two colours the arrows on the chart are drawn in, so the sentence and the
       marker it describes are read as one thing. */
    .dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      flex: none;
    }

    .dot.buy {
      background: var(--chart-trade-buy);
    }

    .dot.sell {
      background: var(--chart-trade-sell);
    }

    .caveat {
      color: var(--text-dim);
      font-size: 0.72rem;
    }

    .chart-area {
      grid-column: 1;
      grid-row: 2;
      min-width: 0;
      min-height: 0;
      padding-left: 1.25rem;
    }

    /* Numbers on the left, the trades that produced them on the right: the summary is what
       gets read first, and the list is what it has to be checked against. */
    .tester {
      grid-column: 1;
      grid-row: 3;
      display: grid;
      grid-template-columns: minmax(0, 22rem) minmax(0, 1fr);
      height: 13.5rem;
      border-top: 1px solid var(--border);
      background: var(--bg-panel);
    }

    .summary {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.6rem 0.9rem;
      border-right: 1px solid var(--border);
      overflow: hidden;
    }

    .summary-head {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .headline {
      display: grid;
      min-width: 0;
    }

    .headline-label {
      color: var(--text-label);
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .headline-value {
      font-size: 1.35rem;
      font-weight: 700;
      color: var(--text);
      font-variant-numeric: tabular-nums;
    }

    .headline-note {
      color: var(--text-dim);
      font-size: 0.72rem;
      font-variant-numeric: tabular-nums;
    }

    .equity {
      flex: 1;
      min-width: 0;
      height: 2.75rem;
    }

    .equity-base {
      stroke: var(--border-control);
      stroke-width: 1;
      stroke-dasharray: 3 3;
      vector-effect: non-scaling-stroke;
    }

    .equity-line {
      fill: none;
      stroke: var(--text-dim);
      stroke-width: 1.5;
      stroke-linejoin: round;
      /* The path is drawn in a box that gets stretched to the element, so without this the
         stroke comes out of it several times thicker across than it is tall. */
      vector-effect: non-scaling-stroke;
    }

    .equity-line.up {
      stroke: var(--chart-trade-buy);
    }

    .equity-line.down {
      stroke: var(--chart-trade-sell);
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.3rem 0.9rem;
      margin: 0;
      overflow-y: auto;
    }

    .stat {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5rem;
      font-size: 0.78rem;
    }

    .stat dt {
      color: var(--text-label);
      white-space: nowrap;
    }

    .stat dd {
      margin: 0;
      color: var(--text);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .stat-note {
      color: var(--text-dim);
      font-size: 0.7rem;
    }

    .trades {
      overflow: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.78rem;
    }

    thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 0.35rem 0.6rem;
      background: var(--bg-panel);
      border-bottom: 1px solid var(--border);
      color: var(--text-label);
      font-weight: 500;
      text-align: left;
      white-space: nowrap;
    }

    tbody td {
      padding: 0.25rem 0.6rem;
      border-bottom: 1px solid var(--border);
      color: var(--text-secondary);
      white-space: nowrap;
    }

    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    /* The open trade is the one that has not happened yet in full: it is shown, and marked. */
    tbody tr.running td {
      color: var(--text-dim);
      font-style: italic;
    }

    .empty {
      padding: 1.2rem 0.6rem;
      color: var(--text-dim);
      text-align: center;
      white-space: normal;
    }

    .up {
      color: var(--chart-up);
    }

    .down {
      color: var(--chart-down);
    }

    /* ---- Tablets: the same step the chart screen takes, so the two docks stay one width ---- */

    @media (max-width: 1099px) {
      :host {
        grid-template-columns: minmax(0, 1fr) 12rem;
      }
    }

    /* ---- Phones: the page scrolls, so the chart claims a height and everything stacks ---- */

    @media (max-width: 767px) {
      :host {
        grid-template-rows: auto auto auto;
        grid-template-columns: 1fr;
        overflow: visible;
      }

      /* Under the tester rather than over the chart: this screen has no sheet bar to bring a
         floating panel back, so the list stays in the flow and the page scrolls down to it. */
      .dock {
        grid-column: 1;
        grid-row: auto;
        max-height: 22rem;
      }

      .setup {
        padding: 0.5rem 0.6rem;
      }

      .rules {
        margin-left: 0;
      }

      .chart-area {
        height: 55dvh;
        min-height: 16rem;
        padding-left: 0.5rem;
      }

      .tester {
        grid-template-columns: 1fr;
        height: auto;
      }

      .summary {
        border-right: 0;
        border-bottom: 1px solid var(--border);
      }

      .trades {
        max-height: 18rem;
      }
    }
  `,
})
export class StrategiesPanelComponent {
  /** The candles the strategy is tested on. The screen above owns the ticker and the timeframe. */
  readonly series = input<CandleSeries | null>(null);
  readonly chartType = input<ChartType>('CANDLES');

  protected readonly strategies = STRATEGIES;
  protected readonly chartIndicators = STRATEGY_INDICATORS;
  protected readonly sparkWidth = SPARK_WIDTH;
  protected readonly sparkHeight = SPARK_HEIGHT;

  protected readonly percent = formatPercent;
  protected readonly price = formatPrice;

  protected readonly strategy = signal<Strategy>(storedStrategy());
  protected readonly params = signal<StrategyParams>(storedParams());

  /**
   * The whole screen, recomputed from the candles and the two periods. It is a few passes over
   * an array the browser already has, so there is nothing to debounce and nothing to ask the
   * backend: moving a period repaints on the same frame the number changes.
   */
  protected readonly backtest = computed(() =>
    runBacktest(this.strategy(), this.series()?.candles ?? [], this.params()),
  );
  protected readonly stats = computed(() => this.backtest().stats);
  protected readonly trades = computed(() => this.backtest().trades);
  /** Newest first: the last trade is the one being looked for, and the panel is four rows tall. */
  protected readonly recentFirst = computed(() => [...this.trades()].reverse());

  /** The two averages the strategy crosses, dropped into the chart's own EMA slots. */
  protected readonly chartPeriods = computed<IndicatorPeriods>(() => ({
    ...DEFAULT_PERIODS,
    emaFast: this.params().emaFast,
    emaSlow: this.params().emaSlow,
  }));

  /**
   * The equity curve as one path plus the line the capital started on, which is what turns a
   * wiggle into «ahead» or «behind». Scaled to its own extremes rather than to a fixed range:
   * the shape is the point, and a curve that never moved much would otherwise be a flat line.
   */
  protected readonly spark = computed(() => {
    const curve = this.backtest().equity;
    if (curve.length < 2) {
      return null;
    }

    const stride = Math.ceil(curve.length / SPARK_POINTS);
    const points = curve.filter((_, i) => i % stride === 0 || i === curve.length - 1);

    let min = Infinity;
    let max = -Infinity;
    for (const { value } of points) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const span = max - min || 1;
    const step = SPARK_WIDTH / (points.length - 1);
    const y = (value: number) => SPARK_HEIGHT - ((value - min) / span) * SPARK_HEIGHT;

    return {
      path: points
        .map((point, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${y(point.value).toFixed(1)}`)
        .join(' '),
      // Clamped: a run that never came back under its starting capital would draw the baseline
      // off the box, and a dashed line hanging outside the frame reads as a rendering bug.
      base: Math.min(SPARK_HEIGHT, Math.max(0, y(STARTING_CAPITAL))).toFixed(1),
    };
  });

  constructor() {
    effect(() => localStorage.setItem(STRATEGY_KEY, this.strategy().id));
    effect(() => {
      const moved = Object.entries(this.params()).filter(
        ([key, value]) => value !== DEFAULT_STRATEGY_PARAMS[key as keyof StrategyParams],
      );
      localStorage.setItem(PARAMS_KEY, JSON.stringify(Object.fromEntries(moved)));
    });
  }

  protected select(strategy: Strategy): void {
    this.strategy.set(strategy);
  }

  protected suffix(strategy: Strategy): string {
    return paramSuffix(strategy, this.params());
  }

  /**
   * Same clamp the indicator periods get, and for the same reason: a half-typed or out-of-range
   * number empties the averages, and with them the whole panel. Returns what was kept so the
   * box can show the clamped value — a plain `[value]` binding would not repaint when the
   * clamp lands back on the number that was already there.
   */
  protected setParam(param: StrategyParam, raw: string): string {
    const parsed = Number.parseInt(raw, 10);
    const value = Number.isNaN(parsed)
      ? param.defaultValue
      : Math.min(param.max, Math.max(param.min, parsed));
    this.params.update((params) => ({ ...params, [param.key]: value }));
    return `${value}`;
  }

  /**
   * «7/12 · 58 %» — how many of the crosses that closed ended up, and over how many. The share
   * on its own reads the same at 1 of 2 as at 60 of 120, and those are not the same evidence.
   */
  protected hits(): string {
    const { winners, closedTrades, winRate } = this.stats();
    return winRate === null ? '—' : `${winners}/${closedTrades} · ${this.ratio(winRate, '%')}`;
  }

  /** A count or a share, with its unit. Null is «nothing to measure», not zero. */
  protected ratio(value: number | null, unit: string): string {
    return value === null ? '—' : `${value.toFixed(value < 10 ? 1 : 0)}${unit}`;
  }

  /** Gross gains over gross losses. A run that never lost divides by nothing. */
  protected factor(value: number | null): string {
    if (value === null) {
      return '—';
    }
    return Number.isFinite(value) ? value.toFixed(2) : '∞';
  }

  protected date(time: number): string {
    return DATE_FORMAT.format(new Date(time * 1000));
  }
}
