import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MarketService } from './market/market.service';
import {
  CandleSeries,
  INDICATORS,
  Indicator,
  TIMEFRAMES,
  Timeframe,
} from './market/market.models';
import { PriceChartComponent } from './market/price-chart.component';
import { TickerSearchComponent } from './market/ticker-search.component';

/** Something recognisable has to be on screen before the user types anything. */
const DEFAULT_SYMBOL = 'AAPL';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TickerSearchComponent, PriceChartComponent, DecimalPipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly timeframes = TIMEFRAMES;
  protected readonly indicators = INDICATORS;

  protected readonly symbol = signal(DEFAULT_SYMBOL);
  protected readonly timeframe = signal<Timeframe>('DAY');
  /** Everything on by default; the legend switches each one off. */
  protected readonly visibleIndicators = signal<ReadonlySet<Indicator>>(
    new Set(INDICATORS.map(({ value }) => value)),
  );
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
    void this.load();
  }

  protected onSymbolSelected(symbol: string): void {
    this.symbol.set(symbol);
    void this.load();
  }

  protected toggleIndicator(indicator: Indicator): void {
    const next = new Set(this.visibleIndicators());
    if (!next.delete(indicator)) {
      next.add(indicator);
    }
    this.visibleIndicators.set(next);
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
