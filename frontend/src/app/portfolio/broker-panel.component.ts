import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import {
  Broker,
  BrokerAccount,
  Flow,
  Holding,
  ImportResult,
  KIND_LABEL,
  Transaction,
  TransactionKind,
  formatDay,
  formatMoney,
  formatPrice,
  formatSignedMoney,
  formatPercent,
  formatRound,
  formatUnits,
  shortName,
} from './broker.models';
import { BrokerService } from './broker.service';

/** How many statement lines the book shows: the screen is a page, not an archive. */
const BOOK_LIMIT = 60;

/** How many positions each side of the closed summary lists. */
const RANK_SIZE = 6;

interface BookFilter {
  id: 'ALL' | 'TRADES' | 'DIVIDENDS' | 'FEES' | 'CASH';
  label: string;
  kinds: readonly TransactionKind[] | null;
}

const BOOK_FILTERS: readonly BookFilter[] = [
  { id: 'ALL', label: 'Todos', kinds: null },
  { id: 'TRADES', label: 'Compras y ventas', kinds: ['BUY', 'SELL', 'CORPORATE_ACTION'] },
  { id: 'DIVIDENDS', label: 'Dividendos', kinds: ['DIVIDEND', 'WITHHOLDING'] },
  { id: 'FEES', label: 'Comisiones', kinds: ['FEE'] },
  { id: 'CASH', label: 'Ingresos y retiradas', kinds: ['DEPOSIT', 'WITHDRAWAL'] },
];

/** Kinds that can be pure cash bookkeeping: no instrument, so a mirror line cancels them. */
const OFFSETTABLE = new Set<TransactionKind>(['DEPOSIT', 'WITHDRAWAL', 'INTEREST', 'OTHER']);

/** A statement older than this is worth a nudge: the open result is only as fresh as it. */
const STALE_AFTER_DAYS = 7;

/** Darkest first, so the biggest slice leads the bar. Cash is the one neutral. */
const SLICE_COLORS = ['#5c2a0e', '#9a4a1f', '#c4875a', '#d9a679', '#e4bf9c', '#eed5bc', '#f3e3d2'];
const CASH_COLOR = '#a39a8c';

