import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CandleSeries } from '../market/market.models';
import { MarketService } from '../market/market.service';
import { ThemeService } from '../theme/theme.service';
import { Watchlist } from '../watchlist/watchlist.models';
import { WatchlistService } from '../watchlist/watchlist.service';
import { BasketRun, runBasket } from './basket';
import { runBacktest } from './backtest';
import {
  COMBINE_MODES,
  CombineMode,
  DEFAULT_STRATEGY_PARAMS,
  STOP_LOSS,
  STRATEGIES,
  STRATEGY_PARAMS,
  Strategy,
  StrategyParam,
  StrategyParams,
  TAKE_PROFIT,
  TRADE_COST,
  VOLUME_FILTER,
  chartSetup,
  paramLines,
  paramSuffix,
  swatchOf,
} from './strategy.models';

/** Which strategies were last ticked. UI state, so it stays in the browser. */
const STRATEGIES_KEY = 'tickerlab.strategies';

/** The one before them, from when the screen ran a single strategy. Read once, then replaced. */
const LEGACY_STRATEGY_KEY = 'tickerlab.strategy';

/** How they are combined. Its own key: it survives changing which ones are ticked. */
const MODE_KEY = 'tickerlab.strategyMode';

/** Their numbers. Same rule as the indicator ones: only what was moved off the default. */
const PARAMS_KEY = 'tickerlab.strategyParams';

/**
 * The ticked strategies, in catalogue order however they were stored — the order is what the
 * chart resolves its slots by, and it should not depend on which box was clicked first.
 *
 * A session saved before this screen could combine holds a single id under the old key: it is
 * read as a list of one, so the strategy that was last looked at is still the one that opens.
 * An empty list saved on purpose («Ninguna») stays empty, and so does a first visit: the panel
 * now sits on the chart screen, where signals nobody ticked would be drawn over every chart.
 * Anything else unrecognised falls back to the first of the catalogue, not to nothing.
 */
function storedStrategies(): ReadonlyArray<Strategy> {
  const legacy = localStorage.getItem(LEGACY_STRATEGY_KEY);
  const saved: unknown[] = read(STRATEGIES_KEY) ?? (legacy === null ? [] : [legacy]);
  if (!saved.length) {
    return [];
  }
  const ids = new Set(saved.filter((id): id is string => typeof id === 'string'));
  const ticked = STRATEGIES.filter(({ id }) => ids.has(id));
  return ticked.length ? ticked : [STRATEGIES[0]];
}

function storedMode(): CombineMode {
  return localStorage.getItem(MODE_KEY) === 'ANY' ? 'ANY' : 'ALL';
}

