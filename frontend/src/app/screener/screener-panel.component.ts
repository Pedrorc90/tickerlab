import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, output, signal } from '@angular/core';
import {
  FILTER_GROUPS,
  FilterGroup,
  PAGE_SIZE,
  RANGE_SELECTS,
  ScreenerSymbol,
  SortField,
  filtersFrom,
} from './screener.models';
import { ScreenerService } from './screener.service';

/** Typing a ticker should not fire a request per keystroke. */
const TYPING_PAUSE_MS = 250;

/** How often the table asks again while a quote sweep is running. */
const POLL_MS = 3000;

/** Whether the filter panel was left open. UI state, so it stays in the browser. */
const PANEL_OPEN_KEY = 'tickerlab.screenerFiltersOpen';

/** Header cells, in the order they are drawn. Text sorts ascending, numbers descending. */
const COLUMNS: ReadonlyArray<{ field: SortField; label: string; numeric: boolean }> = [
  { field: 'symbol', label: 'Ticker', numeric: false },
  { field: 'name', label: 'Nombre', numeric: false },
  { field: 'exchange', label: 'Mercado', numeric: false },
  { field: 'price', label: 'Precio', numeric: true },
  { field: 'changePercent', label: 'Var. %', numeric: true },
  { field: 'volume', label: 'Volumen', numeric: true },
  { field: 'marketCap', label: 'Capitalización', numeric: true },
  { field: 'per', label: 'PER', numeric: true },
  { field: 'eps', label: 'BPA', numeric: true },
  { field: 'change52w', label: '52 sem.', numeric: true },
];

