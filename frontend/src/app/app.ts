import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from './auth/auth.service';
import { LoginComponent } from './auth/login.component';
import { MarketService } from './market/market.service';
import {
  CHART_TYPES,
  CandleSeries,
  ChartType,
  DEFAULT_PERIODS,
  INDICATORS,
  Indicator,
  IndicatorPeriods,
  PeriodKey,
  PeriodParam,
  TIMEFRAMES,
  Timeframe,
} from './market/market.models';
import { RS_BENCHMARK } from './market/indicators/relative-strength';
import { ViewportService } from './layout/viewport.service';
import { IndicatorLegendComponent, PeriodChange } from './market/indicator-legend.component';
import { PriceChartComponent } from './market/price-chart.component';
import { TickerSearchComponent } from './market/ticker-search.component';
import { ScreenerPanelComponent } from './screener/screener-panel.component';
import {
  ScreenerSymbol,
  formatCompact,
  formatPercent,
  formatPrice,
  formatRatio,
} from './screener/screener.models';
import { ThemePickerComponent } from './theme/theme-picker.component';
import { WatchlistPanelComponent } from './watchlist/watchlist-panel.component';

/** The two screens the app has. */
type View = 'chart' | 'screener';

/**
 * On a phone the two side panels have nowhere to dock, so they slide up over the chart one at
 * a time. `null` is the ordinary state: the chart alone, which is what the screen is for.
 */
type Sheet = 'indicators' | 'watchlist' | null;

/** Something recognisable has to be on screen before the user types anything. */
const DEFAULT_SYMBOL = 'AAPL';

/** Whether the indicator descriptions were left open. UI state, so it stays in the browser. */
const SHOW_HINTS_KEY = 'tickerlab.showIndicatorHints';

/** How the price is drawn. UI state, so it stays in the browser. */
const CHART_TYPE_KEY = 'tickerlab.chartType';

/** Unlike the periods there is nothing to merge here: it is one value, valid or not. */
function storedChartType(): ChartType {
  const saved = localStorage.getItem(CHART_TYPE_KEY);
  return CHART_TYPES.find(({ value }) => value === saved)?.value ?? 'CANDLES';
}

/** Which row the screener detail was left on. UI state, so it stays in the browser. */
const SELECTED_ROW_KEY = 'tickerlab.screenerRow';

/**
 * The whole row goes in, not the ticker: every number the detail shows rode in with a page a
 * new session has not asked for yet, and there is no endpoint for one symbol on its own. Only
 * the identity is checked on the way back — the rest is nullable by definition, and the table
 * overwrites it the moment its first page comes back with the ticker still in it.
 */
function storedRow(): ScreenerSymbol | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SELECTED_ROW_KEY) ?? 'null');
    const row = saved as ScreenerSymbol | null;
    return row && typeof row.symbol === 'string' && typeof row.name === 'string' ? row : null;
  } catch {
    return null;
  }
}

/** Which indicators were switched off. UI state, so it stays in the browser. */
const HIDDEN_INDICATORS_KEY = 'tickerlab.hiddenIndicators';

/**
 * What is stored is the switched-off ones, not the visible ones: that way an indicator
 * added in a later version shows up on its own instead of being absent from every list
 * saved before it existed. Unparseable storage falls back to showing everything.
 */
function storedIndicators(): ReadonlySet<Indicator> {
  const known = INDICATORS.map(({ value }) => value);
  try {
    const hidden: unknown = JSON.parse(localStorage.getItem(HIDDEN_INDICATORS_KEY) ?? '[]');
    return new Set(known.filter((value) => !(hidden as Indicator[]).includes(value)));
  } catch {
    return new Set(known);
  }
}

/** Which periods were moved off the textbook value. UI state, so it stays in the browser. */
const PERIODS_KEY = 'tickerlab.indicatorPeriods';

/** Every editable param by key, so a stored number can be checked against its own bounds. */
const PERIOD_PARAMS = new Map<string, PeriodParam>(
  INDICATORS.flatMap(({ params }) => params.map((param) => [param.key as string, param])),
);

