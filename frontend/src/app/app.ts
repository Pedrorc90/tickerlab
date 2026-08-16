import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { MarketService } from './market/market.service';
import {
  CandleSeries,
  DEFAULT_PERIODS,
  INDICATORS,
  Indicator,
  IndicatorPeriods,
  PeriodParam,
  TIMEFRAMES,
  Timeframe,
  periodSuffix,
} from './market/market.models';
import { PriceChartComponent } from './market/price-chart.component';
import { TickerSearchComponent } from './market/ticker-search.component';
import { ScreenerPanelComponent } from './screener/screener-panel.component';
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

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TickerSearchComponent,
    PriceChartComponent,
    ScreenerPanelComponent,
    WatchlistPanelComponent,
    ThemePickerComponent,
    DecimalPipe,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
  // Clicking anywhere else dismisses an open period popover; the popover itself stops
  // the event before it gets here.
  host: { '(document:click)': 'openPopover.set(null)' },
})
export class App {
  protected readonly timeframes = TIMEFRAMES;
  protected readonly indicators = INDICATORS;

  protected readonly symbol = signal(DEFAULT_SYMBOL);
  protected readonly timeframe = signal<Timeframe>('DAY');
  /** Which screen is up. Not stored: a session always opens on the chart. */
  protected readonly view = signal<View>('chart');
  /** Everything on for a first visit; after that, however the legend was left. */
  protected readonly visibleIndicators = signal<ReadonlySet<Indicator>>(storedIndicators());
  /** Live periods, in memory only: a reload brings back the textbook defaults. */
  protected readonly periods = signal<IndicatorPeriods>(DEFAULT_PERIODS);
  /** Which pill has its period popover open, if any. */
  protected readonly openPopover = signal<Indicator | null>(null);
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
    void this.load();
  }

  protected onSymbolSelected(symbol: string): void {
    this.symbol.set(symbol);
    void this.load();
  }

  /** Picking a row in the screener is a request to see that ticker, so the chart comes back. */
  protected onScreenerSelected(symbol: string): void {
    this.view.set('chart');
    this.onSymbolSelected(symbol);
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

  /** `SMA 50`, `MACD 12/26/9`, plain `Volumen` — whatever the pill has to say right now. */
  protected labelOf(label: string, params: ReadonlyArray<PeriodParam>): string {
    const suffix = periodSuffix(params, this.periods());
    return suffix ? `${label} ${suffix}` : label;
  }

  protected toggleHints(): void {
    this.showHints.update((shown) => !shown);
  }

  protected togglePopover(indicator: Indicator): void {
    this.openPopover.update((open) => (open === indicator ? null : indicator));
  }

  /**
   * Out-of-range or half-typed values would blank the indicator out, so the raw input is
   * clamped to the param's bounds and anything unparseable falls back to the default.
   * Returns what was kept so the input can show the clamped number instead of what was typed —
   * a plain `[value]` binding would not repaint when the clamp lands on the previous value.
   */
  protected setPeriod(param: PeriodParam, raw: string): string {
    const parsed = Number.parseInt(raw, 10);
    const value = Number.isNaN(parsed)
      ? param.defaultValue
      : Math.min(param.max, Math.max(param.min, parsed));
    this.periods.update((periods) => ({ ...periods, [param.key]: value }));
    return `${value}`;
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
