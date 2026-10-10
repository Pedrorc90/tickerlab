import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CandleSeries } from '../market/market.models';
import { formatPercent, formatPrice } from '../screener/screener.models';
import { Backtest, STARTING_CAPITAL } from './backtest';
import { BasketRun } from './basket';
import { BasketPanelComponent } from './basket-panel.component';

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

/**
 * What the ticked rules did over the candles on the chart, as the drawer under it: the numbers
 * on the left, the trades that produced them on the right. The run itself belongs to the
 * strategy panel — this only reads it, which is what lets the controls live in a rail and the
 * result under the chart without either one knowing where the other is docked.
 */
@Component({
  selector: 'app-strategy-results',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BasketPanelComponent],
  template: `
    <!-- One set of numbers at a time. With no rule ticked there is nothing to show and the
         drawer is not there at all: the chart keeps the whole column. -->
    @if (basket(); as run) {
      <app-basket-panel [run]="run" (closed)="basketClosed.emit()" />
    } @else if (hasRules()) {
      <section class="tester" aria-label="Resultado del backtest">
        <!-- The one line that stays when the body is folded away: the return is what the
             drawer is for, and the chart is what it is competing with for height. -->
        <button
          type="button"
          class="drawer-toggle"
          [attr.aria-expanded]="!collapsed()"
          (click)="collapsed.set(!collapsed())"
        >
          <span class="drawer-title">Backtest</span>
          <span
            class="drawer-return"
            [class.up]="stats().totalReturn > 0"
            [class.down]="stats().totalReturn < 0"
          >
            {{ percent(stats().totalReturn) }}
          </span>
          <span class="drawer-note">{{ stats().closedTrades }} operaciones</span>
          <span class="drawer-chevron" aria-hidden="true">{{ collapsed() ? '▴' : '▾' }}</span>
        </button>

        @if (!collapsed()) {
          <div class="body">
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
              <div class="stat">
                <dt>Aciertos</dt>
                <dd>{{ hits() }}</dd>
              </div>
              <div class="stat">
                <dt>Ganancia media</dt>
                <dd class="up">{{ percent(stats().averageWin) }}</dd>
              </div>
              <div class="stat">
                <dt>Pérdida media</dt>
                <dd class="down">{{ percent(stats().averageLoss) }}</dd>
              </div>
              <div class="stat">
                <dt>Factor</dt>
                <dd>{{ factor(stats().profitFactor) }}</dd>
              </div>
              <div class="stat">
                <dt>Caída máxima</dt>
                <dd class="down">{{ percent(stats().maxDrawdown) }}</dd>
              </div>
              <div class="stat">
                <dt>Exposición</dt>
                <dd>{{ ratio(stats().exposure, '%') }}</dd>
              </div>
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
                          ? 'Las reglas no llegan a cumplirse en este histórico.'
                          : 'Busca un ticker para probar la estrategia.'
                      }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          </div>
        }
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .tester {
      display: flex;
      flex-direction: column;
      border-top: 1px solid var(--border);
      background: var(--bg-panel);
    }

    .drawer-toggle {
      display: flex;
      align-items: baseline;
      gap: 0.6rem;
      padding: 0.3rem 0.9rem;
      border: 0;
      background: transparent;
      color: var(--text-label);
      font: inherit;
      font-size: 0.75rem;
      text-align: left;
      cursor: pointer;
    }

    .drawer-toggle:hover {
      color: var(--text);
    }

    .drawer-title {
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: 0.7rem;
    }

    .drawer-return {
      color: var(--text);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .drawer-note {
      color: var(--text-dim);
    }

    .drawer-chevron {
      margin-left: auto;
    }

    /* Numbers on the left, the trades that produced them on the right: the summary is what
       gets read first, and the list is what it has to be checked against. */
    .body {
      display: grid;
      grid-template-columns: minmax(0, 22rem) minmax(0, 1fr);
      height: 13.5rem;
      border-top: 1px solid var(--border);
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

    @media (max-width: 900px) {
      .body {
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
export class StrategyResultsComponent {
  readonly backtest = input.required<Backtest>();
  /** Whether any rule is ticked: without one the drawer says nothing instead of printing zeroes. */
  readonly hasRules = input(false);
  /** A run over a whole list, which takes the drawer from the single-ticker numbers. */
  readonly basket = input<BasketRun | null>(null);
  readonly series = input<CandleSeries | null>(null);

  readonly basketClosed = output<void>();

  protected readonly sparkWidth = SPARK_WIDTH;
  protected readonly sparkHeight = SPARK_HEIGHT;

  protected readonly percent = formatPercent;
  protected readonly price = formatPrice;

  /** Folded away on request. Not stored: a result you came to read opens open. */
  protected readonly collapsed = signal(false);

  protected readonly stats = computed(() => this.backtest().stats);
  protected readonly trades = computed(() => this.backtest().trades);
  /** Newest first: the last trade is the one being looked for, and the panel is four rows tall. */
  protected readonly recentFirst = computed(() => [...this.trades()].reverse());

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