@Component({
  selector: 'app-broker-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Pills, same as the paper portfolios: a native select would not follow a freshly created
         account, and each pill carries the one thing that tells them apart, the broker. -->
    <header class="panel-head">
      @for (item of accounts(); track item.id) {
        <button
          type="button"
          class="tab"
          [class.active]="item.id === active()?.id"
          [attr.aria-pressed]="item.id === active()?.id"
          (click)="select(item.id)"
        >
          {{ item.name }}
          <span class="tab-broker">{{ item.broker }}</span>
        </button>
      }
      <button type="button" class="tab new" (click)="startCreate()">+ Nueva cuenta</button>

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
          placeholder="Nombre de la cuenta"
          maxlength="60"
          autofocus
        />
        @if (mode === 'create') {
          <!-- Fixed at creation and not editable afterwards: the broker decides how every row
               already stored was read, so changing it would leave them parsed by a reader that
               no longer applies. -->
          <label class="field">
            Broker
            <select
              class="box narrow"
              [value]="draftBroker()"
              (change)="draftBroker.set($any($event.target).value)"
            >
              <option value="DEGIRO">DeGiro</option>
              <option value="IBKR">IBKR</option>
            </select>
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
      <!-- The upload first: an account with nothing imported has nothing else to show, and this
           is the only way anything ever gets into it. -->
      <section class="import" aria-label="Importar extracto">
        <label class="pick">
          <input type="file" accept=".csv,text/csv" (change)="onFile($event)" [disabled]="busy()" />
        </label>
        <button type="button" class="go" [disabled]="!picked() || busy()" (click)="runImport()">
          {{ busy() ? 'Importando…' : 'Importar' }}
        </button>
        @if (picked(); as file) {
          <span class="picked">{{ file.name }}</span>
        }
        <!-- The cash book is named first on purpose. It is the one that carries the dividends,
             the commissions and the deposits, and the one whose balance can be checked against
             DeGiro's own. The trades export is easier to find and does less. -->
        <span class="hint">
          <strong>Account.csv</strong> (Actividad → Estado de cuenta): el completo — operaciones,
          dividendos, comisiones e ingresos. <strong>Transactions.csv</strong> (Transacciones):
          solo las operaciones. Una cuenta usa uno u otro, no los dos: cuentan el mismo dinero de
          formas distintas. Reimportar un periodo que ya está no duplica nada.
        </span>
      </section>

      @if (lastImport(); as result) {
        <p class="result" role="status">
          {{ result.imported }} movimientos nuevos ·
          {{ result.skipped }} que ya estaban ·
          {{ day(result.from) }} → {{ day(result.to) }}
        </p>
      }

      @if (current.incompleteHistory) {
        <!-- Not a detail hidden in a column: it makes every total on the screen an
             understatement, and a total that is quietly wrong is worse than a missing one. -->
        <p class="warn" role="alert">
          El historial no llega atrás del todo: hay ventas de acciones que ninguna importación
          compró. Las líneas marcadas tienen el coste incompleto y la plusvalía inflada. Exporta
          desde DeGiro con el rango abierto desde que abriste la cuenta.
        </p>
      }

      @if (current.transactions > 0) {
        @if (staleDays(); as days) {
          <p class="notice" role="status">
            <strong>El último movimiento importado es del {{ day(current.lastMovement) }}</strong>
            (hace {{ days }} días). Importa tu extracto reciente para que el latente y los
            dividendos estén al día; reimportar no duplica nada.
          </p>
        }

        <section class="summary" aria-label="Resumen de la cuenta">
          @if (hero(); as h) {
            <div class="hero">
              <span class="hero-label">Patrimonio en {{ current.broker }}</span>
              <strong class="hero-value">{{ money(h.wealth, h.currency) }}</strong>
              <span class="hero-sub">
                Posiciones {{ money(h.positions, h.currency) }} + efectivo
                {{ money(h.cash, h.currency) }}{{ h.otherCash }}
              </span>
              @if (h.gain !== null) {
                <div class="hero-gain">
                  <span class="hero-label">Ganancia total</span>
                  <strong [class.up]="h.gain > 0" [class.down]="h.gain < 0">
                    {{ signed(h.gain, h.currency) }}
                  </strong>
                  <span [class.up]="h.gain > 0" [class.down]="h.gain < 0">
                    {{ percent(h.gainPercent) }}
                  </span>
                </div>
                <span class="hero-sub">
                  Sobre {{ money(h.net, h.currency) }} aportados netos
                  ({{ money(h.deposits, h.currency) }} ingresados −
                  {{ money(h.withdrawals, h.currency) }} retirados)
                </span>
              }
            </div>
          }
          @if (!hero()) {
            @for (balance of current.balances; track balance.currency) {
              <div class="tile">
                <span class="label">Efectivo {{ balance.currency }}</span>
                <strong class="value">{{ money(balance.amount, balance.currency) }}</strong>
              </div>
            }
          }
          @for (total of invested(); track total.currency) {
            <div class="tile">
              <span class="label">Invertido {{ total.currency }}</span>
              <strong class="value">{{ money(total.amount, total.currency) }}</strong>
            </div>
          }
          @if (!hero()) {
            @for (total of marketValue(); track total.currency) {
              <div class="tile">
                <span class="label">Valor mercado {{ total.currency }}</span>
                <strong class="value">{{ money(total.amount, total.currency) }}</strong>
              </div>
            }
          }
          @for (total of unrealized(); track total.currency) {
            <div class="tile">
              <span class="label">Latente {{ total.currency }}</span>
              <strong
                class="value"
                [class.up]="total.amount > 0"
                [class.down]="total.amount < 0"
              >{{ signed(total.amount, total.currency) }}</strong>
            </div>
          }
          @for (total of realized(); track total.currency) {
            <div class="tile">
              <span class="label">Realizado {{ total.currency }}</span>
              <strong
                class="value"
                [class.up]="total.amount > 0"
                [class.down]="total.amount < 0"
              >{{ signed(total.amount, total.currency) }}</strong>
            </div>
          }
          <div class="tile">
            <span class="label">Movimientos</span>
            <strong class="value">{{ current.transactions }}</strong>
            <span class="delta">{{ day(current.firstMovement) }} → {{ day(current.lastMovement) }}</span>
          </div>
        </section>

        @if (hero(); as h) {
          @if (h.slices.length) {
            <section class="alloc" aria-label="Distribución del patrimonio">
              <div class="alloc-head">
                <h3 class="alloc-title">Distribución del patrimonio</h3>
                @if (h.concentration; as note) {
                  <span class="alloc-note">{{ note }}</span>
                }
              </div>
              <div class="alloc-bar">
                @for (slice of h.slices; track slice.name) {
                  <span
                    class="alloc-seg"
                    [style.flex-grow]="slice.value"
                    [style.background]="slice.color"
                    [title]="slice.name + ' ' + slice.label"
                  ></span>
                }
              </div>
              <ul class="alloc-legend">
                @for (slice of h.slices; track slice.name) {
                  <li>
                    <span class="dot" [style.background]="slice.color"></span>
                    <strong>{{ slice.name }}</strong>
                    {{ slice.label }}
                    <span class="muted">{{ money(slice.value, h.currency) }}</span>
                  </li>
                }
              </ul>
            </section>
          }
        }

        @if (current.flows.length) {
          <!-- What the trades export could not tell you at all. Split by currency because it
               really is: the dividend arrives in dollars, the custody fee is charged in euros. -->
          <section aria-label="Rendimientos y costes">
            <h3 class="section-title">Rendimientos y costes</h3>
            <table class="grid">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th class="num">Total</th>
                </tr>
              </thead>
              <tbody>
                @for (flow of current.flows; track flow.kind + flow.currency) {
                  <tr>
                    <td>{{ label(flow.kind) }}</td>
                    <td
                      class="num"
                      [class.up]="flow.amount > 0"
                      [class.down]="flow.amount < 0"
                    >{{ signed(flow.amount, flow.currency) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
        }

        @if (open().length) {
          <section aria-label="Posiciones abiertas">
            <h3 class="section-title">En cartera</h3>
            <table class="grid">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Ticker</th>
                  <th class="num">Uds</th>
                  <th class="num">Precio medio</th>
                  <th class="num">Último</th>
                  <th class="num">Coste</th>
                  <th class="num">Valor</th>
                  <th class="num">Latente</th>
                  <th>Desde</th>
                </tr>
              </thead>
              <tbody>
                @for (holding of open(); track holding.isin) {
                  <tr [class.flagged]="!holding.complete">
                    <td>
                      {{ holding.product ?? holding.isin }}
                      @if (!holding.complete) {
                        <span class="flag" title="Faltan compras anteriores">incompleto</span>
                      }
                      <span class="isin">{{ holding.isin }}</span>
                    </td>
                    <!-- Its own column, and a field that looks like one. The ticker is asked for
                         and never guessed -- one ISIN trades on several venues under several
                         tickers, and a valuation built on the wrong one is worse than the dash it
                         replaced -- so this is the one cell on the screen waiting on the user, and
                         it has to look it. Emptied, the line goes back to dashes. -->
                    <td>
                      <input
                        class="ticker"
                        [class.unset]="!holding.symbol"
                        [value]="holding.symbol ?? ''"
                        [attr.aria-label]="'Ticker de ' + (holding.product ?? holding.isin)"
                        placeholder="+ ticker"
                        spellcheck="false"
                        (keydown.enter)="$any($event.target).blur()"
                        (blur)="setSymbol(holding, $any($event.target).value)"
                      />
                    </td>
                    <td class="num">{{ units(holding.quantity) }}</td>
                    <td class="num">{{ price(holding.avgCost, holding.priceCurrency) }}</td>
                    <td class="num">{{ price(holding.lastPrice, holding.priceCurrency) }}</td>
                    <td class="num">{{ money(holding.cost, holding.currency) }}</td>
                    <td class="num">{{ money(holding.marketValue, holding.baseCurrency) }}</td>
                    <td
                      class="num"
                      [class.up]="(holding.unrealizedPnl ?? 0) > 0"
                      [class.down]="(holding.unrealizedPnl ?? 0) < 0"
                    >
                      @if (holding.unrealizedPnl === null) {
                        —
                      } @else {
                        {{ signed(holding.unrealizedPnl, holding.baseCurrency) }}
                        <span class="pct">{{ percent(holding.unrealizedPercent) }}</span>
                      }
                    </td>
                    <td>{{ day(holding.openedAt) }}</td>
                  </tr>
                }
              </tbody>
            </table>
            <!-- Said out loud rather than left to be noticed: the totals above add only what
                 could be priced, so a position missing from them makes every one of them low. -->
            @if (unmapped().length) {
              <p class="hint">
                Sin ticker: {{ unmapped().join(', ') }}. Escríbelo bajo el ISIN para valorarlas.
              </p>
            }
            @if (unquoted().length) {
              <p class="hint">
                Sin cotización: {{ unquoted().join(', ') }}. Revisa el ticker — una acción europea
                lleva sufijo de mercado (ITX.MC, ASML.AS).
              </p>
            }
          </section>
        }

        @if (closed().length) {
          <!-- A wall of tiles rather than a table. A closed position has one number worth reading
               and the list runs to dozens: as rows it is a column of dates nobody scans, and as a
               wall the shape of the year shows up at a glance — how much green, how much red, and
               which single tile is carrying the result. Sorted by size, best first. -->
          <section aria-label="Posiciones cerradas">
            <div class="section-head">
              <h3 class="section-title">
                Cerradas
                <span class="muted">· {{ closed().length }}</span>
              </h3>
              @if (closedStats(); as stats) {
                <span class="muted">
                  {{ stats.wins }} con ganancia · {{ stats.losses }} con pérdida · acierto
                  {{ stats.rate }} %
                </span>
              }
              <div class="seg" role="group" aria-label="Vista de cerradas">
                <button
                  type="button"
                  [class.on]="closedView() === 'summary'"
                  (click)="closedView.set('summary')"
                >Resumen</button>
                <button
                  type="button"
                  [class.on]="closedView() === 'all'"
                  (click)="closedView.set('all')"
                >Todas</button>
              </div>
            </div>

            @if (closedView() === 'summary' && closedStats(); as stats) {
              <div class="duo">
                @for (group of stats.groups; track group.title) {
                  <div class="rank">
                    <h4 class="rank-title" [class.up]="group.win" [class.down]="!group.win">
                      {{ group.title }}
                    </h4>
                    @for (item of group.items; track item.holding.isin) {
                      <div class="rank-row" [attr.title]="item.holding.product ?? item.holding.isin">
                        <span class="rank-name">
                          {{ short(item.holding.product, item.holding.isin) }}
                          <small>
                            {{ round(item.holding.invested, item.holding.currency) }} →
                            {{ round(item.holding.proceeds, item.holding.currency) }}
                          </small>
                        </span>
                        <span class="rank-track">
                          <span
                            class="rank-fill"
                            [class.win]="group.win"
                            [class.loss]="!group.win"
                            [style.width.%]="item.width"
                          ></span>
                        </span>
                        <span class="rank-value" [class.up]="group.win" [class.down]="!group.win">
                          {{ signed(item.holding.realizedPnl, item.holding.currency) }}
                          <small>{{ percent(item.holding.realizedPercent) }}</small>
                        </span>
                      </div>
                    }
                  </div>
                }
              </div>
              <button type="button" class="link" (click)="closedView.set('all')">
                Ver las {{ closed().length }} operaciones
              </button>
            } @else {
            <ul class="wall">
              @for (holding of closed(); track holding.isin) {
                <li
                  class="cell"
                  [class.win]="holding.realizedPnl > 0"
                  [class.loss]="holding.realizedPnl < 0"
                  [class.flagged]="!holding.complete"
                  [attr.title]="(holding.product ?? holding.isin) + ' · ' + holding.isin"
                >
                  <span class="cell-name">{{ short(holding.product, holding.isin) }}</span>
                  <!-- The percentage beside the money, not instead of it: +128 $ says how much
                       this one moved the account, +53 % says how good the decision was, and
                       neither answers the other. -->
                  <span class="cell-result">
                    <strong class="cell-pnl">
                      {{ signed(holding.realizedPnl, holding.currency) }}
                    </strong>
                    <span class="cell-pct">{{ percent(holding.realizedPercent) }}</span>
                  </span>
                  <span class="cell-flow">
                    {{ round(holding.invested, holding.currency) }}
                    <span class="arrow">→</span>
                    {{ round(holding.proceeds, holding.currency) }}
                  </span>
                  @if (!holding.complete) {
                    <span class="cell-flag" title="Faltan compras anteriores">?</span>
                  }
                </li>
              }
            </ul>
            }
          </section>
        }

        <section aria-label="Movimientos">
          <div class="section-head">
            <h3 class="section-title">
              Movimientos
              <span class="muted">· {{ current.transactions }}</span>
            </h3>
            <span class="muted">
              {{ day(current.firstMovement) }} – {{ day(current.lastMovement) }}
              @if (filteredBook().length > limit) {
                · los {{ limit }} últimos
              }
            </span>
          </div>
          <div class="chips">
            @for (option of bookFilters; track option.id) {
              <button
                type="button"
                class="chip"
                [class.on]="bookFilter() === option.id"
                (click)="bookFilter.set(option.id)"
              >{{ option.label }}</button>
            }
            <label class="group-toggle">
              <input
                type="checkbox"
                [checked]="groupRelated()"
                (change)="groupRelated.set($any($event.target).checked)"
              />
              Agrupar apuntes relacionados
            </label>
          </div>
          <table class="grid">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Producto</th>
                <th class="num">Uds</th>
                <th class="num">Precio</th>
                <th class="num">Importe</th>
                <th class="num">Comisión</th>
              </tr>
            </thead>
            <tbody>
              @for (row of visibleBook(); track row.id) {
                <tr>
                  <td>{{ day(row.executedAt) }}</td>
                  <td>
                    <span
                      class="kind"
                      [class.swap]="row.kind === 'CORPORATE_ACTION'"
                      [class.income]="row.kind === 'DIVIDEND'"                    >
                      {{ label(row.kind) }}
                    </span>
                  </td>
                  <td>{{ row.product ?? '—' }}</td>
                  <td class="num">{{ units(row.quantity) }}</td>
                  <td class="num">{{ price(row.price, row.priceCurrency) }}</td>
                  <td
                    class="num"
                    [class.up]="row.amount > 0"
                    [class.down]="row.amount < 0"
                  >{{ signed(row.amount, row.currency) }}</td>
                  <td class="num">{{ row.fees ? money(row.fees, row.currency) : '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
          @if (hiddenCount() > 0) {
            <p class="foot">
              {{ hiddenCount() }} apuntes internos que se compensan están ocultos.
              <button type="button" class="link" (click)="groupRelated.set(false)">Mostrar</button>
            </p>
          }
        </section>
      } @else {
        <p class="empty">
          Nada importado todavía. Sube el <code>Transactions.csv</code> de DeGiro para empezar.
        </p>
      }
    } @else if (!loading()) {
      <p class="empty">
        Aquí van tus cuentas reales de broker. Crea una y súbele el extracto: nada se escribe a
        mano, todo sale del fichero.
      </p>
    }
  `,
  styles: `
    /* The side padding is the panel's, not the wall's: insetting only the grid would leave it
       out of line with every table above it, which reads as a mistake rather than as breathing
       room. Everything moves in together. */
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-height: 0;
      overflow: auto;
      padding: 0 1.75rem 1.25rem;
      gap: 0.75rem;
    }

    @media (max-width: 900px) {
      :host {
        padding: 0 0.75rem 1rem;
      }
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

    .tab-broker {
      font-size: 0.66rem;
      letter-spacing: 0.04em;
      opacity: 0.7;
    }

    .tab.active .tab-broker {
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
      color: var(--text-strong);
    }

    .link.danger:hover {
      color: var(--chart-down);
    }

    .editor,
    .import {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
    }

    .import {
      padding: 0.6rem 0.7rem;
      border: 1px dashed var(--border-control);
      border-radius: 0.5rem;
      background: var(--bg-control);
    }

    .field {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      color: var(--text-dim);
      font-size: 0.72rem;
    }

    .box {
      padding: 0.25rem 0.5rem;
      border: 1px solid var(--border-control);
      border-radius: 0.35rem;
      background: var(--bg-control);
      color: var(--text-input);
      font: inherit;
      font-size: 0.78rem;
    }

    .box.narrow {
      width: 8rem;
    }

    .go {
      padding: 0.25rem 0.7rem;
      border: 1px solid var(--accent);
      border-radius: 0.35rem;
      background: var(--accent);
      color: var(--on-accent);
      font: inherit;
      font-size: 0.78rem;
      cursor: pointer;
    }

    .go:disabled {
      opacity: 0.45;
      cursor: default;
    }

    .pick input {
      max-width: 15rem;
      color: var(--text-secondary);
      font: inherit;
      font-size: 0.72rem;
    }

    .picked {
      color: var(--text-strong);
      font-size: 0.72rem;
    }

    .hint {
      flex-basis: 100%;
      color: var(--text-dim);
      font-size: 0.68rem;
    }

    .result {
      margin: 0;
      color: var(--text-secondary);
      font-size: 0.74rem;
    }

    .warn {
      margin: 0;
      padding: 0.5rem 0.7rem;
      border-left: 3px solid var(--chart-down);
      border-radius: 0.25rem;
      background: var(--danger-soft);
      color: var(--text-strong);
      font-size: 0.74rem;
      line-height: 1.45;
    }

    .error {
      margin: 0;
      color: var(--chart-down);
      font-size: 0.75rem;
    }

    .empty {
      margin: 1.5rem 0;
      color: var(--text-dim);
      font-size: 0.8rem;
      line-height: 1.5;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
      gap: 0.75rem;
    }

    .tile {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      padding: 0.85rem 1rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--card);
    }

    .notice {
      margin: 0;
      padding: 0.7rem 0.9rem;
      border: 1px solid var(--border-control);
      border-radius: var(--radius);
      background: var(--accent-soft);
      color: var(--text);
      font-size: 0.78rem;
      line-height: 1.45;
    }

    .hero {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      grid-column: span 2;
      grid-row: span 2;
      padding: 1.1rem 1.25rem;
      border-radius: var(--radius);
      background: var(--bg-hero);
      color: var(--on-hero);
    }

    @media (max-width: 700px) {
      .hero {
        grid-column: 1 / -1;
        grid-row: auto;
      }
    }

    .hero-label {
      font-size: 0.78rem;
      opacity: 0.8;
    }

    .hero-value {
      font-size: 2.4rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      line-height: 1.1;
    }

    .hero-sub {
      font-size: 0.78rem;
      line-height: 1.4;
      opacity: 0.85;
    }

    .hero-gain {
      display: flex;
      align-items: baseline;
      gap: 0.6rem;
      margin-top: 0.6rem;
      padding-top: 0.8rem;
      border-top: 1px solid rgb(255 255 255 / 14%);
      font-variant-numeric: tabular-nums;
    }

    .hero-gain strong {
      font-size: 1.5rem;
    }

    .hero .up {
      color: #7fd4a6;
    }

    .hero .down {
      color: #f08a7c;
    }

    .alloc {
      padding: 1rem 1.1rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--card);
    }

    .alloc-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.3rem 1rem;
      margin-bottom: 0.7rem;
    }

    .alloc-title {
      margin: 0;
      color: var(--text-strong);
      font-size: 0.95rem;
    }

    .alloc-note {
      color: var(--accent);
      font-size: 0.74rem;
    }

    .alloc-bar {
      display: flex;
      gap: 2px;
      height: 1.1rem;
      overflow: hidden;
      border-radius: 4px;
    }

    .alloc-seg {
      flex-basis: 0;
      min-width: 2px;
    }

    .alloc-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem 1.1rem;
      margin: 0.7rem 0 0;
      padding: 0;
      list-style: none;
      color: var(--text-secondary);
      font-size: 0.74rem;
      font-variant-numeric: tabular-nums;
    }

    .dot {
      display: inline-block;
      width: 0.6rem;
      height: 0.6rem;
      margin-right: 0.25rem;
      border-radius: 2px;
    }

    .label {
      color: var(--text-dim);
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .value {
      color: var(--text-strong);
      font-size: 1rem;
      font-variant-numeric: tabular-nums;
    }

    .delta {
      color: var(--text-dim);
      font-size: 0.66rem;
      font-variant-numeric: tabular-nums;
    }

    .section-title {
      margin: 0.6rem 0 0.5rem;
      color: var(--text-strong);
      font-size: 1rem;
      font-weight: 600;
    }

    .muted {
      color: var(--text-dim);
      font-weight: 400;
      font-size: 0.78rem;
    }

    .section-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.2rem 0.9rem;
    }

    .seg {
      display: inline-flex;
      gap: 0.15rem;
      margin-left: auto;
      padding: 0.15rem;
      border-radius: 0.6rem;
      background: var(--bg-raised);
    }

    .seg button,
    .chip {
      border: 0;
      border-radius: 0.45rem;
      background: transparent;
      color: var(--text-secondary);
      font: inherit;
      font-size: 0.78rem;
      cursor: pointer;
    }

    .seg button {
      padding: 0.25rem 0.8rem;
    }

    .seg button.on {
      background: var(--card);
      color: var(--text-strong);
      font-weight: 600;
      box-shadow: 0 1px 2px var(--shadow);
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.4rem;
      margin-bottom: 0.6rem;
    }

    .chip {
      padding: 0.3rem 0.85rem;
      border: 1px solid var(--border-control);
      border-radius: 999px;
      background: var(--card);
    }

    .chip.on {
      border-color: var(--text-strong);
      background: var(--text-strong);
      color: var(--card);
    }

    .group-toggle {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      margin-left: auto;
      color: var(--text-secondary);
      font-size: 0.78rem;
      cursor: pointer;
    }

    .group-toggle input {
      accent-color: var(--accent);
    }

    .foot {
      margin: 0.5rem 0 0;
      color: var(--text-dim);
      font-size: 0.74rem;
    }

    .duo {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
      gap: 0.75rem;
      margin-bottom: 0.5rem;
    }

    .rank {
      padding: 0.9rem 1rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--card);
    }

    .rank-title {
      margin: 0 0 0.6rem;
      font-size: 0.82rem;
    }

    .rank-row {
      display: grid;
      grid-template-columns: minmax(6rem, 1.1fr) 2fr minmax(6rem, auto);
      align-items: center;
      gap: 0.75rem;
      padding: 0.3rem 0;
    }

    .rank-name {
      overflow: hidden;
      color: var(--text-strong);
      font-size: 0.82rem;
      font-weight: 600;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .rank-name small,
    .rank-value small {
      display: block;
      color: var(--text-dim);
      font-size: 0.66rem;
      font-weight: 400;
    }

    .rank-value {
      font-size: 0.82rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }

    .rank-value small {
      display: inline;
      margin-left: 0.25rem;
    }

    .rank-track {
      height: 0.55rem;
      overflow: hidden;
      border-radius: 999px;
      background: var(--bg-raised);
    }

    .rank-fill {
      display: block;
      height: 100%;
      border-radius: 999px;
    }

    .rank-fill.win {
      background: var(--chart-up);
    }

    .rank-fill.loss {
      background: var(--chart-down);
    }

    .grid {
      width: 100%;
      border: 1px solid var(--border);
      border-collapse: separate;
      border-spacing: 0;
      border-radius: var(--radius);
      overflow: hidden;
      background: var(--card);
      font-size: 0.78rem;
    }

    .grid tbody tr:last-child td {
      border-bottom: 0;
    }

    .grid th {
      padding: 0.3rem 0.5rem;
      border-bottom: 1px solid var(--border);
      color: var(--text-dim);
      font-weight: 500;
      text-align: left;
      white-space: nowrap;
    }

    .grid td {
      padding: 0.3rem 0.5rem;
      border-bottom: 1px solid var(--border);
      color: var(--text-secondary);
      vertical-align: baseline;
    }

    .grid .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .grid tr.flagged td {
      background: var(--danger-soft);
    }

    /* Six across. The count steps down on width rather than letting the tile squeeze: at this
       type size the name is what breaks first, and a name wrapped to four lines costs more than
       a column does. */
    .wall {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 0.4rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    @media (max-width: 1400px) {
      .wall {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }

    @media (max-width: 1100px) {
      .wall {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    @media (max-width: 700px) {
      .wall {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    .cell {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      min-width: 0;
      padding: 0.55rem 0.6rem;
      border: 1px solid var(--border);
      /* The left edge carries the sign, so the wall reads as a bar chart of outcomes before a
         single figure is read. The face is tinted from the same colour, faintly: at full strength
         forty tiles fight each other and nothing stands out. */
      border-left: 3px solid var(--border-control);
      border-radius: 0.6rem;
      background: var(--card);
    }

    .cell.win {
      border-left-color: var(--chart-up);
      background: color-mix(in srgb, var(--chart-up) 8%, var(--card));
    }

    .cell.loss {
      border-left-color: var(--chart-down);
      background: color-mix(in srgb, var(--chart-down) 8%, var(--card));
    }

    /* The name leads the tile now, so it is sized like a heading and not like a caption: at
       0.68rem it read as a label on the number, which is backwards — the company is what you are
       looking for and the number is what you then read off it. */
    .cell-name {
      overflow: hidden;
      color: var(--text-strong);
      font-size: 0.95rem;
      font-weight: 600;
      line-height: 1.2;
      /* Two lines, then an ellipsis. The full name is on the tile's title attribute. */
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      min-height: 2.3rem;
    }

    /* Money and percentage on one baseline, so the eye picks a column and runs down it. */
    .cell-result {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.3rem;
    }

    .cell-pnl {
      color: var(--text-strong);
      font-size: 1.05rem;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .cell-pct {
      font-size: 0.82rem;
      font-variant-numeric: tabular-nums;
      opacity: 0.85;
      white-space: nowrap;
    }

    .cell.win .cell-pct {
      color: var(--chart-up);
    }

    .cell.loss .cell-pct {
      color: var(--chart-down);
    }

    /* What went in and what came back. Rounded to whole units on purpose: the cents are in the
       book, and here they would cost the line a font size without telling anybody anything. */
    .cell-flow {
      color: var(--text-secondary);
      font-size: 0.78rem;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .arrow {
      opacity: 0.6;
    }

    .cell.win .cell-pnl {
      color: var(--chart-up);
    }

    .cell.loss .cell-pnl {
      color: var(--chart-down);
    }

    .cell.flagged {
      border-style: dashed;
    }

    .cell-flag {
      position: absolute;
      top: 0.2rem;
      right: 0.3rem;
      color: var(--text-dim);
      font-size: 0.7rem;
      cursor: help;
    }

    .isin {
      display: block;
      color: var(--text-dim);
      font-size: 0.64rem;
    }

    /* Sits in the row as text and turns into a field on hover or focus. An always-boxed input on
       every line would read as a form to fill in, when the ticker is answered once and then
       never touched again. */
    .ticker {
      width: 5.5rem;
      padding: 0.15rem 0.3rem;
      border: 1px solid var(--border);
      border-radius: 0.25rem;
      background: var(--bg-panel);
      color: var(--text-primary);
      font: inherit;
      font-size: 0.72rem;
      text-transform: uppercase;
    }

    .ticker:focus {
      border-color: var(--accent);
      outline: none;
    }

    /* Dashed and tinted while empty: it is the one cell on the screen still waiting on the user,
       and the whole row prints dashes until it is answered. */
    .ticker.unset {
      border-style: dashed;
      background: var(--danger-soft);
    }

    .ticker::placeholder {
      color: var(--text-dim);
      text-transform: none;
    }

    .pct {
      margin-left: 0.3rem;
      color: var(--text-dim);
      font-size: 0.68rem;
    }

    .flag {
      margin-left: 0.35rem;
      padding: 0 0.3rem;
      border-radius: 0.25rem;
      background: var(--chart-down);
      color: var(--on-accent);
      font-size: 0.6rem;
      text-transform: uppercase;
    }

    .kind {
      padding: 0.1rem 0.5rem;
      border-radius: 999px;
      background: var(--bg-raised);
      font-size: 0.7rem;
      white-space: nowrap;
    }

    .kind.income {
      background: color-mix(in srgb, var(--chart-up) 14%, var(--card));
      color: var(--chart-up);
    }

    .kind.swap {
      color: var(--text-dim);
      font-style: italic;
    }

    .up {
      color: var(--chart-up);
    }

    .down {
      color: var(--chart-down);
    }
  `,
})
export class BrokerPanelComponent {
  private readonly service = inject(BrokerService);

  readonly limit = BOOK_LIMIT;

  readonly accounts = signal<BrokerAccount[]>([]);
  readonly book = signal<Transaction[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly lastImport = signal<ImportResult | null>(null);
  readonly picked = signal<File | null>(null);

  readonly editing = signal<'create' | 'rename' | null>(null);
  readonly draftName = signal('');
  readonly draftBroker = signal<Broker>('DEGIRO');

  /**
   * The open account. A linkedSignal over the list so that deleting one, or arriving with a
   * remembered id that no longer exists, falls back to the first instead of showing nothing.
   */
  readonly active = linkedSignal<BrokerAccount[], BrokerAccount | null>({
    source: this.accounts,
    computation: (list) => list.find((item) => item.id === this.service.activeId()) ?? list[0] ?? null,
  });

  readonly open = computed(() => this.active()?.holdings.filter((h) => h.quantity > 0) ?? []);
  /**
   * The closed wall, biggest result first. Alphabetical is the right order for a table you look
   * something up in and the wrong one for a wall you glance at: what the eye is after here is
   * which position carried the year, and by name that tile is somewhere in the middle.
   */
  readonly closed = computed(() =>
    [...(this.active()?.holdings ?? [])]
      .filter((holding) => holding.quantity === 0)
      .sort((a, b) => b.realizedPnl - a.realizedPnl),
  );
  readonly bookFilters = BOOK_FILTERS;
  readonly bookFilter = signal<BookFilter['id']>('ALL');
  readonly groupRelated = signal(true);
  readonly closedView = signal<'summary' | 'all'>('summary');

  /**
   * Cash-only lines that undo each other the same day in the same currency (a deposit and the
   * transfer that books it, a charge and its refund). They are bookkeeping, not events: hiding
   * them is a display choice, and the totals above never read this list.
   */
  private readonly offsetting = computed(() => {
    const waiting = new Map<string, string[]>();
    const hidden = new Set<string>();
    for (const row of this.book()) {
      const cents = Math.round(row.amount * 100);
      if (row.isin || cents === 0 || !OFFSETTABLE.has(row.kind)) {
        continue;
      }
      const day = row.executedAt.slice(0, 10);
      const mate = waiting.get(`${day}|${row.currency}|${-cents}`)?.pop();
      if (mate) {
        hidden.add(mate);
        hidden.add(row.id);
        continue;
      }
      const key = `${day}|${row.currency}|${cents}`;
      waiting.set(key, [...(waiting.get(key) ?? []), row.id]);
    }
    return hidden;
  });

  private readonly bookByKind = computed(() => {
    const kinds = BOOK_FILTERS.find((f) => f.id === this.bookFilter())?.kinds;
    return kinds ? this.book().filter((row) => kinds.includes(row.kind)) : this.book();
  });

  readonly filteredBook = computed(() =>
    this.groupRelated()
      ? this.bookByKind().filter((row) => !this.offsetting().has(row.id))
      : this.bookByKind(),
  );
  readonly hiddenCount = computed(() => this.bookByKind().length - this.filteredBook().length);
  readonly visibleBook = computed(() => this.filteredBook().slice(0, BOOK_LIMIT));

  /** Wins, losses and the two ranked lists of the closed summary. */
  readonly closedStats = computed(() => {
    const all = this.closed();
    if (!all.length) {
      return null;
    }
    const max = Math.max(...all.map((h) => Math.abs(h.realizedPnl)), 1);
    const row = (holding: Holding) => ({
      holding,
      width: Math.max((Math.abs(holding.realizedPnl) / max) * 100, 2),
    });
    const wins = all.filter((h) => h.realizedPnl > 0);
    const losses = all.filter((h) => h.realizedPnl < 0);
    return {
      wins: wins.length,
      losses: losses.length,
      rate: Math.round((wins.length / all.length) * 100),
      // `closed` is sorted best first, so the worst are read off the tail, worst of all first.
      groups: [
        { title: 'Mejores operaciones', win: true, items: wins.slice(0, RANK_SIZE).map(row) },
        {
          title: 'Peores operaciones',
          win: false,
          items: losses.slice(-RANK_SIZE).reverse().map(row),
        },
      ].filter((group) => group.items.length),
    };
  });

  /**
   * Invested and realised, per currency and never added across them.
   *
   * <p>The trades export settles everything in euros, so one figure was enough for it. The cash
   * book does not: it records the fill in the currency it happened in, so a DeGiro account holds
   * its positions in dollars while its fees are charged in euros. Adding those needs a rate, and
   * a rate applied here would invent a number the broker never printed.
   */
  private totalsBy(pick: (holding: Holding) => number, from: () => Holding[]) {
    const byCurrency = new Map<string, number>();
    for (const holding of from()) {
      byCurrency.set(holding.currency, (byCurrency.get(holding.currency) ?? 0) + pick(holding));
    }
    return [...byCurrency]
      .filter(([, amount]) => amount !== 0)
      .map(([currency, amount]) => ({ currency, amount }));
  }

  readonly invested = computed(() => this.totalsBy((h) => h.cost, () => this.open()));

  readonly realized = computed(() =>
    this.totalsBy((h) => h.realizedPnl, () => this.active()?.holdings ?? []),
  );

  /**
   * What the open positions are worth now, and by how much that beats what they cost.
   *
   * <p>In the currency the account is funded in, because the server has already converted there.
   * Note this is not the currency Invertido and Realizado beside them use: those are in the
   * currency the fills were booked in, which for a euro account buying US shares is dollars. The
   * two will read differently and that is the truth of the account, not a bug — until Realizado
   * gets the same treatment.
   *
   * <p>Positions that could not be priced are simply absent, which is why the table says so
   * underneath: a total quietly missing one line is worse than a total that admits it.
   */
  private marketTotalsBy(pick: (holding: Holding) => number | null) {
    const byCurrency = new Map<string, number>();
    for (const holding of this.open()) {
      const amount = pick(holding);
      if (amount === null) {
        continue;
      }
      byCurrency.set(holding.baseCurrency, (byCurrency.get(holding.baseCurrency) ?? 0) + amount);
    }
    return [...byCurrency]
      .filter(([, amount]) => amount !== 0)
      .map(([currency, amount]) => ({ currency, amount }));
  }

  readonly marketValue = computed(() => this.marketTotalsBy((h) => h.marketValue));
  readonly unrealized = computed(() => this.marketTotalsBy((h) => h.unrealizedPnl));

  /** Whole days since the newest imported row, once it is old enough to be worth saying. */
  readonly staleDays = computed(() => {
    const last = this.active()?.lastMovement;
    if (!last) {
      return 0;
    }
    const days = Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000);
    return days > STALE_AFTER_DAYS ? days : 0;
  });

  /**
   * The headline: positions plus cash in the one currency the account is funded in, set against
   * what was paid in. Null when the open positions are priced in more than one currency, since a
   * single total would then need a rate this screen does not have.
   *
   * <p>Cash in any other currency is not added, only mentioned: a few cents of dollars left over
   * from a fill is not worth inventing a rate for.
   */
  readonly hero = computed(() => {
    const account = this.active();
    const markets = this.marketValue();
    if (!account || markets.length > 1) {
      return null;
    }
    const currency = markets[0]?.currency ?? account.balances[0]?.currency;
    if (!currency) {
      return null;
    }
    const positions = markets[0]?.amount ?? 0;
    const cash = account.balances.find((b) => b.currency === currency)?.amount ?? 0;
    const wealth = positions + cash;
    if (wealth <= 0) {
      return null;
    }

    const otherCash = account.balances
      .filter((b) => b.currency !== currency && b.amount !== 0)
      .map((b) => `${formatMoney(b.amount, b.currency)}`)
      .join(', ');

    const flow = (kind: Flow['kind']) =>
      Math.abs(
        account.flows.find((f) => f.kind === kind && f.currency === currency)?.amount ?? 0,
      );
    const deposits = flow('DEPOSIT');
    const withdrawals = flow('WITHDRAWAL');
    const net = deposits - withdrawals;
    const gain = deposits > 0 ? wealth - net : null;

    const slices = this.open()
      .filter((h) => h.marketValue !== null && h.marketValue > 0)
      .map((h) => ({
        name: h.symbol ?? this.short(h.product, h.isin),
        value: h.marketValue as number,
      }))
      .concat(cash > 0 ? [{ name: 'Efectivo', value: cash }] : [])
      .sort((a, b) => b.value - a.value)
      .map((slice, index) => ({
        ...slice,
        color: slice.name === 'Efectivo' ? CASH_COLOR : SLICE_COLORS[index % SLICE_COLORS.length],
        label: `${((slice.value / wealth) * 100).toLocaleString('es-ES', {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })} %`,
      }));

    const top = slices.filter((s) => s.name !== 'Efectivo').slice(0, 2);
    const topShare = top.reduce((sum, s) => sum + s.value, 0) / wealth;
    const concentration =
      top.length === 2 && topShare > 0.5
        ? `${top[0].name} y ${top[1].name} suman ${(topShare * 100).toLocaleString('es-ES', {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })} %: una caída del 10 % en ambas restaría unos ${formatRound(
            topShare * wealth * 0.1,
            currency,
          )}`
        : null;

    return {
      currency,
      wealth,
      positions,
      cash,
      otherCash: otherCash ? ` (y ${otherCash})` : '',
      deposits,
      withdrawals,
      net,
      gain,
      gainPercent: gain !== null && net > 0 ? (gain / net) * 100 : null,
      slices,
      concentration,
    };
  });

  /** Open positions the user has not named yet — the ones a ticker would immediately fix. */
  readonly unmapped = computed(() =>
    this.open().filter((h) => !h.symbol).map((h) => this.short(h.product, h.isin)),
  );

  /** Named, and still unpriced: the ticker is wrong, or nothing quotes it. A different problem. */
  readonly unquoted = computed(() =>
    this.open()
      .filter((h) => h.symbol && h.lastPrice === null)
      .map((h) => h.symbol as string),
  );

  /**
   * Writes down what an ISIN is. The whole list comes back priced, so one call repaints every
   * account rather than saving and then reloading to see the number it just unlocked.
   */
  async setSymbol(holding: Holding, symbol: string): Promise<void> {
    const trimmed = symbol.trim().toUpperCase();
    if (trimmed === (holding.symbol ?? '')) {
      return;                             // a blur that changed nothing is not an edit
    }
    try {
      this.accounts.set(await this.service.mapSymbol(holding.isin, trimmed));
    } catch (err) {
      this.error.set(this.message(err));
    }
  }

  constructor() {
    void this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    try {
      this.accounts.set(await this.service.list());
      await this.loadBook();
    } catch (err) {
      this.error.set(this.message(err));
    } finally {
      this.loading.set(false);
    }
  }

  async select(id: string): Promise<void> {
    this.service.setActive(id);
    this.active.set(this.accounts().find((item) => item.id === id) ?? null);
    this.lastImport.set(null);
    this.picked.set(null);
    await this.loadBook();
  }

  startCreate(): void {
    this.draftName.set('');
    this.draftBroker.set('DEGIRO');
    this.editing.set('create');
  }

  startRename(): void {
    this.draftName.set(this.active()?.name ?? '');
    this.editing.set('rename');
  }

  async submitEdit(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.draftName().trim();
    if (!name) {
      return;
    }
    this.error.set(null);
    const mode = this.editing();
    try {
      if (mode === 'create') {
        const created = await this.service.create(name, this.draftBroker());
        this.accounts.update((list) => [...list, created]);
        this.service.setActive(created.id);
        this.active.set(created);
        this.book.set([]);
      } else {
        const current = this.active();
        if (!current) {
          return;
        }
        const saved = await this.service.rename(current.id, name, current.broker);
        this.replace(saved);
      }
      this.editing.set(null);
    } catch (err) {
      this.error.set(this.message(err));
    }
  }

  async removeActive(): Promise<void> {
    const current = this.active();
    if (!current || !confirm(`¿Borrar la cuenta "${current.name}" y sus movimientos importados?`)) {
      return;
    }
    try {
      await this.service.remove(current.id);
      this.accounts.update((list) => list.filter((item) => item.id !== current.id));
      this.service.setActive(this.accounts()[0]?.id ?? null);
      this.lastImport.set(null);
      await this.loadBook();
    } catch (err) {
      this.error.set(this.message(err));
    }
  }

  onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.picked.set(input.files?.[0] ?? null);
    this.error.set(null);
  }

  async runImport(): Promise<void> {
    const current = this.active();
    const file = this.picked();
    if (!current || !file) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.service.importStatement(current.id, file);
      this.lastImport.set(result);
      this.replace(result.account);
      this.picked.set(null);
      await this.loadBook();
    } catch (err) {
      this.error.set(this.message(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async loadBook(): Promise<void> {
    const current = this.active();
    if (!current) {
      this.book.set([]);
      return;
    }
    this.book.set(await this.service.transactions(current.id));
  }

  private replace(account: BrokerAccount): void {
    this.accounts.update((list) =>
      list.map((item) => (item.id === account.id ? account : item)),
    );
    this.active.set(account);
  }

  private message(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      return err.error?.error ?? `Error ${err.status}`;
    }
    return 'Algo ha fallado';
  }

  money = formatMoney;
  signed = formatSignedMoney;
  price = formatPrice;
  units = formatUnits;
  day = formatDay;
  short = shortName;
  percent = formatPercent;
  round = formatRound;
  label = (kind: Transaction['kind']): string => KIND_LABEL[kind];
}