function read(key: string): unknown[] | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as unknown;
    return Array.isArray(saved) ? saved : null;
  } catch {
    return null;
  }
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
  template: `
    <!-- The same rail the chart screen gives the indicators, and for the same reason: what
         gets ticked and tuned is a list you keep coming back to, and a list reads down a side
         instead of along a bar. Everything that configures the run lives here now — a second
         strip up top holding the two globals would be a bar with nothing in it. -->
    <aside class="strategies" aria-label="Estrategias">
      <div class="strategies-head">
        <span class="strategies-title">Estrategias</span>
      </div>

      <!-- The numbers sit under the strategy they belong to and only while it is ticked. That
           is what pays for dropping the group name: «Rápida» says nothing on its own, and it
           needs no label when the only thing above it is the strategy it belongs to. -->
      <div class="strategy-row">
        <button
          type="button"
          class="strategy"
          [class.active]="!ticked().length"
          [attr.aria-pressed]="!ticked().length"
          title="Solo el gráfico, sin reglas ni backtest"
          (click)="clearTicked()"
        >
          <span class="strategy-name">Ninguna</span>
        </button>
      </div>

      @for (option of strategies; track option.id) {
        <div class="strategy-row">
          <button
            type="button"
            class="strategy"
            [class.active]="isTicked(option)"
            [attr.aria-pressed]="isTicked(option)"
            [title]="option.summary"
            (click)="toggle(option)"
          >
            <span class="strategy-name">{{ option.name }}</span>
            <span class="strategy-periods">{{ suffix(option) }}</span>
          </button>

          @if (isTicked(option)) {
            <div class="group">
              @for (line of lines(option); track $index) {
                <div class="param-line">
                  @for (param of line; track param.key) {
                    <!-- Two named alternatives are a pair of buttons and not a box with a 0 or
                         a 1 in it: the number is an index and nobody thinks in indexes. It
                         keeps the box's frame so the line still reads as one row of settings. -->
                    @if (param.choices; as choices) {
                      <div class="param">
                        <span class="param-name">{{ param.label }}</span>
                        <div class="choice" role="group" [attr.aria-label]="param.label">
                          @for (choice of choices; track choice; let i = $index) {
                            <button
                              type="button"
                              class="choice-option"
                              [class.active]="params()[param.key] === i"
                              [attr.aria-pressed]="params()[param.key] === i"
                              (click)="setParam(param, i + '')"
                            >
                              {{ choice }}
                            </button>
                          }
                        </div>
                      </div>
                    } @else {
                      <label class="param">
                        <!-- The dot says which line on the chart this number moves. Two
                             averages a few bars apart are two labels that read the same;
                             the colour is what tells them apart at a glance. -->
                        <span class="param-name">
                          @if (swatchColor(param); as colour) {
                            <i class="param-swatch" [style.background]="colour"></i>
                          }
                          {{ param.label }}
                        </span>
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
                  }
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- Only worth a control once there is something to combine: with one strategy ticked,
           «todas» and «cualquiera» are the same sentence about the same rule. -->
      @if (ticked().length > 1) {
        <div class="mode" role="group" aria-label="Cómo se combinan">
          @for (option of modes; track option.value) {
            <button
              type="button"
              class="mode-option"
              [class.active]="mode() === option.value"
              [attr.aria-pressed]="mode() === option.value"
              [title]="option.hint"
              (click)="setMode(option.value)"
            >
              {{ option.label }}
            </button>
          }
        </div>
      }

      <!-- Below a rule of their own, and outside the list on purpose: the three are laid over
           whatever the ticked strategies decided — two closing a trade they wanted open, one
           refusing to open a trade they wanted taken — so none belongs to any single row. -->
      <div class="globals">
        <label class="param">
          <span class="param-name">{{ objective.label }}</span>
          <input
            #target
            type="number"
            [min]="objective.min"
            [max]="objective.max"
            [value]="params()[objective.key]"
            (change)="target.value = setParam(objective, target.value)"
          />
        </label>

        <label class="param">
          <span class="param-name">{{ stop.label }}</span>
          <input
            #floor
            type="number"
            [min]="stop.min"
            [max]="stop.max"
            [value]="params()[stop.key]"
            (change)="floor.value = setParam(stop, floor.value)"
          />
        </label>

        <label class="param">
          <span class="param-name">{{ volumeGate.label }}</span>
          <input
            #gate
            type="number"
            [min]="volumeGate.min"
            [max]="volumeGate.max"
            [value]="params()[volumeGate.key]"
            (change)="gate.value = setParam(volumeGate, gate.value)"
          />
        </label>

        <label class="param">
          <span class="param-name">{{ cost.label }}</span>
          <input
            #fee
            type="number"
            [min]="cost.min"
            [max]="cost.max"
            [value]="params()[cost.key]"
            (change)="fee.value = setParam(cost, fee.value)"
          />
        </label>
      </div>

      <!-- The same configuration over a whole list. One ticker cannot tell a strategy from a
           coincidence: with five rules and three periods each, something always looks brilliant
           on some chart, and the only answer to that is running it over thirty of them. -->
      <div class="basket-control">
        <span class="basket-label">Cesta</span>
        <select
          #list
          class="basket-list"
          [disabled]="!lists().length || progress() !== null"
          (change)="listId.set(list.value)"
        >
          @for (option of lists(); track option.id) {
            <option [value]="option.id" [selected]="option.id === listId()">
              {{ option.name }} · {{ option.entries.length }}
            </option>
          } @empty {
            <option value="">sin listas</option>
          }
        </select>
        <button
          type="button"
          class="basket-run"
          [disabled]="!canRunBasket()"
          [title]="basketHint()"
          (click)="testBasket()"
        >
          @if (progress(); as run) {
            {{ run.done }}/{{ run.total }}
          } @else {
            Probar cesta
          }
        </button>

        <!-- The basket named one line up, spelled out. The median answers «do these rules work
             at all»; this is what you reach for straight afterwards, because the next question
             is always which of the fifty it worked on — and that is one chart, not a median. -->
        @if (selectedList(); as list) {
          <ul class="basket-symbols" aria-label="Símbolos de la cesta">
            @for (entry of list.entries; track entry.symbol) {
              <li>
                <button
                  type="button"
                  class="basket-symbol"
                  [class.current]="entry.symbol === series()?.symbol"
                  [attr.aria-current]="entry.symbol === series()?.symbol ? 'true' : null"
                  [title]="entry.name ?? entry.symbol"
                  (click)="symbolPicked.emit(entry.symbol)"
                >
                  {{ entry.symbol }}
                </button>
              </li>
            }
          </ul>
        }
      </div>

      <!-- The rules and what the simulation leaves out, at the foot of the controls that wrote
           them: a backtest that does not say what it charged is a number nobody can compare
           with anything. -->
      @if (ticked().length) {
        <p class="rules">
          <span class="rule"><span class="dot buy"></span>Dentro cuando {{ entryLine() }}</span>
          <span class="rule"><span class="dot sell"></span>{{ exitLine() }}</span>
          <span class="caveat">Al cierre, todo dentro y todo fuera · {{ costLine() }}</span>
        </p>
      }
    </aside>
  `,
  styles: `
    /* The rail the shell docks on the left (or slides up on a phone): the aside is the grid
       child, so the host gets out of the way, the same as the indicator legend. */
    :host {
      display: contents;
    }

    /* Full height down the left, the same furniture the indicator rail wears so the two
       screens read as one app: same panel background, same divider, same scroll. */
    .strategies {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      padding: 0.6rem 0.7rem;
      overflow-y: auto;
      background: var(--bg-panel);
      border-right: 1px solid var(--border);
      color: var(--text-dim);
      font-size: 0.72rem;
    }

    .strategies-head {
      color: var(--text-label);
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .strategy-row {
      display: flex;
      flex-direction: column;
    }

    .strategy {
      display: flex;
      align-items: baseline;
      gap: 0.35rem;
      width: 100%;
      padding: 0.3rem 0.45rem;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: var(--text-secondary);
      font: inherit;
      font-size: 0.8rem;
      text-align: left;
      cursor: pointer;
    }

    /* Wraps rather than truncates: the name is the only thing that says what the row does,
       and «Heikin Ashi suav…» is a worse row than a two-line one. */
    .strategy-name {
      flex: 1;
      min-width: 0;
    }

    .strategy:hover {
      color: var(--text);
    }

    .strategy.active {
      background: var(--accent);
      color: var(--on-accent);
    }

    .strategy-periods {
      flex: none;
      font-size: 0.72rem;
      opacity: 0.75;
      font-variant-numeric: tabular-nums;
    }

    /* A shell of its own under the list, so «Y | O» reads as a control over the strategies
       above it instead of a word left loose between two of them. */
    .mode {
      display: flex;
      gap: 0.25rem;
      padding: 0.2rem;
      background: var(--bg-raised);
      border: 1px solid var(--border);
      border-radius: 6px;
    }

    .mode-option {
      flex: 1;
      min-width: 1.9rem;
      padding: 0.3rem 0.4rem;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: var(--text-secondary);
      font: inherit;
      font-size: 0.85rem;
      cursor: pointer;
    }

    .mode-option:hover {
      color: var(--text);
    }

    .mode-option.active {
      background: var(--accent);
      color: var(--on-accent);
    }

    /* Indented under the strategy that owns them and never wrapping: the numbers of one
       strategy are read across as one setting, and a box that drops to a line of its own reads
       as belonging to the row below. They share the width instead. */
    /* Wraps because a strategy is free to ask for six numbers: crushed to a third of an input
       each they stop being editable, and a second line costs nothing while the row is open. */
    .group {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      padding: 0.3rem 0.45rem 0.45rem 0.55rem;
    }

    /* One line of a strategy's numbers, and the reason the group stacks instead of wrapping:
       the boxes share the width they are given, so seven of them on one line are seven boxes
       too narrow to read rather than two comfortable lines. Where it breaks comes from the
       strategy; the panel only draws as many lines as it is handed. */
    .param-line {
      display: flex;
      gap: 0.35rem;
    }

    /* The rule above them is what says these two are not one more strategy. */
    .globals,
    .basket-control,
    .rules {
      padding-top: 0.55rem;
      border-top: 1px solid var(--border);
    }

    /* Its own air instead of a rule of its own: the frame around the button is already a
       block, and a line above it would fence off a single control. */
    .globals {
      display: flex;
      gap: 0.35rem;
    }

    .basket-control {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }

    /* The field is named outside the select: an option on its own says «Crecimiento US» and
       not what that list is about to be used for. */
    .basket-label {
      flex: 1 0 100%;
      color: var(--text-label);
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .basket-list {
      flex: 1 0 100%;
      min-width: 0;
      padding: 0.2rem 0.4rem;
      border: 1px solid var(--border-control);
      border-radius: 4px;
      background: var(--bg-app);
      color: var(--text-input);
      font: inherit;
      font-size: 0.8rem;
    }

    .basket-run {
      flex: 1 0 100%;
      min-width: 0;
      padding: 0.25rem 0.6rem;
      border: 1px solid var(--border-control);
      border-radius: 4px;
      background: var(--bg-raised);
      color: var(--text-secondary);
      font: inherit;
      font-size: 0.8rem;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
    }

    .basket-run:hover:not(:disabled) {
      color: var(--text);
      border-color: var(--border-focus);
    }

    .basket-run:disabled {
      opacity: 0.55;
      cursor: default;
    }

    /* Capped and scrolled rather than as long as the list: fifty tickers would push the rules
       under the fold, and the rules are what the whole column exists to set. */
    .basket-symbols {
      flex: 1 0 100%;
      display: flex;
      flex-wrap: wrap;
      gap: 0.2rem;
      max-height: 5.5rem;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }

    .basket-symbol {
      padding: 0.1rem 0.3rem;
      border: 1px solid transparent;
      border-radius: 3px;
      background: var(--bg-raised);
      color: var(--text-secondary);
      font: inherit;
      font-size: 0.72rem;
      cursor: pointer;
    }

    .basket-symbol:hover {
      color: var(--text);
      border-color: var(--border-focus);
    }

    /* The one the chart above is drawing. Marked and not disabled: it is still a button, and
       clicking it again is the harmless thing it looks like. */
    .basket-symbol.current {
      border-color: var(--accent);
      color: var(--accent);
    }

    /* Name over box rather than beside it. Beside it, «Rápida 10» is a third of the rail
       and the third number of a strategy already has nowhere to go; stacked, four of them
       still share one line. */
    .param {
      display: flex;
      flex: 1;
      min-width: 0;
      flex-direction: column;
      gap: 0.15rem;
      color: var(--text-label);
      font-size: 0.62rem;
    }

    /* Clipped rather than wrapped: a two-line name would push its box out of the row. */
    .param-name {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    /* Inline with the name instead of over the box: the rail is narrow and the dot has to
       cost the label a few pixels, not a line of its own. */
    .param-swatch {
      display: inline-block;
      width: 0.4rem;
      height: 0.4rem;
      margin-right: 0.15rem;
      border-radius: 50%;
      vertical-align: middle;
    }

    .param input {
      width: 100%;
      min-width: 0;
      padding: 0.2rem 0.3rem;
      border: 1px solid var(--border-control);
      border-radius: 4px;
      background: var(--bg-app);
      color: var(--text-input);
      font: inherit;
      font-size: 0.7rem;
      text-align: center;
      /* The steppers eat a third of a box this narrow, and the number is typed, not clicked. */
      appearance: textfield;
    }

    .param input::-webkit-inner-spin-button,
    .param input::-webkit-outer-spin-button {
      appearance: none;
      margin: 0;
    }

    .param input:focus {
      border-color: var(--border-focus);
      outline: none;
    }

    /* The frame of the box it stands in for, split in two. Same height and same border, so a
       line mixing a number and a choice still reads as one row rather than two controls that
       happen to be next to each other. */
    .choice {
      display: flex;
      gap: 0.1rem;
      padding: 0.1rem;
      border: 1px solid var(--border-control);
      border-radius: 4px;
      background: var(--bg-app);
    }

    .choice-option {
      flex: 1;
      min-width: 0;
      padding: 0.1rem 0.2rem;
      border: 0;
      border-radius: 3px;
      background: transparent;
      color: var(--text-secondary);
      font: inherit;
      font-size: 0.7rem;
      cursor: pointer;
    }

    .choice-option:hover {
      color: var(--text);
    }

    .choice-option.active {
      background: var(--accent);
      color: var(--on-accent);
    }

    /* Pushed to the foot of the rail while there is room for it: it describes everything
       above, so it belongs after all of it rather than floating halfway up an empty column. */
    .rules {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      margin: auto 0 0;
      color: var(--text-secondary);
      font-size: 0.72rem;
    }

    .rule {
      display: flex;
      align-items: flex-start;
      gap: 0.35rem;
    }

    /* The same two colours the arrows on the chart are drawn in, so the sentence and the
       marker it describes are read as one thing. */
    .dot {
      width: 0.5rem;
      height: 0.5rem;
      margin-top: 0.3rem;
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
      font-size: 0.68rem;
    }

    /* ---- Phones: the host is the sheet the shell slides up, so the rail is what scrolls in it ---- */

    @media (max-width: 767px) {
      :host(.pane) {
        display: flex;
        flex-direction: column;
      }

      :host(.pane) .strategies {
        flex: 1;
        min-height: 0;
        overflow-x: hidden;
        /* The sheet keeps the gesture: a drag that finds no more list to move must not carry on
           into the page under it. */
        overscroll-behavior: contain;
        touch-action: pan-y;
        border-right: 0;
      }
    }
  `,
})
export class StrategiesPanelComponent {
  /** The candles the strategy is tested on. The screen above owns the ticker and the timeframe. */
  readonly series = input<CandleSeries | null>(null);
  /**
   * A list handed over from the screener rather than saved: it rides in shaped like a watchlist
   * so everything below it — the dropdown, the run, the hint — cannot tell the two apart. It is
   * not persisted on purpose; a screen is a question you asked once, and saving every one of
   * them would leave the watchlist panel full of lists nobody named.
   */
  readonly sentList = input<Watchlist | null>(null);

