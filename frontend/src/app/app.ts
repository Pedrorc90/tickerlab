import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { MarketService } from './market/market.service';
import {
  CandleSeries,
  DEFAULT_PERIODS,
  INDICATORS,
  Indicator,
  IndicatorPeriods,
  PeriodKey,
  PeriodParam,
  TIMEFRAMES,
  Timeframe,
} from './market/market.models';
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

/** Something recognisable has to be on screen before the user types anything. */
const DEFAULT_SYMBOL = 'AAPL';

/** Whether the indicator descriptions were left open. UI state, so it stays in the browser. */
const SHOW_HINTS_KEY = 'tickerlab.showIndicatorHints';

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
  protected readonly timeframes = TIMEFRAMES;

  protected readonly price = formatPrice;
  protected readonly percent = formatPercent;
  protected readonly ratio = formatRatio;
  protected readonly compact = formatCompact;

  protected readonly symbol = signal(DEFAULT_SYMBOL);
  protected readonly timeframe = signal<Timeframe>('DAY');
  /** Which screen is up. Not stored: a session always opens on the chart. */
  protected readonly view = signal<View>('chart');
  /** Everything on for a first visit; after that, however the legend was left. */
  protected readonly visibleIndicators = signal<ReadonlySet<Indicator>>(storedIndicators());
  /** Textbook periods on a first visit; after that, whatever the popovers were left on. */
  protected readonly periods = signal<IndicatorPeriods>(storedPeriods());
  /**
   * The row the screener detail is drawn from. Null means no row is picked and the table
   * stands alone. Kept as the whole row, not the ticker: every number the detail shows came
   * with the page the table already loaded, so it costs no extra request.
   */
  protected readonly selectedRow = signal<ScreenerSymbol | null>(null);
  /** Descriptions under each pill. On the first visit they are shown; after that, as left. */
  protected readonly showHints = signal(localStorage.getItem(SHOW_HINTS_KEY) !== 'false');
  protected readonly series = signal<CandleSeries | null>(null);
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

  constructor() {
    effect(() => localStorage.setItem(SHOW_HINTS_KEY, `${this.showHints()}`));
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
    void this.load();
  }

  protected onSymbolSelected(symbol: string): void {
    this.symbol.set(symbol);
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

  protected showView(view: View): void {
    this.view.set(view);
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