/**
 * Same rule as the hidden indicators: what is stored is only what was moved off its default,
 * so a param added in a later version starts on its textbook value instead of being missing
 * from every map saved before it existed. Stored numbers are clamped again on the way in —
 * the bounds may have tightened since, and a value outside them blanks the indicator out.
 */
function storedPeriods(): IndicatorPeriods {
  try {
    const saved = JSON.parse(localStorage.getItem(PERIODS_KEY) ?? '{}') as Record<string, unknown>;
    const moved = Object.entries(saved).flatMap(([key, value]) => {
      const param = PERIOD_PARAMS.get(key);
      if (!param || typeof value !== 'number' || !Number.isInteger(value)) {
        return [];
      }
      return [[key, Math.min(param.max, Math.max(param.min, value))] as const];
    });
    return { ...DEFAULT_PERIODS, ...Object.fromEntries(moved) };
  } catch {
    return DEFAULT_PERIODS;
  }
}

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LoginComponent,
    TickerSearchComponent,
    IndicatorLegendComponent,
    PriceChartComponent,
    ScreenerPanelComponent,
    WatchlistPanelComponent,
    ThemePickerComponent,
    DecimalPipe,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  /** Read by the template: nothing is painted until this says who is signed in. */
  protected readonly auth = inject(AuthService);

  /** Drives the decisions CSS cannot take on its own; the widths themselves live in the CSS. */
  protected readonly viewport = inject(ViewportService);

  protected readonly timeframes = TIMEFRAMES;
  protected readonly chartTypes = CHART_TYPES;

  protected readonly price = formatPrice;
  protected readonly percent = formatPercent;
  protected readonly ratio = formatRatio;
  protected readonly compact = formatCompact;

  /** The screener selection as the last session left it. Read once, before the ticker uses it. */
  private readonly restoredRow = storedRow();

  /**
   * A remembered selection brings the ticker with it: the symbol is one signal for both
   * screens, so opening the chart on the default and the detail on the stored row would draw
   * one ticker's candles under another one's header.
   */
  protected readonly symbol = signal(this.restoredRow?.symbol ?? DEFAULT_SYMBOL);
  /**
   * Written from two places — the chart's top bar and the screener detail's header — on
   * purpose: one selector each would let the two screens disagree, and then reading a chart
   * starts with working out which one it obeyed.
   */
  protected readonly timeframe = signal<Timeframe>('DAY');
  /**
   * Candles on a first visit; after that, whatever shape was left. Unlike the timeframe this
   * one has no selector in the screener detail, which just reads it.
   */
  protected readonly chartType = signal<ChartType>(storedChartType());
  /** Which screen is up. Not stored: a session always opens on the chart. */
  protected readonly view = signal<View>('chart');

  /** Which panel is up over the chart on a phone. Never open on a screen wide enough to dock. */
  protected readonly sheet = signal<Sheet>(null);
  /** Everything on for a first visit; after that, however the legend was left. */
  protected readonly visibleIndicators = signal<ReadonlySet<Indicator>>(storedIndicators());
  /** Textbook periods on a first visit; after that, whatever the popovers were left on. */
  protected readonly periods = signal<IndicatorPeriods>(storedPeriods());
  /**
   * The row the screener detail is drawn from. Null means no row is picked and the table
   * stands alone. Kept as the whole row, not the ticker: every number the detail shows came
   * with the page the table already loaded, so it costs no extra request.
   */
  protected readonly selectedRow = signal<ScreenerSymbol | null>(this.restoredRow);
  /** Descriptions under each pill. On the first visit they are shown; after that, as left. */
  protected readonly showHints = signal(localStorage.getItem(SHOW_HINTS_KEY) !== 'false');
  protected readonly series = signal<CandleSeries | null>(null);
  /** The index the RS line reads. Null unless that indicator is on; see `loadBenchmark`. */
  protected readonly benchmark = signal<CandleSeries | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Last bar plus its move against the previous close: the numbers a chart header shows. */
  protected readonly quote = computed(() => {
    const candles = this.series()?.candles ?? [];
    if (!candles.length) {
      return null;
    }
    const last = candles[candles.length - 1];
    const previous = candles.length > 1 ? candles[candles.length - 2] : last;
    const change = last.close - previous.close;
    return {
      close: last.close,
      volume: last.volume,
      change,
      changePercent: previous.close === 0 ? 0 : (change / previous.close) * 100,
      positive: change >= 0,
    };
  });

  private readonly market = inject(MarketService);
  /** Discards responses that arrive after the user already moved on. */
  private requestId = 0;
  /** The same guard for the benchmark, which travels on its own request. */
  private benchmarkRequestId = 0;

  constructor() {
    effect(() => localStorage.setItem(SHOW_HINTS_KEY, `${this.showHints()}`));

    // A sheet is over the chart, so the page under it holds still: on a phone the whole page
    // is the scroller, and a drag the sheet does not take carries on into it — what the finger
    // ends up moving is the chart behind. The class goes on the body because that is what
    // scrolls; the shell only grows past the fold, it does not scroll itself.
    effect(() => document.body.classList.toggle('sheet-open', this.sheet() !== null));

    // A window widened with a sheet up would leave it docked and floating at once: the panel
    // is back in its column the moment there is a column for it.
    effect(() => {
      if (!this.viewport.isMobile()) {
        untracked(() => this.sheet.set(null));
      }
    });
    effect(() => localStorage.setItem(CHART_TYPE_KEY, this.chartType()));
    // Closing the detail clears the key rather than storing a null: no selection is the
    // state a first visit is already in, and that one reads storage as absent.
    effect(() => {
      const row = this.selectedRow();
      if (row) {
        localStorage.setItem(SELECTED_ROW_KEY, JSON.stringify(row));
      } else {
        localStorage.removeItem(SELECTED_ROW_KEY);
      }
    });
    effect(() => {
      const visible = this.visibleIndicators();
      const hidden = INDICATORS.map(({ value }) => value).filter((value) => !visible.has(value));
      localStorage.setItem(HIDDEN_INDICATORS_KEY, JSON.stringify(hidden));
    });
    effect(() => {
      const moved = Object.entries(this.periods()).filter(
        ([key, value]) => value !== DEFAULT_PERIODS[key as PeriodKey],
      );
      localStorage.setItem(PERIODS_KEY, JSON.stringify(Object.fromEntries(moved)));
    });
    // The index rides on a second request, so it is only fetched while the RS line is on.
    // Kept as an effect rather than folded into `load`: switching the indicator on has to
    // fetch it too, and that happens without the ticker or the timeframe moving at all.
    effect(() => {
      const wanted = this.visibleIndicators().has('RS');
      const symbol = this.symbol();
      const timeframe = this.timeframe();
      if (this.auth.user()) {
        void this.loadBenchmark(wanted, symbol, timeframe);
      }
    });
    // Nothing is fetched before there is a session: every call would come back 401 and the
    // chart would sit behind the login screen painting an error. Untracked because `load`
    // reads the ticker and the timeframe, and the handlers already reload on those.
    effect(() => {
      if (this.auth.user()) {
        void untracked(() => this.load());
      }
    });
    void this.auth.probe();
  }

  protected onSymbolSelected(symbol: string): void {
    this.symbol.set(symbol);
    // Whatever asked for this ticker — the search box or a watchlist row — the answer is the
    // chart, so the sheet that was covering it gets out of the way.
    this.sheet.set(null);
    void this.load();
  }

  /**
   * Picking a row opens its detail under the table instead of leaving the screen: the point
   * of the screener is comparing candidates, and switching screens per ticker loses the list.
   * Clicking the row that is already open closes the detail.
   */
  protected onScreenerSelected(row: ScreenerSymbol): void {
    if (this.selectedRow()?.symbol === row.symbol) {
      this.selectedRow.set(null);
      return;
    }
    this.selectedRow.set(row);
    this.onSymbolSelected(row.symbol);
  }

  /**
   * A restored row carries the prices of the session that stored it, while the list beside it
   * is already on today's, so the panel hands the row back the moment a page arrives with the
   * ticker still in it. The ticker cannot change here, which is why nothing is reloaded.
   */
  protected onRowRefreshed(row: ScreenerSymbol): void {
    this.selectedRow.set(row);
  }

  protected showView(view: View): void {
    this.view.set(view);
    this.sheet.set(null);
  }

  /** Tapping the button of the panel already up closes it, the way a drawer handle behaves. */
  protected toggleSheet(sheet: Exclude<Sheet, null>): void {
    this.sheet.update((open) => (open === sheet ? null : sheet));
  }

  protected closeSheet(): void {
    this.sheet.set(null);
  }

  protected toggleIndicator(indicator: Indicator): void {
    const next = new Set(this.visibleIndicators());
    if (!next.delete(indicator)) {
      next.add(indicator);
    }
    this.visibleIndicators.set(next);
  }

  protected toggleHints(): void {
    this.showHints.update((shown) => !shown);
  }

  /** The legend already clamped the value to the param's bounds; this only stores it. */
  protected onPeriodChanged({ param, value }: PeriodChange): void {
    this.periods.update((periods) => ({ ...periods, [param.key]: value }));
  }

  /** Sends the ticker the detail is showing to the chart screen, list and all left behind. */
  protected openInChart(): void {
    this.view.set('chart');
  }

  protected closeDetail(): void {
    this.selectedRow.set(null);
  }

  protected onTimeframeSelected(timeframe: Timeframe): void {
    if (timeframe === this.timeframe()) {
      return;
    }
    this.timeframe.set(timeframe);
    void this.load();
  }

  /** Only repaints: the bars are the same, it is the shape drawn from them that changes. */
  protected onChartTypeSelected(chartType: ChartType): void {
    this.chartType.set(chartType);
  }

  protected formatVolume(volume: number): string {
    if (volume >= 1_000_000_000) {
      return `${(volume / 1_000_000_000).toFixed(2)} B`;
    }
    if (volume >= 1_000_000) {
      return `${(volume / 1_000_000).toFixed(2)} M`;
    }
    if (volume >= 1_000) {
      return `${(volume / 1_000).toFixed(1)} K`;
    }
    return `${volume}`;
  }

  /**
   * Dividing the index by itself draws a flat line that says nothing, so a ticker that *is*
   * the benchmark gets none. A failure is swallowed on purpose: the RS line goes missing and
   * the chart it belongs to carries on, rather than the whole screen reporting an error.
   */
  private async loadBenchmark(
    wanted: boolean,
    symbol: string,
    timeframe: Timeframe,
  ): Promise<void> {
    const id = ++this.benchmarkRequestId;
    if (!wanted || symbol === RS_BENCHMARK) {
      this.benchmark.set(null);
      return;
    }
    try {
      const result = await this.market.loadCandles(RS_BENCHMARK, timeframe);
      if (id === this.benchmarkRequestId) {
        this.benchmark.set(result);
      }
    } catch {
      if (id === this.benchmarkRequestId) {
        this.benchmark.set(null);
      }
    }
  }

  private async load(): Promise<void> {
    const id = ++this.requestId;
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.market.loadCandles(this.symbol(), this.timeframe());
      if (id !== this.requestId) {
        return;
      }
      this.series.set(result);
      if (!result.candles.length) {
        this.error.set('Sin datos para este ticker.');
      }
    } catch {
      if (id === this.requestId) {
        this.series.set(null);
        this.error.set(`No se pudo cargar ${this.symbol()}. Comprueba el ticker o el backend.`);
      }
    } finally {
      if (id === this.requestId) {
        this.loading.set(false);
      }
    }
  }
}