  /**
   * A ticker picked out of the basket. The shell owns the symbol — the chart screen and the
   * watchlist on the right read the same one — so this leaves rather than being loaded here:
   * two components loading candles for the same app is two answers to «which ticker is up».
   */
  readonly symbolPicked = output<string>();

  protected readonly strategies = STRATEGIES;
  protected readonly modes = COMBINE_MODES;
  protected readonly objective = TAKE_PROFIT;
  protected readonly stop = STOP_LOSS;
  protected readonly volumeGate = VOLUME_FILTER;
  protected readonly cost = TRADE_COST;

  protected readonly ticked = signal<ReadonlyArray<Strategy>>(storedStrategies());
  protected readonly mode = signal<CombineMode>(storedMode());
  protected readonly params = signal<StrategyParams>(storedParams());
  /**
   * What the run charged, spelled out under the controls. Zero keeps the old wording rather
   * than printing «0 pb»: the point of the line is that the number is never a surprise.
   */
  protected readonly costLine = computed(() => {
    const charged = this.params().tradeCost;
    return charged > 0 ? `${charged} pb por operación` : 'sin comisiones';
  });

  private readonly theme = inject(ThemeService);
  private readonly market = inject(MarketService);
  private readonly watchlists = inject(WatchlistService);

  /** The saved lists, read once when the screen opens. The panel docked to the right owns editing them. */
  private readonly saved = signal<Watchlist[]>([]);

