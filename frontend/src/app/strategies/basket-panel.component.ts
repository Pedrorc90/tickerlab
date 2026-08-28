import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { formatPercent } from '../screener/screener.models';
import { BasketRow, BasketRun } from './basket';

/** Which column the table is ordered by. `edge` is what the run was run to find out. */
type SortKey = 'symbol' | 'totalReturn' | 'buyHoldReturn' | 'edge' | 'closedTrades' | 'exposure';

const COLUMNS: ReadonlyArray<{ key: SortKey; label: string; numeric: boolean }> = [
  { key: 'symbol', label: 'Símbolo', numeric: false },
  { key: 'totalReturn', label: 'Estrategia', numeric: true },
  { key: 'buyHoldReturn', label: 'Comprar y mantener', numeric: true },
  { key: 'edge', label: 'Diferencia', numeric: true },
  { key: 'closedTrades', label: 'Ops', numeric: true },
  { key: 'exposure', label: 'Exposición', numeric: true },
];

/**
 * The basket's answer, in the place the single-ticker one was: one set of numbers on screen at
 * a time. «AAPL hizo 34 %» next to «la mediana es 6 %» is two scales of the same word, and the
 * eye takes whichever is larger — so while a basket is open, the detail is gone rather than
 * shrunk into a corner of it.
 */
