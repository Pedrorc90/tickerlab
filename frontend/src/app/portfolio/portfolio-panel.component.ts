import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { formatPercent, formatPrice } from '../screener/screener.models';
import {
  Order,
  OrderSide,
  Portfolio,
  Position,
  formatMoney,
  formatSignedMoney,
  formatUnits,
  formatWhen,
} from './portfolio.models';
import { PortfolioService } from './portfolio.service';

/** How many fills the book shows before it stops: the screen is a page, not an archive. */
const BOOK_LIMIT = 40;

@Component({
  selector: 'app-portfolio-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Pills, not a select: the same reason the watchlist panel uses them — a native box
         would not follow a freshly created portfolio, and each pill carries its own total. -->
    <header class="panel-head">
      @for (item of portfolios(); track item.id) {
        <button
          type="button"
          class="tab"
          [class.active]="item.id === active()?.id"
          [attr.aria-pressed]="item.id === active()?.id"
          (click)="select(item.id)"
        >
          {{ item.name }}
          <span class="tab-total" [class.up]="item.totalReturn > 0" [class.down]="item.totalReturn < 0">
            {{ percent(item.totalReturnPercent) }}
          </span>
        </button>
      }
      <button type="button" class="tab new" (click)="startCreate()">+ Nueva</button>

      @if (active(); as current) {
        <span class="head-actions">
          <button type="button" class="link" (click)="startRename()">Renombrar</button>
          <button type="button" class="link danger" (click)="removeActive()">Borrar</button>
        </span>
      }
    </header>

    @if (editing(); as mode) {
      <form class="editor" (submit)="submitEdit($event)">
        <input
          class="box"
          name="name"
          [value]="draftName()"
          (input)="draftName.set($any($event.target).value)"
          placeholder="Nombre de la cartera"
          maxlength="60"
          autofocus
        />
        @if (mode === 'create') {
          <label class="cash">
            Capital
            <!-- step="1" and not a round 1000: with min="1" the browser only accepts values on
                 the step from the minimum, so 1000 was a stepMismatch and the form refused to
                 submit without saying why. -->
            <input
              class="box narrow"
              type="number"
              min="1"
              step="1"
              [value]="draftCash()"
              (input)="draftCash.set(+$any($event.target).value)"
            />
          </label>
        }
        <button type="submit" class="go">Guardar</button>
        <button type="button" class="link" (click)="editing.set(null)">Cancelar</button>
      </form>
    }

    @if (error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }

    @if (active(); as current) {
      <!-- The totals first: the number you came to see, before anything you can press. -->
      <section class="summary" aria-label="Resumen de la cartera">
        <div class="tile wide">
          <span class="label">Total</span>
          <strong class="value">{{ money(current.totalValue) }}</strong>
          <span
            class="delta"
            [class.up]="current.totalReturn > 0"
            [class.down]="current.totalReturn < 0"
          >
            {{ signed(current.totalReturn) }} · {{ percent(current.totalReturnPercent) }}
          </span>
        </div>
        <div class="tile">
          <span class="label">Efectivo</span>
          <strong class="value">{{ money(current.cash) }}</strong>
        </div>
        <div class="tile">
          <span class="label">Invertido</span>
          <strong class="value">{{ money(current.holdingsValue) }}</strong>
        </div>
        <div class="tile">
          <span class="label">P&amp;L abierto</span>
          <strong class="value" [class.up]="current.openPnl > 0" [class.down]="current.openPnl < 0">
            {{ signed(current.openPnl) }}
          </strong>
        </div>
        <div class="tile">
          <span class="label">Realizado</span>
          <strong
            class="value"
            [class.up]="current.realizedPnl > 0"
            [class.down]="current.realizedPnl < 0"
          >
            {{ signed(current.realizedPnl) }}
          </strong>
        </div>
      </section>

      @if (!current.fullyPriced) {
        <p class="warn">
          Alguna posición se quedó sin cotizar en el último barrido: el total de arriba es un
          mínimo, no la valoración completa.
        </p>
      }

      <!-- No price field, on purpose: pides unidades y el servidor decide lo que cuestan. -->
      <form class="order" (submit)="$event.preventDefault()">
        <label class="field">
          Símbolo
          <input
            class="box"
            [value]="orderSymbol()"
            (input)="orderSymbol.set($any($event.target).value.toUpperCase())"
            maxlength="20"
          />
        </label>
        <label class="field">
          Unidades
          <input
            class="box narrow"
            type="number"
            min="1"
            step="1"
            [value]="orderUnits()"
            (input)="orderUnits.set(+$any($event.target).value)"
          />
        </label>
        <span class="estimate">{{ estimate() }}</span>
        <button type="button" class="go buy" [disabled]="busy()" (click)="send('BUY')">Comprar</button>
        <button type="button" class="go sell" [disabled]="busy()" (click)="send('SELL')">Vender</button>
      </form>

      <section class="holdings" aria-label="Posiciones">
        @if (current.positions.length === 0) {
          <p class="empty">Todo en efectivo. Compra algo arriba y aparecerá aquí.</p>
        } @else {
          <table class="grid">
            <thead>
              <tr>
                <th class="left">Símbolo</th>
                <th class="left">Nombre</th>
                <th>Uds</th>
                <th>Coste medio</th>
                <th>Último</th>
                <th>Valor</th>
                <th>P&amp;L</th>
                <th>%</th>
                <th>Peso</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (row of current.positions; track row.symbol) {
                <tr (click)="selected.emit(row.symbol)">
                  <td class="left ticker">{{ row.symbol }}</td>
                  <td class="left name">{{ row.name ?? '—' }}</td>
                  <td>{{ units(row.quantity) }}</td>
                  <td>{{ price(row.avgCost) }}</td>
                  <td>{{ price(row.price) }}</td>
                  <td>{{ money(row.marketValue) }}</td>
                  <td [class.up]="isUp(row)" [class.down]="isDown(row)">{{ signed(row.openPnl) }}</td>
                  <td [class.up]="isUp(row)" [class.down]="isDown(row)">
                    {{ percent(row.openPnlPercent) }}
                  </td>
                  <td>{{ percent(row.weight) }}</td>
                  <td>
                    <button type="button" class="link" (click)="prefill($event, row)">Vender</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      <section class="book" aria-label="Órdenes">
        <h2 class="section-title">Órdenes</h2>
        @if (orders().length === 0) {
          <p class="empty">Ninguna orden todavía.</p>
        } @else {
          <table class="grid">
            <thead>
              <tr>
                <th class="left">Cuándo</th>
                <th class="left">Símbolo</th>
                <th class="left">Lado</th>
                <th>Uds</th>
                <th>Precio</th>
                <th>Importe</th>
                <th>Realizado</th>
              </tr>
            </thead>
            <tbody>
              @for (order of visibleOrders(); track order.id) {
                <tr>
                  <td class="left when">{{ when(order.executedAt) }}</td>
                  <td class="left ticker">{{ order.symbol }}</td>
                  <td class="left">
                    <span class="side" [class.up]="order.side === 'BUY'" [class.down]="order.side === 'SELL'">
                      {{ order.side === 'BUY' ? 'Compra' : 'Venta' }}
                    </span>
                    @if (order.priceSource === 'CLOSE') {
                      <span class="source" title="Llenada al último cierre diario: el barrido no tenía precio.">
                        cierre
                      </span>
                    }
                  </td>
                  <td>{{ units(order.quantity) }}</td>
                  <td>{{ price(order.price) }}</td>
                  <td>{{ money(order.amount) }}</td>
                  <td [class.up]="(order.realizedPnl ?? 0) > 0" [class.down]="(order.realizedPnl ?? 0) < 0">
                    {{ signed(order.realizedPnl) }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      <!-- Says what it did not charge, same as the backtest: a portfolio that hides its costs
           is a number that cannot be compared with anything. -->
      <p class="disclaimer">
        Dinero ficticio. Sin comisiones ni deslizamiento, acciones enteras y solo largo. Las
        órdenes se llenan al último precio que conoce el servidor —el del barrido, hasta 15
        minutos por detrás, o el último cierre diario si el barrido no lo tenía— y ese precio se
        queda escrito en la orden.
      </p>
    } @else if (!loading()) {
      <p class="empty big">Todavía no hay ninguna cartera. Crea la primera con «+ Nueva».</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-height: 0;
      overflow: auto;
      padding: 0 0.75rem 1rem;
      gap: 0.75rem;
    }

    .panel-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.25rem;
      padding: 0.6rem 0 0.5rem;
      border-bottom: 1px solid var(--border);
    }

    .tab {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.25rem 0.6rem;
      border: 1px solid var(--border-control);
      border-radius: 999px;
      background: var(--bg-control);
      color: var(--text-secondary);
      font: inherit;
      font-size: 0.78rem;
      line-height: 1.5;
      cursor: pointer;
    }

    .tab:hover {
      border-color: var(--border-focus);
      color: var(--text-strong);
    }

    .tab.active {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--on-accent);
    }

    .tab-total {
      font-variant-numeric: tabular-nums;
      opacity: 0.75;
    }

    .tab.active .tab-total {
      color: inherit;
    }

    .tab.new {
      border-style: dashed;
    }

    .head-actions {
      display: inline-flex;
      gap: 0.6rem;
      margin-left: auto;
    }

    .link {
      border: 0;
      background: transparent;
      color: var(--text-dim);
      font: inherit;
      font-size: 0.7rem;
      text-decoration: underline;
      cursor: pointer;
    }

    .link:hover {
      color: var(--text-secondary);
    }

    .link.danger:hover {
      color: var(--chart-down);
    }

    .editor,
    .order {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 0.5rem;
      padding: 0.6rem;
      border: 1px solid var(--border);
      border-radius: 0.4rem;
      background: var(--bg-raised);
    }

    .field,
    .cash {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      color: var(--text-label);
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .box {
      min-width: 9rem;
      padding: 0.3rem 0.45rem;
      border: 1px solid var(--border-control);
      border-radius: 0.3rem;
      background: var(--bg-control);
      color: var(--text-input);
      font: inherit;
      font-size: 0.85rem;
    }

    .box.narrow {
      min-width: 6rem;
    }

    .box:focus {
      outline: none;
      border-color: var(--border-focus);
    }

    .go {
      padding: 0.35rem 0.9rem;
      border: 1px solid var(--accent);
      border-radius: 0.3rem;
      background: var(--accent);
      color: var(--on-accent);
      font: inherit;
      font-size: 0.8rem;
      cursor: pointer;
    }

    .go:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .go.buy {
      border-color: var(--chart-up);
      background: var(--chart-up);
      color: var(--bg-app);
    }

    .go.sell {
      border-color: var(--chart-down);
      background: var(--chart-down);
      color: var(--bg-app);
    }

    .estimate {
      margin-right: auto;
      color: var(--text-dim);
      font-size: 0.72rem;
      font-variant-numeric: tabular-nums;
    }

    .summary {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .tile {
      display: flex;
      flex: 1 1 8rem;
      flex-direction: column;
      gap: 0.15rem;
      padding: 0.55rem 0.7rem;
      border: 1px solid var(--border);
      border-radius: 0.4rem;
      background: var(--bg-panel);
    }

    .tile.wide {
      flex-basis: 14rem;
    }

    .label {
      color: var(--text-label);
      font-size: 0.66rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .value {
      color: var(--text-strong);
      font-size: 1.05rem;
      font-variant-numeric: tabular-nums;
    }

    .tile.wide .value {
      font-size: 1.35rem;
    }

    .delta {
      font-size: 0.75rem;
      font-variant-numeric: tabular-nums;
    }

    .up {
      color: var(--chart-up);
    }

    .down {
      color: var(--chart-down);
    }

    .section-title {
      margin: 0 0 0.35rem;
      color: var(--text-label);
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .grid {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.78rem;
      font-variant-numeric: tabular-nums;
    }

    .grid th {
      padding: 0.3rem 0.45rem;
      border-bottom: 1px solid var(--border);
      color: var(--text-label);
      font-size: 0.66rem;
      font-weight: 600;
      text-align: right;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }

    .grid td {
      padding: 0.3rem 0.45rem;
      border-bottom: 1px solid var(--border);
      color: var(--text);
      text-align: right;
      white-space: nowrap;
    }

    .grid .left {
      text-align: left;
    }

    .holdings tbody tr {
      cursor: pointer;
    }

    .holdings tbody tr:hover td {
      background: var(--bg-control-hover);
    }

    .ticker {
      color: var(--text-strong);
      font-weight: 600;
    }

    .name {
      max-width: 16rem;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .when {
      color: var(--text-secondary);
    }

    .side {
      font-weight: 600;
    }

    .source {
      margin-left: 0.3rem;
      padding: 0 0.25rem;
      border: 1px solid var(--border-control);
      border-radius: 0.2rem;
      color: var(--text-dim);
      font-size: 0.62rem;
    }

    .error,
    .warn {
      margin: 0;
      padding: 0.4rem 0.6rem;
      border-radius: 0.3rem;
      font-size: 0.78rem;
    }

    .error {
      background: var(--danger-soft);
      color: var(--chart-down);
    }

    .warn {
      background: var(--accent-soft);
      color: var(--text-secondary);
    }

    .empty {
      margin: 0;
      color: var(--text-dim);
      font-size: 0.8rem;
    }

    .empty.big {
      padding: 2rem 0;
      text-align: center;
    }

    .disclaimer {
      margin: 0;
      color: var(--text-dim);
      font-size: 0.7rem;
      line-height: 1.5;
    }

    @media (max-width: 720px) {
      .name,
      .grid th:nth-child(2) {
        display: none;
      }
    }
  `,
})
export class PortfolioPanelComponent {
  /** Ticker on the chart right now: what the order form opens on. */
  readonly currentSymbol = input.required<string>();
  readonly currentName = input<string | null>(null);
  /** Last close of the chart series, for the estimate only — the fill price is the server's. */
  readonly currentPrice = input<number | null>(null);
  readonly selected = output<string>();

  private readonly service = inject(PortfolioService);

  protected readonly portfolios = signal<Portfolio[]>([]);
  protected readonly orders = signal<Order[]>([]);
  /** Owned by the service: the chart screen draws the fills of whichever one is selected here. */
  protected readonly activeId = this.service.activeId;
  protected readonly editing = signal<'create' | 'rename' | null>(null);
  protected readonly draftName = signal('');
  protected readonly draftCash = signal(100000);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly loading = signal(true);

  /**
   * Follows the chart, but stays put once typed into: you look up a ticker on the chart and come
   * here to buy it, and having the box snap back on the next repaint would be a bought mistake.
   */
  protected readonly orderSymbol = linkedSignal(() => this.currentSymbol());
  protected readonly orderUnits = signal(10);

  /** Falls back to the first one so the screen is never left pointing at nothing. */
  protected readonly active = computed(() => {
    const all = this.portfolios();
    return all.find((item) => item.id === this.activeId()) ?? all[0] ?? null;
  });

  protected readonly visibleOrders = computed(() => this.orders().slice(0, BOOK_LIMIT));

  /**
   * What the order would cost at the price the chart is showing. Explicitly approximate: the
   * server fills from the sweep, which is a different number, and pretending otherwise here
   * would make the first fill look like a bug.
   */
  protected readonly estimate = computed(() => {
    const price = this.currentPrice();
    const units = this.orderUnits();
    if (price === null || units <= 0 || this.orderSymbol() !== this.currentSymbol()) {
      return '';
    }
    return '≈ ' + formatMoney(price * units);
  });

  protected readonly money = formatMoney;
  protected readonly signed = formatSignedMoney;
  protected readonly units = formatUnits;
  protected readonly when = formatWhen;
  protected readonly percent = formatPercent;
  protected readonly price = formatPrice;

  constructor() {
    // Writes back active(), not activeId(): a stored id whose portfolio is gone resolves to the
    // fallback here and gets overwritten instead of lingering.
    effect(() => {
      const id = this.active()?.id;
      if (id && id !== this.activeId()) {
        this.service.setActive(id);
      }
    });
    // The book belongs to whichever portfolio is showing, so it reloads with the selection.
    effect(() => {
      const id = this.active()?.id;
      if (id) {
        void this.loadOrders(id);
      } else {
        this.orders.set([]);
      }
    });
    void this.reload();
  }

  protected select(id: string): void {
    this.service.setActive(id);
    this.editing.set(null);
    this.error.set(null);
  }

  protected startCreate(): void {
    this.error.set(null);
    this.draftName.set('');
    this.draftCash.set(100000);
    this.editing.set('create');
  }

  protected startRename(): void {
    this.error.set(null);
    this.draftName.set(this.active()?.name ?? '');
    this.editing.set('rename');
  }

  protected async submitEdit(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.draftName().trim();
    if (!name) {
      return;
    }
    const mode = this.editing();
    const current = this.active();
    await this.run(async () => {
      const saved =
        mode === 'rename' && current
          ? await this.service.rename(current.id, name)
          : await this.service.create(name, this.draftCash());
      this.upsert(saved);
      this.service.setActive(saved.id);
      this.editing.set(null);
    });
  }

  protected async removeActive(): Promise<void> {
    const current = this.active();
    if (!current || !confirm('¿Borrar la cartera "' + current.name + '" y todas sus órdenes?')) {
      return;
    }
    await this.run(async () => {
      await this.service.remove(current.id);
      this.portfolios.update((all) => all.filter((item) => item.id !== current.id));
      this.service.setActive(null);
    });
  }

  /** Fills the form from a holding instead of adding a per-row endpoint nobody else would use. */
  protected prefill(event: Event, row: Position): void {
    event.stopPropagation();
    this.orderSymbol.set(row.symbol);
    this.orderUnits.set(row.quantity);
  }

  protected async send(side: OrderSide): Promise<void> {
    const current = this.active();
    const symbol = this.orderSymbol().trim().toUpperCase();
    const units = Math.trunc(this.orderUnits());
    if (!current || !symbol || units <= 0) {
      return;
    }
    this.busy.set(true);
    await this.run(async () => {
      const name = symbol === this.currentSymbol() ? this.currentName() : null;
      this.upsert(await this.service.execute(current.id, symbol, name, side, units));
      await this.loadOrders(current.id);
    });
    this.busy.set(false);
  }

  protected isUp(row: Position): boolean {
    return (row.openPnl ?? 0) > 0;
  }

  protected isDown(row: Position): boolean {
    return (row.openPnl ?? 0) < 0;
  }

  private async reload(): Promise<void> {
    await this.run(async () => this.portfolios.set(await this.service.list()));
    this.loading.set(false);
  }

  private async loadOrders(id: string): Promise<void> {
    await this.run(async () => this.orders.set(await this.service.orders(id)));
  }

  private upsert(saved: Portfolio): void {
    this.portfolios.update((all) => {
      const index = all.findIndex((item) => item.id === saved.id);
      if (index < 0) {
        return [...all, saved];
      }
      const next = [...all];
      next[index] = saved;
      return next;
    });
  }

  /** Every call goes through here so a failed request always surfaces on the screen. */
  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    try {
      await action();
    } catch (failure) {
      this.error.set(this.messageOf(failure));
    }
  }

  private messageOf(failure: unknown): string {
    if (failure instanceof HttpErrorResponse) {
      const detail = (failure.error as { error?: string } | null)?.error;
      return detail ?? (failure.status === 0 ? 'Backend no disponible.' : 'No se pudo guardar.');
    }
    return 'No se pudo guardar.';
  }
}