  /** What the dropdown offers: the sent list first, because it is why you came to this screen. */
  protected readonly lists = computed(() => {
    const sent = this.sentList();
    return sent ? [sent, ...this.saved()] : this.saved();
  });

  protected readonly listId = signal<string | null>(null);
  protected readonly basket = signal<BasketRun | null>(null);
  /** How far the loading got, and null when nothing is running. */
  protected readonly progress = signal<{ done: number; total: number } | null>(null);

  protected readonly selectedList = computed(() =>
    this.lists().find(({ id }) => id === this.listId()),
  );

  /**
   * A run is only shown against the candles it was measured on: the same rules over weekly bars
   * are a different test, and a median from the daily one sitting under a weekly chart is the
   * kind of wrong number that never announces itself. Coming back to the timeframe brings it
   * back rather than making it be run again.
   */
  readonly visibleBasket = computed(() => {
    const run = this.basket();
    return run && run.timeframe === this.series()?.timeframe ? run : null;
  });

  protected readonly canRunBasket = computed(
    () =>
      this.progress() === null &&
      !!this.ticked().length &&
      !!this.series() &&
      !!this.selectedList()?.entries.length,
  );

  /**
   * The whole screen, recomputed from the candles, the ticked rules and their numbers. It is a
   * few passes over an array the browser already has, so there is nothing to debounce and
   * nothing to ask the backend: ticking a strategy repaints on the same frame it is clicked.
   */
  readonly backtest = computed(() =>
    runBacktest(this.ticked(), this.mode(), this.series()?.candles ?? [], this.params()),
  );

