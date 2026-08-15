import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  viewChild,
} from '@angular/core';
import {
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  IChartApi,
  ISeriesApi,
  ITextWatermarkPluginApi,
  LineStyle,
  Time,
  UTCTimestamp,
  createChart,
  createTextWatermark,
} from 'lightweight-charts';
import { RSI_OVERBOUGHT, RSI_OVERSOLD, RSI_PERIOD, relativeStrengthIndex } from './indicators/rsi';
import { CandleSeries, INDICATORS, Indicator } from './market.models';

/** Dark palette, close to what trading terminals use. */
const COLORS = {
  background: '#131722',
  text: '#b2b5be',
  grid: '#1f2430',
  border: '#2a2e39',
  up: '#26a69a',
  down: '#ef5350',
  volumeUp: 'rgba(38, 166, 154, 0.5)',
  volumeDown: 'rgba(239, 83, 80, 0.5)',
  rsiStrong: '#2ec4b6',
  rsiWeak: '#ff6b6b',
  rsiStrongFill: 'rgba(46, 196, 182, 0.45)',
  rsiWeakFill: 'rgba(255, 107, 107, 0.45)',
  rsiFade: 'rgba(46, 196, 182, 0)',
  rsiOverboughtBand: 'rgba(46, 196, 182, 0.55)',
  rsiOversoldBand: 'rgba(255, 107, 107, 0.55)',
  paneLabel: 'rgba(178, 181, 190, 0.55)',
} as const;

/**
 * Relative pane heights. They are weights, not fractions: whatever is switched off
 * drops out and the rest share the full height, so price alone fills the chart.
 */
const PANE_WEIGHTS = { price: 0.58, VOLUME: 0.15, RSI: 0.27 } as const;

/** RSI pivots around 50: above it buyers dominate, below it sellers do. */
const RSI_MIDLINE = 50;