@Component({
  selector: 'app-basket-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="basket" aria-label="Resultado de la cesta">
      <div class="summary">
        <header class="summary-head">
          <div class="headline">
            <span class="headline-label">Mediana · {{ run().list }}</span>
            @if (run().stats; as stats) {
              <span
                class="headline-value"
                [class.up]="stats.medianReturn > 0"
                [class.down]="stats.medianReturn < 0"
              >
                {{ percent(stats.medianReturn) }}
              </span>
              <span class="headline-note">
                comprar y mantener {{ percent(stats.medianBuyHold) }}
              </span>
            } @else {
              <span class="headline-value">—</span>
            }
          </div>
          <button type="button" class="back" (click)="closed.emit()">Volver al detalle</button>
        </header>

        @if (run().stats; as stats) {
          <dl class="stats">
            <div class="stat">
              <dt>Baten a comprar y mantener</dt>
              <dd [class.up]="stats.beat * 2 > stats.tested">
                {{ stats.beat }}/{{ stats.tested }}
              </dd>
            </div>
            <div class="stat">
              <dt>Exposición mediana</dt>
              <dd>{{ stats.medianExposure.toFixed(0) }}%</dd>
            </div>
            <div class="stat">
              <dt>Mejor</dt>
              <dd class="up">{{ stats.best.symbol }} {{ percent(stats.best.totalReturn) }}</dd>
            </div>
            <div class="stat">
              <dt>Peor</dt>
              <dd class="down">{{ stats.worst.symbol }} {{ percent(stats.worst.totalReturn) }}</dd>
            </div>
            <div class="stat">
              <dt>Sin operar</dt>
              <dd>{{ stats.idle }}</dd>
            </div>
          </dl>
        }

        <!-- What the run did not cover, spelled out: a basket that quietly tested thirty of the
             fifty asked for is a median of something nobody chose. -->
        @if (note(); as text) {
          <p class="note">{{ text }}</p>
        }
      </div>

      <div class="rows">
        <table>
          <thead>
            <tr>
              @for (column of columns; track column.key) {
                <th [class.num]="column.numeric" [attr.aria-sort]="ariaSort(column.key)">
                  <button type="button" (click)="sortBy(column.key)">
                    {{ column.label }}
                    @if (sort().key === column.key) {
                      <span class="arrow">{{ sort().descending ? '↓' : '↑' }}</span>
                    }
                  </button>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of sorted(); track row.symbol) {
              <tr>
                <td class="symbol" [title]="row.name ?? row.symbol">{{ row.symbol }}</td>
                <td class="num" [class.up]="row.totalReturn > 0" [class.down]="row.totalReturn < 0">
                  {{ percent(row.totalReturn) }}
                </td>
                <td class="num">{{ percent(row.buyHoldReturn) }}</td>
                <td class="num" [class.up]="row.edge > 0" [class.down]="row.edge < 0">
                  {{ percent(row.edge) }}
                </td>
                <td class="num">
                  {{ row.closedTrades }}
                  @if (row.openTrade) {
                    <span class="open">+1</span>
                  }
                </td>
                <td class="num">{{ row.exposure.toFixed(0) }}%</td>
              </tr>
            } @empty {
              <tr>
                <td class="empty" colspan="6">
                  Ningún símbolo de la lista tenía histórico suficiente para estas reglas.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: `
    /* The section has to be a child of the screen's grid to sit where the tester sat, and a
       host box in between would be the thing the grid placed instead. */
    :host {
      display: contents;
    }

    .basket {
      grid-column: 2;
      grid-row: 2;
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
      min-width: 0;
    }

    .summary-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.5rem;
    }

    .headline {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .headline-label {
      color: var(--text-label);
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .headline-value {
      font-size: 1.6rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--text);
    }

    .headline-note {
      color: var(--text-dim);
      font-size: 0.72rem;
    }

    .back {
      flex: none;
      padding: 0.25rem 0.5rem;
      border: 1px solid var(--border-control);
      border-radius: 4px;
      background: var(--bg-raised);
      color: var(--text-secondary);
      font: inherit;
      font-size: 0.75rem;
      cursor: pointer;
    }

    .back:hover {
      color: var(--text);
    }

    .stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.25rem 0.75rem;
      margin: 0;
    }

    .stat {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.4rem;
      min-width: 0;
    }

    .stat dt {
      color: var(--text-label);
      font-size: 0.72rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .stat dd {
      margin: 0;
      font-size: 0.78rem;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .note {
      margin: auto 0 0;
      color: var(--text-dim);
      font-size: 0.72rem;
    }

    .rows {
      overflow: auto;
      min-width: 0;
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
      padding: 0;
      background: var(--bg-panel);
      border-bottom: 1px solid var(--border);
      text-align: left;
      font-weight: 500;
    }

    thead th button {
      width: 100%;
      padding: 0.35rem 0.6rem;
      border: 0;
      background: transparent;
      color: var(--text-label);
      font: inherit;
      font-size: 0.72rem;
      text-align: inherit;
      cursor: pointer;
    }

    thead th.num button {
      text-align: right;
    }

    thead th button:hover {
      color: var(--text);
    }

    .arrow {
      margin-left: 0.2rem;
    }

    tbody td {
      padding: 0.25rem 0.6rem;
      border-bottom: 1px solid var(--border);
      color: var(--text-secondary);
      white-space: nowrap;
    }

    tbody tr:hover td {
      background: var(--bg-raised);
    }

    .symbol {
      color: var(--text);
      font-weight: 500;
    }

    .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .open {
      margin-left: 0.25rem;
      color: var(--text-dim);
      font-size: 0.7rem;
    }

    .empty {
      padding: 1rem 0.6rem;
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

    /* The host is display: contents, so this sits in the tester's slot of the strategies
       grid and has to unstack on the same breakpoint that grid does — not on the 900px one
       below, which is about these two columns and not about where the panel lands. */
    @media (max-width: 767px) {
      .basket {
        grid-column: 1;
        grid-row: auto;
      }
    }

    @media (max-width: 900px) {
      .basket {
        grid-template-columns: 1fr;
        height: auto;
      }

      .summary {
        border-right: 0;
        border-bottom: 1px solid var(--border);
      }

      .rows {
        max-height: 18rem;
      }
    }
  `,
})
export class BasketPanelComponent {
  readonly run = input.required<BasketRun>();
  readonly closed = output<void>();

  protected readonly columns = COLUMNS;
  protected readonly percent = formatPercent;

  /** Opens on the column the basket was run to read, biggest edge first. */
  protected readonly sort = signal<{ key: SortKey; descending: boolean }>({
    key: 'edge',
    descending: true,
  });

  protected readonly sorted = computed(() => {
    const { key, descending } = this.sort();
    const direction = descending ? -1 : 1;
    return [...this.run().rows].sort((a, b) => direction * compare(a, b, key));
  });

  /** The symbols the run left out, if any: no history, or past the basket's ceiling. */
  protected readonly note = computed(() => {
    const { skipped, dropped } = this.run();
    const parts: string[] = [];
    if (skipped.length) {
      parts.push(`${skipped.length} sin histórico suficiente (${skipped.slice(0, 6).join(', ')}${skipped.length > 6 ? '…' : ''})`);
    }
    if (dropped.length) {
      parts.push(`${dropped.length} fuera del tope de la cesta`);
    }
    return parts.length ? parts.join(' · ') : null;
  });

  protected sortBy(key: SortKey): void {
    this.sort.update((current) =>
      current.key === key
        ? { key, descending: !current.descending }
        : // A new column opens the way that column is read: biggest first for a number, A-Z
          // for a name. Keeping the previous direction would sort the worst runs to the top.
          { key, descending: key !== 'symbol' },
    );
  }

  protected ariaSort(key: SortKey): 'ascending' | 'descending' | null {
    const { key: current, descending } = this.sort();
    return current === key ? (descending ? 'descending' : 'ascending') : null;
  }
}

function compare(a: BasketRow, b: BasketRow, key: SortKey): number {
  return key === 'symbol' ? a.symbol.localeCompare(b.symbol) : a[key] - b[key];
}