  /**
   * The lines the ticked strategies need on the chart. Both halves come out of the same pass so
   * the slots and the indicators using them can never disagree.
   */
  private readonly chart = computed(() => chartSetup(this.ticked(), this.params()));
  /** What the shell draws over its own chart: the entries and exits of the run. */
  readonly markers = computed(() => this.backtest().markers);
  /**
   * The indicators the ticked rules read, for the shell to add to the ones switched on by hand.
   * Empty with nothing ticked, which is what keeps a plain chart plain.
   */
  readonly overlayIndicators = computed(() => this.chart().indicators);
  /** Their periods: where an indicator is in both, these win, because the signals were cut with them. */
  readonly overlayPeriods = computed(() => this.chart().periods);
  readonly hasRules = computed(() => this.ticked().length > 0);

  constructor() {
    // The single-strategy key has already been read into the list; leaving it behind would
    // have a later version restoring a choice that was superseded two sessions ago.
    localStorage.removeItem(LEGACY_STRATEGY_KEY);

    effect(() =>
      localStorage.setItem(STRATEGIES_KEY, JSON.stringify(this.ticked().map(({ id }) => id))),
    );
    effect(() => localStorage.setItem(MODE_KEY, this.mode()));

    void this.watchlists.list().then((lists) => {
      this.saved.set(lists);
      // Only when nothing is chosen yet: a list sent from the screener can land before this
      // answers, and the first watchlist quietly taking the dropdown back would run the rules
      // over symbols nobody asked about.
      if (!this.listId()) {
        this.listId.set(lists[0]?.id ?? null);
      }
    });

    // A new list from the screener takes the dropdown, dropping whatever run was on screen: it
    // was measured on the previous list, and leaving it under the new name is a median of the
    // wrong symbols. Selecting it is as far as it goes — the run itself is still a button press.
    effect(() => {
      const sent = this.sentList();
      if (sent) {
        this.listId.set(sent.id);
        this.basket.set(null);
      }
    });

    effect(() => {
      const moved = Object.entries(this.params()).filter(
        ([key, value]) => value !== DEFAULT_STRATEGY_PARAMS[key as keyof StrategyParams],
      );
      localStorage.setItem(PARAMS_KEY, JSON.stringify(Object.fromEntries(moved)));
    });
  }

