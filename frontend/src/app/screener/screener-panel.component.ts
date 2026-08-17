import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  FILTER_GROUPS,
  FilterGroup,
  PAGE_SIZE,
  PRESETS,
  Preset,
  RANGE_SELECTS,
  ScreenerSymbol,
  SortField,
  filtersFrom,
  picksOf,
  relativeVolume,
  formatCompact,
  formatMultiple,
  formatPercent,
  formatPrice,
  formatRatio,
} from './screener.models';
import { ScreenerService } from './screener.service';
import { Watchlist } from '../watchlist/watchlist.models';
import { WatchlistService } from '../watchlist/watchlist.service';

/** Typing a ticker should not fire a request per keystroke. */
const TYPING_PAUSE_MS = 250;

/** How often the table asks again while a quote sweep is running. */
const POLL_MS = 3000;

/** Room the watchlist menu needs below its button before it has to slide up. */
const MENU_HEIGHT = 260;

/** Whether the filter panel was left open. UI state, so it stays in the browser. */
const PANEL_OPEN_KEY = 'tickerlab.screenerFiltersOpen';

/**
 * How the table was left: the dropdowns off their "no filter" entry, the exchange, and the
 * sorted column. One key for the lot, because they only make sense read together — restoring
 * filters without their order shows the right rows in the wrong sequence. The ticker box is
 * deliberately out: a search is what someone is doing now, not how they want the table set up.
 */
const VIEW_KEY = 'tickerlab.screenerView';

/** What lands in `VIEW_KEY`. Everything optional: an older entry is missing the newer fields. */
interface StoredView {
  picks?: Record<string, number>;
  exchange?: string;
  sort?: SortField;
  descending?: boolean;
}

interface Column {
  /** Doubles as the CSS class and, unless derived, as the field the backend orders by. */
  readonly field: SortField | 'relVolume';
  readonly label: string;
  readonly numeric: boolean;
  /**
   * Worked out in the browser from two other columns, so there is no field for the backend
   * to order by and the header does not offer it: sorting the 25 rows on screen would claim
   * to rank 5.956 and rank a page.
   */
  readonly derived?: boolean;
}

/** Header cells, in the order they are drawn. Text sorts ascending, numbers descending. */
const COLUMNS: readonly Column[] = [
  { field: 'symbol', label: 'Ticker', numeric: false },
  { field: 'name', label: 'Nombre', numeric: false },
  { field: 'exchange', label: 'Mercado', numeric: false },
  { field: 'price', label: 'Precio', numeric: true },
  { field: 'changePercent', label: 'Var. %', numeric: true },
  { field: 'volume', label: 'Volumen', numeric: true },
  // Next to the volume it qualifies rather than at the end: read alone, 40 M says nothing
  // about whether today is busy for this ticker, and the pair says it without arithmetic.
  { field: 'relVolume', label: 'Vol. rel.', numeric: true, derived: true },
  { field: 'marketCap', label: 'Capitalización', numeric: true },
  { field: 'per', label: 'PER', numeric: true },
  { field: 'eps', label: 'BPA', numeric: true },
  { field: 'change52w', label: '52 sem.', numeric: true },
  { field: 'rsRating', label: 'RS', numeric: true },
];

/** At or above this the stock is outrunning 80 % of the market: IBD's bar for a leader. */
const RS_LEADER = 80;

/** The two ends of the relative-volume filter, so the column marks what the dropdowns select. */
const VOLUME_SURGE = 1.5;
const VOLUME_DRY = 0.7;

/**
 * Nothing stored is trusted as-is: a dropdown may have been renamed or lost a tier since the
 * entry was written, and an unknown id or an index past the end of its options would send a
 * bound the backend never asked for. Whatever fails a check is dropped, not the whole entry.
 */
function storedView(): StoredView {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as StoredView;
    const picks = Object.entries(saved.picks ?? {}).filter(([id, index]) => {
      const select = RANGE_SELECTS.find((candidate) => candidate.id === id);
      return select && Number.isInteger(index) && index > 0 && index < select.options.length;
    });
    return {
      picks: Object.fromEntries(picks),
      exchange: typeof saved.exchange === 'string' ? saved.exchange : '',
      // A derived column never was a valid sort, so one saved by a future version of the
      // table is dropped here rather than sent to a backend that cannot order by it.
      sort: COLUMNS.some((column) => !column.derived && column.field === saved.sort)
        ? saved.sort
        : 'symbol',
      descending: saved.descending === true,
    };
  } catch {
    return { picks: {}, exchange: '', sort: 'symbol', descending: false };
  }
}