@Component({
  selector: 'app-price-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chart-host" #host></div>
    @if (!series()) {
      <p class="chart-empty">Busca un ticker para ver su gráfico.</p>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      height: 100%;
      min-height: 0;
    }

    .chart-host {
      height: 100%;
      width: 100%;
    }

    .chart-empty {
      position: absolute;
      inset: 0;
      display: grid;
      place-content: center;
      margin: 0;
      color: #6b7280;
      font-size: 0.95rem;
      pointer-events: none;
    }
  `,
})
export class PriceChartComponent implements AfterViewInit, OnDestroy {
  readonly series = input<CandleSeries | null>(null);
  readonly indicators = input<ReadonlySet<Indicator>>(new Set<Indicator>(['VOLUME', 'RSI']));

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');

  private chart?: IChartApi;
  private candleSeries?: ISeriesApi<'Candlestick'>;
  private volumeSeries?: ISeriesApi<'Histogram'>;
  private rsiSeries?: ISeriesApi<'Baseline'>;
  private rsiLabel?: ITextWatermarkPluginApi<Time>;
  private resizeObserver?: ResizeObserver;

  constructor() {
    // Redraws whenever the parent swaps ticker, timeframe or indicators;
    // no-ops until the chart exists.
    effect(() => {
      const series = this.series();
      const indicators = this.indicators();
      if (this.chart) {
        this.syncIndicators(indicators);
        this.draw(series);
        this.layoutPanes();
      }
    });
  }

  ngAfterViewInit(): void {
    this.createChart();
    this.syncIndicators(this.indicators());
    this.draw(this.series());
    this.layoutPanes();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.chart?.remove();
  }

  private createChart(): void {
    const element = this.host().nativeElement;

    this.chart = createChart(element, {
      layout: {
        background: { type: ColorType.Solid, color: COLORS.background },
        textColor: COLORS.text,
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: COLORS.border, separatorHoverColor: COLORS.grid, enableResize: true },
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: COLORS.border },
      timeScale: { borderColor: COLORS.border, rightOffset: 4 },
      autoSize: true,
    });

    this.candleSeries = this.chart.addSeries(CandlestickSeries, {
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderUpColor: COLORS.up,
      borderDownColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
    });

    this.resizeObserver = new ResizeObserver(() => this.layoutPanes());
    this.resizeObserver.observe(element);
  }

  /** Adds and removes indicator series so the chart matches what the legend has switched on. */
  private syncIndicators(visible: ReadonlySet<Indicator>): void {
    if (visible.has('VOLUME') && !this.volumeSeries) {
      this.volumeSeries = this.addVolumeSeries();
    } else if (!visible.has('VOLUME') && this.volumeSeries) {
      this.chart?.removeSeries(this.volumeSeries);
      this.volumeSeries = undefined;
    }

    if (visible.has('RSI') && !this.rsiSeries) {
      this.rsiSeries = this.addRsiSeries();
    } else if (!visible.has('RSI') && this.rsiSeries) {
      this.rsiLabel?.detach();
      this.rsiLabel = undefined;
      this.chart?.removeSeries(this.rsiSeries);
      this.rsiSeries = undefined;
    }

    this.dropEmptyPanes();
    this.orderPanes();
  }

  /** New indicators always land on a fresh pane at the bottom; `orderPanes` puts them in place. */
  private addVolumeSeries(): ISeriesApi<'Histogram'> | undefined {
    const chart = this.chart;
    if (!chart) {
      return undefined;
    }
    return chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
      chart.panes().length,
    );
  }

  private addRsiSeries(): ISeriesApi<'Baseline'> | undefined {
    const chart = this.chart;
    if (!chart) {
      return undefined;
    }

    // A filled baseline reads far better than a hairline at this pane height: the shaded
    // area above/below 50 shows which side is in control without squinting at the curve.
    const series = chart.addSeries(
      BaselineSeries,
      {
        baseValue: { type: 'price', price: RSI_MIDLINE },
        topLineColor: COLORS.rsiStrong,
        topFillColor1: COLORS.rsiStrongFill,
        topFillColor2: COLORS.rsiFade,
        bottomLineColor: COLORS.rsiWeak,
        bottomFillColor1: COLORS.rsiFade,
        bottomFillColor2: COLORS.rsiWeakFill,
        lineWidth: 2,
        priceLineVisible: false,
        // RSI is bounded by definition, so pin the scale instead of letting it breathe.
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      },
      chart.panes().length,
    );

    const bands: ReadonlyArray<[number, string]> = [
      [RSI_OVERBOUGHT, COLORS.rsiOverboughtBand],
      [RSI_OVERSOLD, COLORS.rsiOversoldBand],
    ];
    for (const [level, color] of bands) {
      series.createPriceLine({
        price: level,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '',
      });
    }

    // Names the pane, since stacked panes give no other clue about what each one holds.
    this.rsiLabel = createTextWatermark(series.getPane(), {
      horzAlign: 'right',
      vertAlign: 'top',
      lines: [{ text: `RSI ${RSI_PERIOD}`, color: COLORS.paneLabel, fontSize: 11 }],
    });

    return series;
  }

  /** Removing a series leaves its pane behind, still taking up height. */
  private dropEmptyPanes(): void {
    const panes = this.chart?.panes() ?? [];
    for (let i = panes.length - 1; i > 0; i--) {
      if (!panes[i].getSeries().length) {
        this.chart?.removePane(i);
      }
    }
  }

  /** Keeps panes in `INDICATORS` order, whatever the order things were switched on in. */
  private orderPanes(): void {
    let target = 1;
    for (const { value } of INDICATORS) {
      const pane = this.seriesFor(value)?.getPane();
      if (!pane) {
        continue;
      }
      if (pane.paneIndex() !== target) {
        pane.moveTo(target);
      }
      target++;
    }
  }

  private seriesFor(indicator: Indicator): ISeriesApi<'Histogram' | 'Baseline'> | undefined {
    return indicator === 'VOLUME' ? this.volumeSeries : this.rsiSeries;
  }

  private draw(series: CandleSeries | null): void {
    const candles = series?.candles ?? [];

    this.candleSeries?.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    this.volumeSeries?.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? COLORS.volumeUp : COLORS.volumeDown,
      })),
    );

    this.rsiSeries?.setData(
      relativeStrengthIndex(candles, RSI_PERIOD).map((p) => ({
        time: p.time as UTCTimestamp,
        value: p.value,
      })),
    );

    if (candles.length) {
      this.chart?.timeScale().fitContent();
    }
  }

  /** Panes are sized in pixels, so they need recomputing on every resize and every toggle. */
  private layoutPanes(): void {
    const panes = this.chart?.panes();
    const total = this.host().nativeElement.clientHeight;
    if (!panes?.length || total <= 0) {
      return;
    }

    const visible = this.indicators();
    const weights = [
      PANE_WEIGHTS.price,
      ...INDICATORS.filter(({ value }) => visible.has(value)).map(({ value }) => PANE_WEIGHTS[value]),
    ];
    const sum = weights.reduce((acc, weight) => acc + weight, 0);

    for (let i = 0; i < Math.min(panes.length, weights.length); i++) {
      panes[i].setHeight(Math.round((total * weights[i]) / sum));
    }
  }
}