  protected isTicked(strategy: Strategy): boolean {
    return this.ticked().some(({ id }) => id === strategy.id);
  }

  /**
   * Ticking keeps the catalogue order rather than the clicking order: it is the order the
   * chart hands out its slots by, and which box was pressed first is not a preference anyone
   * expressed. Unticking the last one leaves none, same as «Ninguna»: the tester says so in a
   * line instead of showing zeroes with no rule behind them.
   */
  protected toggle(strategy: Strategy): void {
    this.ticked.update((current) => {
      const ids = new Set(current.map(({ id }) => id));
      if (ids.has(strategy.id)) {
        return current.filter(({ id }) => id !== strategy.id);
      }
      ids.add(strategy.id);
      return STRATEGIES.filter(({ id }) => ids.has(id));
    });
    this.basket.set(null);
  }

  /** Back to the numbers of the ticked rules: the drawer calls it from its «Volver» button. */
  closeBasket(): void {
    this.basket.set(null);
  }

  protected clearTicked(): void {
    this.ticked.set([]);
    this.basket.set(null);
  }

  protected setMode(mode: CombineMode): void {
    this.mode.set(mode);
    this.basket.set(null);
  }

  /**
   * Runs the ticked rules over every symbol of the chosen list. Dropped rather than recomputed
   * when the rules move: fifty histories per keystroke is not a thing to do on a number box,
   * and a median left on screen under rules it was not measured with is worse than no median.
   */
  protected async testBasket(): Promise<void> {
    const list = this.selectedList();
    const series = this.series();
    if (!list || !series || this.progress() !== null) {
      return;
    }

    this.basket.set(null);
    this.progress.set({ done: 0, total: list.entries.length });
    try {
      const run = await runBasket(
        this.market,
        list.name,
        list.entries,
        series.timeframe,
        this.ticked(),
        this.mode(),
        this.params(),
        (done, total) => this.progress.set({ done, total }),
      );
      this.basket.set(run);
    } finally {
      this.progress.set(null);
    }
  }