@Component({
  selector: 'app-screener-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Clicking anywhere else dismisses an open watchlist menu; the menu and its button stop
    // the event before it gets here.
    '(document:click)': 'closeAdd()',
    // Which of the two shapes the panel is wearing, so the styles below can follow the
    // template's own @if instead of guessing at a width.
    '[class.narrow]': 'narrow()',
  },
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

      <!--
        Both dropdowns mark the chosen entry with "selected" on the option instead of "value" on
        the select. A select's value binding runs before the @for inside it creates any option,
        so a restored value has nothing to land on and the select stays on its first entry —
        showing "no filter" over a filter that is being applied. It never showed while the state
        started empty: by the time a value exists, the dropdown has just been moved by hand.
      -->
      <select
        class="filter-range"
        [class.set]="exchange()"
        (change)="onExchange($any($event.target).value)"
      >
        <option value="" [selected]="!exchange()">Todos los mercados</option>
        @for (option of exchanges(); track option) {
          <option [value]="option" [selected]="option === exchange()">{{ option }}</option>
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
        <div class="filter-group">
          <span class="group-name">Escaneos</span>
          @for (preset of presets; track preset.name) {
            <button
              type="button"
              class="preset"
              [class.on]="preset.name === activePreset()"
              [title]="preset.hint"
              (click)="applyPreset(preset)"
            >
              {{ preset.name }}
            </button>
          }
        </div>

        @for (group of groups; track group) {
          <div class="filter-group">
            <span class="group-name">{{ group }}</span>
            @for (select of selectsOf(group); track select.id) {
              <label class="field" [class.set]="picks()[select.id]">
                <span class="field-name">{{ select.label }}</span>
                <select
                  class="filter-range"
                  [class.set]="picks()[select.id]"
                  (change)="pick(select.id, +$any($event.target).value)"
                >
                  @for (option of select.options; track option.label; let i = $index) {
                    <option [value]="i" [selected]="i === (picks()[select.id] ?? 0)">
                      {{ option.label }}
                    </option>
                  }
                </select>
              </label>
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

    <!--
      Once a row is picked the list drops to a quarter of the screen so the chart can have the
      rest, and twelve columns in that width would either scroll sideways — hiding half of every
      row behind a bar nobody drags — or squeeze each number into three characters. So it changes
      shape rather than shrinking: the ticker and its price on top, what it is under that, and the
      rest as chips that wrap. Nothing is dropped, it is only read down instead of across. With
      no row picked there is no chart to make room for, and the table stays a table.
    -->
    <!--
      Everything above stays the full width of the screen in both shapes: the filter bar is the
      same bar whether or not a row is open, and shrinking it to a quarter to match the list
      below would rewrap eight controls into a column for no reason. Only from here down does
      the screen split, the list on the left and whatever is projected in — the detail and its
      chart — on the right.
    -->
    <div class="body">
    <div class="list">
    @if (narrow()) {
      <!-- The order moves in here with the cards: there is no header row left to click, and it
           stays out of the filter bar, which is the same bar in both shapes. -->
      <div class="list-sort">
        <select class="filter-range" (change)="onSort($any($event.target).value)">
          @for (column of sortable; track column.field) {
            <option [value]="column.field" [selected]="column.field === sort()">
              {{ column.label }}
            </option>
          }
        </select>
        <button
          type="button"
          class="sort-dir"
          [title]="descending() ? 'De mayor a menor' : 'De menor a mayor'"
          (click)="flipSort()"
        >
          {{ descending() ? '▾' : '▴' }}
        </button>
      </div>

      <div class="table-wrap" (scroll)="closeAdd()">
      <ul class="symbols cards">
        @for (row of rows(); track row.symbol) {
          <li
            class="row"
            [class.picked]="selectedSymbol() === row.symbol"
            (click)="selected.emit(row)"
            [title]="'Ver el detalle de ' + row.symbol"
          >
            <div class="line-top">
              <span class="symbol">{{ row.symbol }}</span>
              <span class="price">{{ price(row.price) }}</span>
              <span
                class="change"
                [class.up]="(row.changePercent ?? 0) > 0"
                [class.down]="(row.changePercent ?? 0) < 0"
              >
                {{ percent(row.changePercent) }}
              </span>
            </div>

            <div class="line-name">
              <span class="name">{{ row.name }}</span>
              <span class="exchange">{{ row.exchange }}</span>
            </div>

            <!-- Every chip carries its own label: out of a column there is nothing above the
                 number saying what it is, and 31,2 is a PER or a percentage depending. -->
            <div class="line-stats">
              <span class="chip"><b>Cap</b> {{ compact(row.marketCap) }}</span>
              <span class="chip"><b>Vol</b> {{ compact(row.volume) }}</span>
              <!-- Lit above the surge line and dimmed below it: the number only matters when
                   today's interest is out of the ordinary in one direction or the other. -->
              <span
                class="chip"
                [class.up]="(relVolume(row) ?? 0) >= volumeSurge"
                [class.quiet]="relVolume(row) !== null && (relVolume(row) ?? 0) <= volumeDry"
              >
                {{ multiple(relVolume(row)) }}
              </span>
              <span class="chip"><b>PER</b> {{ ratio(row.per) }}</span>
              <span class="chip" [class.down]="(row.eps ?? 0) < 0"><b>BPA</b> {{ ratio(row.eps) }}</span>
              <span
                class="chip"
                [class.up]="(row.change52w ?? 0) > 0"
                [class.down]="(row.change52w ?? 0) < 0"
              >
                <b>52s</b> {{ percent(row.change52w) }}
              </span>
              <!-- Highlighted, not coloured up/down: a rating has no sign, only a bar. -->
              <span class="chip" [class.up]="(row.rsRating ?? 0) >= rsLeader">
                <b>RS</b> {{ row.rsRating ?? '—' }}
              </span>
            </div>

            <button
              type="button"
              class="add"
              [class.open]="addTarget()?.row?.symbol === row.symbol"
              [title]="'Añadir ' + row.symbol + ' a una watchlist'"
              (click)="toggleAdd(row, $event)"
            >
              +
            </button>
          </li>
        } @empty {
          <li class="empty">
            @if (loading()) {
              Cargando…
            } @else if (filtered()) {
              Nada coincide con el filtro. Las acciones aún sin cotizar no entran en los
              filtros numéricos.
            } @else {
              El universo está vacío. Pulsa «Actualizar universo» para traer las ~6.000 acciones
              de Nasdaq Trader.
            }
          </li>
        }
      </ul>
      </div>
    } @else {
      <div class="table-wrap" (scroll)="closeAdd()">
        <table class="symbols">
          <thead>
            <tr>
              @for (column of columns; track column.field) {
                <th
                  class="col-{{ column.field }}"
                  [class.numeric]="column.numeric"
                  [class.sorted]="sort() === column.field"
                  [class.derived]="column.derived"
                  (click)="sortBy(column)"
                >
                  {{ column.label }}
                  @if (sort() === column.field) {
                    <span class="arrow">{{ descending() ? '▾' : '▴' }}</span>
                  }
                </th>
              }
              <th class="col-add"></th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.symbol) {
              <tr
                class="row"
                (click)="selected.emit(row)"
                [title]="'Ver el detalle de ' + row.symbol"
              >
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
                <!-- Lit above the surge line and dimmed below it: the number only matters when
                     today's interest is out of the ordinary in one direction or the other. -->
                <td
                  class="col-relVolume numeric"
                  [class.up]="(relVolume(row) ?? 0) >= volumeSurge"
                  [class.quiet]="relVolume(row) !== null && (relVolume(row) ?? 0) <= volumeDry"
                >
                  {{ multiple(relVolume(row)) }}
                </td>
                <td class="col-marketCap numeric">{{ compact(row.marketCap) }}</td>
                <td class="col-per numeric">{{ ratio(row.per) }}</td>
                <td class="col-eps numeric" [class.down]="(row.eps ?? 0) < 0">
                  {{ ratio(row.eps) }}
                </td>
                <td
                  class="col-change52w numeric"
                  [class.up]="(row.change52w ?? 0) > 0"
                  [class.down]="(row.change52w ?? 0) < 0"
                >
                  {{ percent(row.change52w) }}
                </td>
                <!-- Highlighted, not coloured up/down: a rating has no sign, only a bar. -->
                <td class="col-rsRating numeric" [class.up]="(row.rsRating ?? 0) >= rsLeader">
                  {{ row.rsRating ?? '—' }}
                </td>
                <td class="col-add">
                  <button
                    type="button"
                    class="add"
                    [class.open]="addTarget()?.row?.symbol === row.symbol"
                    [title]="'Añadir ' + row.symbol + ' a una watchlist'"
                    (click)="toggleAdd(row, $event)"
                  >
                    +
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td class="empty" [attr.colspan]="columns.length + 1">
                  @if (loading()) {
                    Cargando…
                  } @else if (filtered()) {
                    Nada coincide con el filtro. Las acciones aún sin cotizar no entran en los
                    filtros numéricos.
                  } @else {
                    El universo está vacío. Pulsa «Actualizar universo» para traer las ~6.000
                    acciones de Nasdaq Trader.
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <footer class="pager">
      <button type="button" [disabled]="page() === 0 || loading()" (click)="go(page() - 1)">‹ Anterior</button>
      <span class="page-label">Página {{ page() + 1 }} de {{ pageCount() }}</span>
      <button type="button" [disabled]="page() + 1 >= pageCount() || loading()" (click)="go(page() + 1)">
        Siguiente ›
      </button>
    </footer>
    </div>

    <ng-content />
    </div>

    <!-- Anchored to the button but drawn outside the table, which clips what it scrolls. -->
    @if (addTarget(); as target) {
      <div
        class="add-popover"
        [style.top.px]="target.top"
        [style.right.px]="target.right"
        (click)="$event.stopPropagation()"
      >
        <p class="add-title">Añadir {{ target.row.symbol }} a</p>

        @for (list of lists(); track list.id) {
          <button type="button" class="add-option" (click)="addTo(list, target.row)">
            <span class="add-name">{{ list.name }}</span>
            @if (holds(list, target.row.symbol)) {
              <span class="add-mark" title="Ya está en la lista">✓</span>
            }
          </button>
        } @empty {
          <p class="add-empty">{{ listsLoading() ? 'Cargando…' : 'Todavía no hay listas.' }}</p>
        }

        @if (newList()) {
          <form
            class="add-form"
            (submit)="$event.preventDefault(); createAndAdd(box.value, target.row)"
          >
            <input
              #box
              type="text"
              maxlength="60"
              placeholder="Nombre de la lista"
              autocomplete="off"
              autofocus
              (keydown.escape)="newList.set(false)"
            />
            <button type="submit" class="icon" title="Crear y añadir">✓</button>
          </form>
        } @else {
          <button type="button" class="add-option new" (click)="newList.set(true)">
            + Nueva lista
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host {
      /* With no row picked the table is a block of its own, not the whole viewport: capped
         in width, as tall as its PAGE_SIZE rows, and the space left over stays empty. */
      --table-max-width: 1400px;

      /* Either way it fills the column it is given — a quarter of the screen next to the
         chart, all of it before a row is picked — and scrolls inside, not the page. */
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      flex: 1;
      overflow: hidden;
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

    /* The dropdown and its direction read as one control, so they stay welded when the bar wraps. */
    .sort {
      display: flex;
      align-items: stretch;
      gap: 0.2rem;
    }

    .sort-dir {
      padding: 0 0.45rem;
      border: 1px solid var(--border-control);
      border-radius: 4px;
      background: var(--bg-control);
      color: var(--accent);
      font: inherit;
      font-size: 0.72rem;
      cursor: pointer;
    }

    .sort-dir:hover {
      border-color: var(--accent);
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

    /* Shaped like the panel toggle because it is the same kind of control: a switch, not a link. */
    .preset {
      padding: 0.35rem 0.6rem;
      border: 1px solid var(--border-control);
      border-radius: 6px;
      background: var(--bg-control);
      color: var(--text-secondary);
      font: inherit;
      font-size: 0.78rem;
      cursor: pointer;
    }

    .preset:hover,
    .preset.on {
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
      /* More room between rows than between dropdowns: each one is two lines tall now, and
         without it a wrapped row reads as belonging to the group above. */
      gap: 0.5rem 0.4rem;
    }

    /* The name stays put above the dropdown. A select only shows the entry it sits on, so
       choosing a tier drops whatever named the field — and «Precio por encima» is the same
       text in the SMA 50 and the SMA 200 dropdowns. */
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }

    .field-name {
      padding-left: 0.1rem;
      color: var(--text-dim);
      font-size: 0.64rem;
      letter-spacing: 0.03em;
    }

    /* Lit with the dropdown it belongs to, so a filter that is doing something reads as one
       block instead of an accented box under a grey word. */
    .field.set .field-name {
      color: var(--accent);
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

    /* One column until a row is picked; a quarter and the rest once there is a chart to
       show. Only this part splits — the filters above span both. */
    .body {
      display: grid;
      grid-template-columns: 1fr;
      flex: 1;
      min-height: 0;
    }

    :host(.narrow) .body {
      grid-template-columns: 25% 1fr;
    }

    .list {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }

    /* No max-height and no flex: 1 — the block is exactly as tall as the PAGE_SIZE rows it
       holds, so nothing scrolls. Shrinking (0 1 auto) only kicks in on a window too short
       for a full page, and that is the one case the scrollbar is allowed to appear. */
    .table-wrap {
      flex: 0 1 auto;
      min-height: 0;
      width: 100%;
      max-width: var(--table-max-width);
      margin: 1rem auto 0;
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: auto;
    }

    /* Beside a chart there is no width to cap and no space to leave empty: the pane is the
       block. A card is four lines tall, so a page of 25 no longer fits a window the way the
       single-line rows did, and the list takes the room left over and scrolls inside it. */
    :host(.narrow) .table-wrap {
      flex: 1 1 auto;
      max-width: none;
      margin: 0;
      border: 0;
      border-radius: 0;
      overflow-x: hidden;
      overflow-y: auto;
    }

    /* The order the header row carries in the wide table, on its own strip. Not folded into
       the filter bar above: that bar is the same one in both shapes. */
    .list-sort {
      display: flex;
      align-items: stretch;
      gap: 0.25rem;
      padding: 0.4rem 0.6rem;
      border-bottom: 1px solid var(--border);
      background: var(--bg-panel);
    }

    .list-sort .filter-range {
      flex: 1;
      min-width: 0;
    }

    .sort-dir {
      padding: 0 0.5rem;
      border: 1px solid var(--border-control);
      border-radius: 4px;
      background: var(--bg-control);
      color: var(--accent);
      font: inherit;
      font-size: 0.72rem;
      cursor: pointer;
    }

    .sort-dir:hover {
      border-color: var(--accent);
    }

    .symbols {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }

    /* Sticky only matters on a window too short for a full page; normally nothing scrolls. */
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

    /* No pointer and no hover: the header is a label here, and offering a click that does
       nothing is worse than a column that never looked sortable. */
    .symbols thead th.derived,
    .symbols thead th.derived:hover {
      color: var(--text-dim);
      cursor: default;
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

    /* 0.25rem, not 0.35rem: at 33px a row the 25 of a page overflow a 1080p window and the
       scrollbar comes back. This is the padding that makes a full page fit without one. */
    .row td {
      padding: 0.25rem 0.9rem;
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

    .col-changePercent,
    .col-relVolume {
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

    .col-rsRating {
      width: 4rem;
    }

    .row td.up {
      color: var(--chart-up);
    }

    .row td.down {
      color: var(--chart-down);
    }

    /* Dimmed, not coloured: dry volume is neither good nor bad, it is the absence of news. */
    .row td.quiet {
      color: var(--text-dim);
    }

    .col-add {
      width: 2.4rem;
      text-align: center;
    }

    .symbols thead th.col-add {
      cursor: default;
    }

    .symbols thead th.col-add:hover {
      color: var(--text-dim);
    }

    /* ---- The same rows, stacked, for the quarter-width pane beside the chart ---- */

    .cards {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .cards .row {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      padding: 0.45rem 0.75rem;
      border-bottom: 1px solid var(--border);
    }

    /* The card the chart belongs to. The left rule survives the hover background, which is
       what keeps it findable after scrolling the list. */
    .cards .row.picked {
      background: var(--bg-raised);
      box-shadow: inset 3px 0 0 var(--accent);
    }

    /* Ticker left, price and change right: the pair that decides whether the rest is worth
       reading, on the line the eye lands on first. */
    .line-top {
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
      /* Room for the add button, which floats over this corner. */
      padding-right: 1.4rem;
      font-variant-numeric: tabular-nums;
    }

    .symbol {
      color: var(--text);
      font-size: 0.86rem;
      font-weight: 600;
      letter-spacing: 0.01em;
    }

    .cards .row.picked .symbol {
      color: var(--text-strong);
    }

    .price {
      margin-left: auto;
      color: var(--text);
    }

    .change {
      min-width: 3.6rem;
      color: var(--text-secondary);
      text-align: right;
    }

    .line-name {
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
      color: var(--text-dim);
      font-size: 0.72rem;
    }

    /* The long ones give their room to the exchange rather than pushing it onto its own line. */
    .name {
      overflow: hidden;
      flex: 1;
      min-width: 0;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .exchange {
      flex: none;
      font-size: 0.64rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    /* Wraps to a second line in a narrow column instead of overflowing it. */
    .line-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 0.1rem 0.55rem;
      margin-top: 0.1rem;
      color: var(--text-secondary);
      font-size: 0.7rem;
      font-variant-numeric: tabular-nums;
    }

    /* The label is what makes a bare number readable outside a column, so it is always drawn
       — dimmed, so the row still reads as numbers with hints and not as a sentence. */
    .chip b {
      color: var(--text-dim);
      font-weight: 500;
    }

    .chip.up {
      color: var(--chart-up);
    }

    .chip.down {
      color: var(--chart-down);
    }

    /* Dimmed, not coloured: dry volume is neither good nor bad, it is the absence of news. */
    .chip.quiet {
      color: var(--text-dim);
    }

    .change.up {
      color: var(--chart-up);
    }

    .change.down {
      color: var(--chart-down);
    }

    .empty {
      padding: 2rem 0.9rem;
      color: var(--text-dim);
      text-align: center;
    }

    .cards .empty {
      font-size: 0.78rem;
    }

    /* Dim until the row is under the cursor, so 25 plus signs do not shout. */
    .add {
      padding: 0 0.32rem;
      border: 1px solid transparent;
      border-radius: 4px;
      background: none;
      color: var(--text-dim);
      font-size: 0.95rem;
      line-height: 1.25;
      cursor: pointer;
    }

    /* No column of its own to sit in, so it floats over the corner the top line leaves free. */
    .cards .add {
      position: absolute;
      top: 0.35rem;
      right: 0.4rem;
    }

    .row:hover .add,
    .add.open {
      border-color: var(--border-control);
      background: var(--bg-raised);
      color: var(--accent);
    }

    .add-popover {
      position: fixed;
      z-index: 20;
      display: grid;
      width: 13rem;
      gap: 0.1rem;
      padding: 0.35rem;
      border: 1px solid var(--border-control);
      border-radius: 6px;
      background: var(--bg-raised);
      box-shadow: 0 6px 20px var(--shadow);
    }

    .add-title {
      margin: 0;
      padding: 0.2rem 0.4rem 0.35rem;
      color: var(--text-dim);
      font-size: 0.68rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .add-option {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.4rem;
      padding: 0.35rem 0.4rem;
      border: 0;
      border-radius: 4px;
      background: none;
      color: var(--text-secondary);
      font-size: 0.78rem;
      text-align: left;
      cursor: pointer;
    }

    .add-option:hover {
      background: var(--accent-soft);
      color: var(--text);
    }

    .add-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .add-mark {
      color: var(--accent);
    }

    .add-option.new {
      margin-top: 0.15rem;
      border-top: 1px solid var(--border);
      border-radius: 0 0 4px 4px;
      color: var(--text-dim);
    }

    .add-empty {
      margin: 0;
      padding: 0.35rem 0.4rem;
      color: var(--text-dim);
      font-size: 0.74rem;
    }

    .add-form {
      display: flex;
      gap: 0.25rem;
      margin-top: 0.15rem;
      padding-top: 0.3rem;
      border-top: 1px solid var(--border);
    }

    .add-form input {
      min-width: 0;
      flex: 1;
      padding: 0.25rem 0.4rem;
      border: 1px solid var(--border-control);
      border-radius: 4px;
      background: var(--bg-panel);
      color: var(--text);
      font-size: 0.76rem;
    }

    .add-form .icon {
      border: 0;
      border-radius: 4px;
      background: none;
      color: var(--accent);
      cursor: pointer;
    }

    /* Sits right under the table and shares its width — a full-bleed bar with a top
       border would read as the page footer instead of as the table's own pager. */
    .pager {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
      gap: 0.8rem;
      width: 100%;
      max-width: var(--table-max-width);
      margin: 0 auto;
      padding: 0.5rem;
    }

    /* Pinned under the scrolling list instead, not carried away by it: with 25 cards in a
       narrow column it would otherwise sit a screen and a half below the last row. */
    :host(.narrow) .pager {
      gap: 0.6rem;
      padding: 0.4rem;
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
  /** A clicked row opens the detail below the table, so it sends the whole row, not the ticker. */
  readonly selected = output<ScreenerSymbol>();
  /** Which ticker the detail is showing, so its row stays marked while the table scrolls. */
  readonly selectedSymbol = input<string | null>(null);

  protected readonly price = formatPrice;
  protected readonly percent = formatPercent;
  protected readonly ratio = formatRatio;
  protected readonly compact = formatCompact;
  protected readonly multiple = formatMultiple;
  protected readonly relVolume = relativeVolume;

  protected readonly columns = COLUMNS;
  /** What the order dropdown offers: everything the backend can actually order by. */
  protected readonly sortable = COLUMNS.filter((column) => !column.derived);
  protected readonly rsLeader = RS_LEADER;
  protected readonly volumeSurge = VOLUME_SURGE;
  protected readonly volumeDry = VOLUME_DRY;
  protected readonly groups = FILTER_GROUPS;
  protected readonly presets = PRESETS;

  /** How the table was left last time, already checked over. Read once, at construction. */
  private readonly restored = storedView();

  protected readonly rows = signal<ScreenerSymbol[]>([]);
  protected readonly exchanges = signal<string[]>([]);
  /** Not stored: a session opens on the whole universe, not on yesterday's search. */
  protected readonly query = signal('');
  protected readonly exchange = signal(this.restored.exchange ?? '');
  /** Which option each dropdown sits on, by id. Absent or 0 means "no filter". */
  protected readonly picks = signal<Record<string, number>>(this.restored.picks ?? {});
  protected readonly panelOpen = signal(localStorage.getItem(PANEL_OPEN_KEY) === 'true');
  /** Always the first page: with the filters restored, the page number they came from is noise. */
  protected readonly page = signal(0);
  protected readonly total = signal(0);
  protected readonly sort = signal<SortField>(this.restored.sort ?? 'symbol');
  protected readonly descending = signal(this.restored.descending ?? false);
  protected readonly loading = signal(false);
  /** A quote sweep is running on the backend, whoever started it. */
  protected readonly refreshing = signal(false);
  protected readonly loadingUniverse = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  /** The row whose watchlist menu is open, and where to draw it over the table. */
  protected readonly addTarget = signal<{ row: ScreenerSymbol; top: number; right: number } | null>(
    null,
  );
  protected readonly lists = signal<Watchlist[]>([]);
  protected readonly listsLoading = signal(false);
  /** Whether the menu is showing its "new list" box instead of the link. */
  protected readonly newList = signal(false);

  /**
   * Whether a row is open in the chart beside it, which is what decides the shape: a quarter
   * of the screen holds cards, the whole of it holds the table it has always been.
   */
  protected readonly narrow = computed(() => this.selectedSymbol() !== null);

  /** What the backend is being asked for right now. */
  protected readonly filters = computed(() =>
    filtersFrom(this.query(), this.exchange(), this.picks()),
  );

  /** How many dropdowns are off their "no filter" entry. Shown on the Filtros button. */
  protected readonly activeCount = computed(
    () => Object.values(this.picks()).filter((index) => index > 0).length,
  );

  /** Which preset the dropdowns are sitting on, if any: what lights its button up. */
  protected readonly activePreset = computed(() => {
    const current = this.picks();
    const set = Object.entries(current).filter(([, index]) => index > 0);
    const match = PRESETS.find((preset) => {
      const wanted = Object.entries(picksOf(preset));
      return wanted.length === set.length && wanted.every(([id, index]) => current[id] === index);
    });
    return match?.name ?? null;
  });

  /** Whether anything is narrowing the table, which is what the Limpiar button needs. */
  protected readonly filtered = computed(
    () => Boolean(this.query() || this.exchange()) || this.activeCount() > 0,
  );

  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  protected readonly rangeFrom = computed(() => this.page() * PAGE_SIZE + 1);
  protected readonly rangeTo = computed(() => Math.min(this.total(), (this.page() + 1) * PAGE_SIZE));

  private readonly service = inject(ScreenerService);
  private readonly watchlists = inject(WatchlistService);
  /** Discards responses that arrive after the filter already moved on. */
  private requestId = 0;
  private typingTimer?: ReturnType<typeof setTimeout>;
  private pollTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // Only the dropdowns actually narrowing something are written, so a filter added later
    // starts on "no filter" instead of on an index saved before it existed.
    effect(() => {
      const picks = Object.entries(this.picks()).filter(([, index]) => index > 0);
      const view: StoredView = {
        picks: Object.fromEntries(picks),
        exchange: this.exchange(),
        sort: this.sort(),
        descending: this.descending(),
      };
      localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    });
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

  /**
   * The menu hangs under its button in viewport coordinates, so the scrolling table cannot
   * clip it; near the bottom edge it slides up instead of falling off the screen.
   */
  protected toggleAdd(row: ScreenerSymbol, event: MouseEvent): void {
    event.stopPropagation();
    if (this.addTarget()?.row.symbol === row.symbol) {
      this.closeAdd();
      return;
    }
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.addTarget.set({
      row,
      top: Math.max(8, Math.min(box.bottom + 4, window.innerHeight - MENU_HEIGHT)),
      right: Math.max(8, window.innerWidth - box.right),
    });
    this.newList.set(false);
    void this.loadLists();
  }

  protected closeAdd(): void {
    this.addTarget.set(null);
    this.newList.set(false);
  }

  /** Whether the ticker is already saved, so a second click is not a silent no-op. */
  protected holds(list: Watchlist, symbol: string): boolean {
    return list.entries.some((entry) => entry.symbol === symbol);
  }

  protected async addTo(list: Watchlist, row: ScreenerSymbol): Promise<void> {
    this.closeAdd();
    await this.saving(() => this.watchlists.addEntry(list.id, row.symbol, row.name), row);
  }

  protected async createAndAdd(name: string, row: ScreenerSymbol): Promise<void> {
    const clean = name.trim();
    if (!clean) {
      return;
    }
    this.closeAdd();
    await this.saving(async () => {
      const created = await this.watchlists.create(clean);
      return this.watchlists.addEntry(created.id, row.symbol, row.name);
    }, row);
  }

  /** Menus open rarely and lists are few, so it always asks: one may have been made elsewhere. */
  private async loadLists(): Promise<void> {
    this.listsLoading.set(true);
    try {
      this.lists.set(await this.watchlists.list());
    } catch (failure) {
      this.closeAdd();
      this.error.set(this.messageOf(failure));
    } finally {
      this.listsLoading.set(false);
    }
  }

  /** Every write answers with the whole list, so the ✓ marks stay true without asking again. */
  private async saving(write: () => Promise<Watchlist>, row: ScreenerSymbol): Promise<void> {
    this.error.set(null);
    try {
      const saved = await write();
      this.lists.update((all) =>
        all.some((one) => one.id === saved.id)
          ? all.map((one) => (one.id === saved.id ? saved : one))
          : [...all, saved],
      );
      this.notice.set(`${row.symbol} está en «${saved.name}».`);
    } catch (failure) {
      this.error.set(this.messageOf(failure));
    }
  }

  protected selectsOf(group: FilterGroup) {
    return RANGE_SELECTS.filter((select) => select.group === group);
  }

  protected pick(id: string, index: number): void {
    this.picks.update((picks) => ({ ...picks, [id]: index }));
    this.go(0);
  }

  /**
   * A preset replaces every dropdown instead of adding to what was there. Half of one screen
   * left on top of another is the combination that returns nothing, and the dropdown it came
   * from is off-screen by then, so there is no way to see why.
   */
  protected applyPreset(preset: Preset): void {
    this.picks.set(picksOf(preset));
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
  protected sortBy(column: Column): void {
    if (column.derived) {
      return;
    }
    const field = column.field as SortField;
    if (this.sort() === field) {
      this.descending.update((down) => !down);
    } else {
      this.sort.set(field);
      this.descending.set(column.numeric);
    }
    this.go(0);
  }

  /**
   * The same rule from the dropdown the narrow list carries instead of a header row: a new
   * field starts the way its column is usually read, and the arrow beside it turns it around.
   */
  protected onSort(field: string): void {
    const column = this.sortable.find((candidate) => candidate.field === field);
    if (!column) {
      return;
    }
    this.sort.set(column.field as SortField);
    this.descending.set(column.numeric);
    this.go(0);
  }

  protected flipSort(): void {
    this.descending.update((down) => !down);
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