@Component({
  selector: 'app-screener-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="filters">
      <input
        type="search"
        class="filter-text"
        placeholder="Filtrar por ticker o nombre…"
        autocomplete="off"
        [value]="query()"
        (input)="onQuery($any($event.target).value)"
      />

      <select class="filter-range" [value]="exchange()" (change)="onExchange($any($event.target).value)">
        <option value="">Todos los mercados</option>
        @for (option of exchanges(); track option) {
          <option [value]="option">{{ option }}</option>
        }
      </select>

      <button type="button" class="panel-toggle" [class.on]="panelOpen()" (click)="togglePanel()">
        Filtros {{ panelOpen() ? '▴' : '▾' }}
        @if (activeCount()) {
          <span class="badge">{{ activeCount() }}</span>
        }
      </button>

      @if (filtered()) {
        <button type="button" class="clear" (click)="clearFilters()" title="Quitar todos los filtros">
          Limpiar
        </button>
      }

      <span class="count">
        @if (total() > 0) {
          {{ rangeFrom() }}–{{ rangeTo() }} de {{ total() }}
        } @else if (!loading()) {
          Sin resultados
        }
      </span>

      <button type="button" class="refresh" [disabled]="refreshing()" (click)="refreshQuotes()">
        {{ refreshing() ? 'Actualizando cotizaciones…' : 'Actualizar cotizaciones' }}
      </button>

      <button type="button" class="refresh" [disabled]="loadingUniverse()" (click)="refreshUniverse()">
        {{ loadingUniverse() ? 'Descargando…' : 'Actualizar universo' }}
      </button>
    </header>

    @if (panelOpen()) {
      <section class="filter-panel">
        @for (group of groups; track group) {
          <div class="filter-group">
            <span class="group-name">{{ group }}</span>
            @for (select of selectsOf(group); track select.id) {
              <select
                class="filter-range"
                [class.set]="picks()[select.id]"
                [value]="picks()[select.id] ?? 0"
                (change)="pick(select.id, +$any($event.target).value)"
              >
                @for (option of select.options; track option.label; let i = $index) {
                  <option [value]="i">{{ option.label }}</option>
                }
              </select>
            }
          </div>
        }
      </section>
    }

    @if (notice(); as message) {
      <p class="notice">{{ message }}</p>
    }
    @if (error(); as message) {
      <p class="notice error">{{ message }}</p>
    }

    <div class="table-wrap">
      <table class="symbols">
        <thead>
          <tr>
            @for (column of columns; track column.field) {
              <th
                class="col-{{ column.field }}"
                [class.numeric]="column.numeric"
                [class.sorted]="sort() === column.field"
                (click)="sortBy(column.field, column.numeric)"
              >
                {{ column.label }}
                @if (sort() === column.field) {
                  <span class="arrow">{{ descending() ? '▾' : '▴' }}</span>
                }
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row.symbol) {
            <tr class="row" (click)="selected.emit(row.symbol)" [title]="'Ver ' + row.symbol + ' en el gráfico'">
              <td class="col-symbol">{{ row.symbol }}</td>
              <td class="col-name">{{ row.name }}</td>
              <td class="col-exchange">{{ row.exchange }}</td>
              <td class="col-price numeric">{{ price(row.price) }}</td>
              <td
                class="col-changePercent numeric"
                [class.up]="(row.changePercent ?? 0) > 0"
                [class.down]="(row.changePercent ?? 0) < 0"
              >
                {{ percent(row.changePercent) }}
              </td>
              <td class="col-volume numeric">{{ compact(row.volume) }}</td>
              <td class="col-marketCap numeric">{{ compact(row.marketCap) }}</td>
              <td class="col-per numeric">{{ ratio(row.per) }}</td>
              <td class="col-eps numeric" [class.down]="(row.eps ?? 0) < 0">{{ ratio(row.eps) }}</td>
              <td
                class="col-change52w numeric"
                [class.up]="(row.change52w ?? 0) > 0"
                [class.down]="(row.change52w ?? 0) < 0"
              >
                {{ percent(row.change52w) }}
              </td>
            </tr>
          } @empty {
            <tr>
              <td class="empty" [attr.colspan]="columns.length">
                @if (loading()) {
                  Cargando…
                } @else if (filtered()) {
                  Nada coincide con el filtro. Las acciones aún sin cotizar no entran en los
                  filtros numéricos.
                } @else {
                  El universo está vacío. Pulsa «Actualizar universo» para traer las ~6.000 acciones
                  de Nasdaq Trader.
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <footer class="pager">
      <button type="button" [disabled]="page() === 0 || loading()" (click)="go(page() - 1)">‹ Anterior</button>
      <span class="page-label">Página {{ page() + 1 }} de {{ pageCount() }}</span>
      <button type="button" [disabled]="page() + 1 >= pageCount() || loading()" (click)="go(page() + 1)">
        Siguiente ›
      </button>
    </footer>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      flex: 1;
      background: var(--bg-app);
    }

    .filters {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding: 0.6rem 0.9rem;
      border-bottom: 1px solid var(--border);
      background: var(--bg-panel);
    }

    .filter-text {
      flex: 1;
      min-width: 0;
      max-width: 22rem;
      padding: 0.35rem 0.5rem;
      border: 1px solid var(--border-control);
      border-radius: 4px;
      background: var(--bg-app);
      color: var(--text);
      font: inherit;
      font-size: 0.82rem;
    }

    .filter-text:focus,
    .filter-range:focus {
      border-color: var(--accent);
      outline: none;
    }

    .filter-range {
      padding: 0.35rem 0.5rem;
      border: 1px solid var(--border-control);
      border-radius: 4px;
      background: var(--bg-control);
      color: var(--text-secondary);
      font: inherit;
      font-size: 0.78rem;
    }

    .panel-toggle {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.35rem 0.6rem;
      border: 1px solid var(--border-control);
      border-radius: 6px;
      background: var(--bg-control);
      color: var(--text-secondary);
      font: inherit;
      font-size: 0.78rem;
      cursor: pointer;
    }

    .panel-toggle:hover,
    .panel-toggle.on {
      border-color: var(--accent);
      color: var(--text-strong);
    }

    .badge {
      min-width: 1.1rem;
      padding: 0 0.25rem;
      border-radius: 999px;
      background: var(--accent);
      color: var(--on-accent);
      font-size: 0.68rem;
      text-align: center;
    }

    .filter-panel {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      padding: 0.6rem 0.9rem;
      border-bottom: 1px solid var(--border);
      background: var(--bg-raised);
    }

    .filter-group {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    /* Fixed width so the three group labels line their dropdowns up in a column. */
    .group-name {
      width: 6rem;
      color: var(--text-dim);
      font-size: 0.68rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    /* A dropdown that is doing something has to look different from one that is not. */
    .filter-range.set {
      border-color: var(--accent);
      color: var(--text-strong);
    }

    .clear {
      padding: 0.35rem 0.55rem;
      border: 0;
      background: transparent;
      color: var(--text-dim);
      font: inherit;
      font-size: 0.72rem;
      text-decoration: underline;
      cursor: pointer;
    }

    .clear:hover {
      color: var(--chart-down);
    }

    .count {
      margin-left: auto;
      color: var(--text-dim);
      font-size: 0.72rem;
      font-variant-numeric: tabular-nums;
    }

    .refresh {
      padding: 0.35rem 0.6rem;
      border: 1px dashed var(--border-control);
      border-radius: 6px;
      background: transparent;
      color: var(--accent);
      font: inherit;
      font-size: 0.75rem;
      cursor: pointer;
    }

    .refresh:hover:not(:disabled) {
      border-color: var(--accent);
      background: var(--accent-soft);
    }

    .refresh:disabled {
      color: var(--text-dim);
      cursor: default;
    }

    .notice {
      margin: 0;
      padding: 0.4rem 0.9rem;
      background: var(--accent-soft);
      color: var(--text-secondary);
      font-size: 0.74rem;
    }

    .notice.error {
      background: var(--danger-soft);
      color: var(--chart-down);
    }

    .table-wrap {
      flex: 1;
      min-height: 0;
      overflow: auto;
    }

    .symbols {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }

    /* The header stays put while the 50 rows scroll under it. */
    .symbols thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 0.4rem 0.9rem;
      border-bottom: 1px solid var(--border);
      background: var(--bg-panel);
      color: var(--text-dim);
      font-size: 0.68rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-align: left;
      text-transform: uppercase;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }

    .symbols thead th:hover {
      color: var(--text-secondary);
    }

    .symbols thead th.sorted {
      color: var(--accent);
    }

    .arrow {
      margin-left: 0.2rem;
    }

    .row {
      cursor: pointer;
    }

    .row:hover {
      background: var(--bg-raised);
    }

    .row td {
      padding: 0.35rem 0.9rem;
      border-bottom: 1px solid var(--border);
      color: var(--text-secondary);
    }

    /* Numbers line up on the right and share a width, so columns can be compared down. */
    .numeric {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .col-symbol {
      width: 7rem;
      color: var(--text);
      font-weight: 600;
    }

    .col-name {
      overflow: hidden;
      max-width: 0;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .col-exchange {
      width: 9rem;
    }

    .col-price,
    .col-volume {
      width: 7rem;
    }

    .col-changePercent {
      width: 6rem;
    }

    .col-marketCap {
      width: 8rem;
    }

    .col-per,
    .col-eps {
      width: 5rem;
    }

    .col-change52w {
      width: 6rem;
    }

    .row td.up {
      color: var(--chart-up);
    }

    .row td.down {
      color: var(--chart-down);
    }

    .empty {
      padding: 2rem 0.9rem;
      color: var(--text-dim);
      text-align: center;
    }

    .pager {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.8rem;
      padding: 0.5rem;
      border-top: 1px solid var(--border);
      background: var(--bg-panel);
    }

    .pager button {
      padding: 0.25rem 0.6rem;
      border: 1px solid var(--border-control);
      border-radius: 999px;
      background: var(--bg-control);
      color: var(--text-secondary);
      font: inherit;
      font-size: 0.75rem;
      cursor: pointer;
    }

    .pager button:hover:not(:disabled) {
      border-color: var(--border-focus);
      color: var(--text-strong);
    }

    .pager button:disabled {
      color: var(--text-dim);
      cursor: default;
      opacity: 0.5;
    }

    .page-label {
      color: var(--text-dim);
      font-size: 0.72rem;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class ScreenerPanelComponent implements OnDestroy {
  /** A clicked row sends the ticker back to the chart. */
  readonly selected = output<string>();

  protected readonly columns = COLUMNS;
  protected readonly groups = FILTER_GROUPS;

  protected readonly rows = signal<ScreenerSymbol[]>([]);
  protected readonly exchanges = signal<string[]>([]);
  protected readonly query = signal('');
  protected readonly exchange = signal('');
  /** Which option each dropdown sits on, by id. Absent or 0 means "no filter". */
  protected readonly picks = signal<Record<string, number>>({});
  protected readonly panelOpen = signal(localStorage.getItem(PANEL_OPEN_KEY) === 'true');
  protected readonly page = signal(0);
  protected readonly total = signal(0);
  protected readonly sort = signal<SortField>('symbol');
  protected readonly descending = signal(false);
  protected readonly loading = signal(false);
  /** A quote sweep is running on the backend, whoever started it. */
  protected readonly refreshing = signal(false);
  protected readonly loadingUniverse = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  /** What the backend is being asked for right now. */
  protected readonly filters = computed(() =>
    filtersFrom(this.query(), this.exchange(), this.picks()),
  );

  /** How many dropdowns are off their "no filter" entry. Shown on the Filtros button. */
  protected readonly activeCount = computed(
    () => Object.values(this.picks()).filter((index) => index > 0).length,
  );

  /** Whether anything is narrowing the table, which is what the Limpiar button needs. */
  protected readonly filtered = computed(
    () => Boolean(this.query() || this.exchange()) || this.activeCount() > 0,
  );

  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  protected readonly rangeFrom = computed(() => this.page() * PAGE_SIZE + 1);
  protected readonly rangeTo = computed(() => Math.min(this.total(), (this.page() + 1) * PAGE_SIZE));

  private readonly service = inject(ScreenerService);
  /** Discards responses that arrive after the filter already moved on. */
  private requestId = 0;
  private typingTimer?: ReturnType<typeof setTimeout>;
  private pollTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    void this.loadExchanges();
    void this.load();
  }

  ngOnDestroy(): void {
    clearTimeout(this.typingTimer);
    clearTimeout(this.pollTimer);
  }

  protected onQuery(value: string): void {
    this.query.set(value);
    clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => this.go(0), TYPING_PAUSE_MS);
  }

  protected onExchange(value: string): void {
    this.exchange.set(value);
    this.go(0);
  }

  protected selectsOf(group: FilterGroup) {
    return RANGE_SELECTS.filter((select) => select.group === group);
  }

  protected pick(id: string, index: number): void {
    this.picks.update((picks) => ({ ...picks, [id]: index }));
    this.go(0);
  }

  protected togglePanel(): void {
    this.panelOpen.update((open) => !open);
    localStorage.setItem(PANEL_OPEN_KEY, `${this.panelOpen()}`);
  }

  protected clearFilters(): void {
    this.query.set('');
    this.exchange.set('');
    this.picks.set({});
    this.go(0);
  }

  /**
   * Clicking the column already sorted flips it; a new one starts the way that column is
   * usually read — biggest first for numbers, A-Z for text.
   */
  protected sortBy(field: SortField, numeric: boolean): void {
    if (this.sort() === field) {
      this.descending.update((down) => !down);
    } else {
      this.sort.set(field);
      this.descending.set(numeric);
    }
    this.go(0);
  }

  protected go(page: number): void {
    this.page.set(Math.max(0, page));
    void this.load();
  }

  /** Asks for a sweep and lets the poll in `load` report when it lands. */
  protected async refreshQuotes(): Promise<void> {
    this.error.set(null);
    try {
      await this.service.refreshQuotes();
      this.refreshing.set(true);
      this.schedulePoll();
    } catch (failure) {
      this.error.set(this.messageOf(failure));
    }
  }

  /** The only slow call here: the files are downloaded and the table rewritten. */
  protected async refreshUniverse(): Promise<void> {
    this.loadingUniverse.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const result = await this.service.refresh();
      this.notice.set(
        `Universo actualizado: ${result.total} acciones (${result.added} nuevas, ` +
          `${result.updated} cambiadas, ${result.removed} retiradas).`,
      );
      await this.loadExchanges();
      this.go(0);
    } catch (failure) {
      this.error.set(this.messageOf(failure));
    } finally {
      this.loadingUniverse.set(false);
    }
  }

  protected price(value: number | null): string {
    return value === null ? '—' : value.toFixed(2);
  }

  protected percent(value: number | null): string {
    return value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
  }

  /** A ratio Yahoo leaves out is a company with no earnings to divide by. */
  protected ratio(value: number | null): string {
    return value === null ? '—' : value.toFixed(1);
  }

  protected compact(value: number | null): string {
    if (value === null) {
      return '—';
    }
    if (value >= 1_000_000_000_000) {
      return `${(value / 1_000_000_000_000).toFixed(2)} B`;
    }
    if (value >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(2)} MM`;
    }
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(2)} M`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(1)} K`;
    }
    return `${value}`;
  }

  private async load(): Promise<void> {
    const id = ++this.requestId;
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.service.search(
        this.filters(),
        this.page(),
        this.sort(),
        this.descending(),
      );
      if (id !== this.requestId) {
        return;
      }
      this.rows.set(result.items);
      this.total.set(result.total);
      this.onSweepState(result.refreshing);
    } catch (failure) {
      if (id === this.requestId) {
        this.rows.set([]);
        this.total.set(0);
        this.error.set(this.messageOf(failure));
      }
    } finally {
      if (id === this.requestId) {
        this.loading.set(false);
      }
    }
  }

  /** A sweep that just finished leaves fresh numbers on screen without anyone clicking. */
  private onSweepState(running: boolean): void {
    const wasRunning = this.refreshing();
    this.refreshing.set(running);
    if (running) {
      this.schedulePoll();
    } else if (wasRunning) {
      this.notice.set('Cotizaciones actualizadas.');
    }
  }

  private schedulePoll(): void {
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.load(), POLL_MS);
  }

  private async loadExchanges(): Promise<void> {
    try {
      this.exchanges.set(await this.service.exchanges());
    } catch {
      this.exchanges.set([]);
    }
  }

  private messageOf(failure: unknown): string {
    if (failure instanceof HttpErrorResponse) {
      const detail = (failure.error as { error?: string } | null)?.error;
      return detail ?? (failure.status === 0 ? 'Backend no disponible.' : 'No se pudo consultar.');
    }
    return 'No se pudo consultar.';
  }
}