  /** Why the button is off, on the button itself: a disabled control that says nothing is a bug. */
  protected basketHint(): string {
    if (!this.ticked().length) {
      return 'Marca una estrategia para probarla sobre la cesta';
    }
    if (!this.series()) {
      return 'Busca un ticker para fijar la temporalidad de la prueba';
    }
    if (!this.lists().length) {
      return 'Crea una lista para probar la estrategia sobre varios símbolos';
    }
    return this.selectedList()?.entries.length
      ? `Prueba estas reglas sobre ${this.selectedList()?.entries.length} símbolos`
      : 'La lista está vacía';
  }

  /**
   * The ticked rules as one sentence, joined by whatever the combination is set to. The volume
   * filter is named at the end rather than folded into the join: it is not one of the ticked
   * rules and an « y » would put it up for the combination to vote on, which it never is —
   * with the mode on O it still has to be met.
   */
  protected entryLine(): string {
    const rules = this.ticked()
      .map(({ hold }) => hold)
      .join(this.mode() === 'ALL' ? ' y ' : ' o ');
    const gate = this.params().volumeFilter;
    return gate > 0 ? `${rules}, y solo si el volumen llega al ${gate} % de su media` : rules;
  }

  /**
   * The other half of it. The objective and the stop are named here and not among the rules:
   * either one closes a trade the rules still wanted open, and a screen that only ever hits a
   * level would otherwise show an exit rule that never once fired.
   */
  protected exitLine(): string {
    const { takeProfit, stopLoss } = this.params();
    const base = 'Fuera en cuanto deje de cumplirse';
    const levels: string[] = [];
    if (takeProfit > 0) {
      levels.push(`al ganar ${takeProfit} %`);
    }
    if (stopLoss > 0) {
      levels.push(`al perder ${stopLoss} %`);
    }
    return levels.length ? `${base}, o ${levels.join(', o ')}` : base;
  }

  /**
   * The colour of the line a number moves, straight off the chart's palette so the dot and the
   * line can never drift apart — including the one that changes with the average picked.
   */
  protected swatchColor(param: StrategyParam): string | null {
    const key = swatchOf(param, this.params());
    return key === null ? null : this.theme.chart()[key];
  }

  protected suffix(strategy: Strategy): string {
    return paramSuffix(strategy, this.params());
  }

  /** The strategy's numbers, split into the lines it asked to be drawn on. */
  protected lines(strategy: Strategy): ReadonlyArray<ReadonlyArray<StrategyParam>> {
    return paramLines(strategy);
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
    this.basket.set(null);
    return `${value}`;
  }
}
