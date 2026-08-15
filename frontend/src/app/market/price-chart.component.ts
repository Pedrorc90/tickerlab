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
  LineStyle,
  UTCTimestamp,
  createChart,
} from 'lightweight-charts';
import { RSI_OVERBOUGHT, RSI_OVERSOLD, RSI_PERIOD, relativeStrengthIndex } from './indicators/rsi';
import { CandleSeries } from './market.models';

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
} as const;

/** Vertical split between the three panes, as a fraction of the total height. */
const PANE_RATIOS = { price: 0.58, volume: 0.15, rsi: 0.27 } as const;

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

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');

  private chart?: IChartApi;
  private candleSeries?: ISeriesApi<'Candlestick'>;
  private volumeSeries?: ISeriesApi<'Histogram'>;
  private rsiSeries?: ISeriesApi<'Baseline'>;
  private resizeObserver?: ResizeObserver;

  constructor() {
    // Redraws whenever the parent swaps ticker or timeframe; no-ops until the chart exists.
    effect(() => {
      const series = this.series();
      if (this.chart) {
        this.draw(series);
      }
    });
  }

  ngAfterViewInit(): void {
    this.createChart();
    this.draw(this.series());
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

    this.volumeSeries = this.chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
      1,
    );

    // A filled baseline reads far better than a hairline at this pane height: the shaded
    // area above/below 50 shows which side is in control without squinting at the curve.
    this.rsiSeries = this.chart.addSeries(
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
      2,
    );

    const bands: ReadonlyArray<[number, string]> = [
      [RSI_OVERBOUGHT, COLORS.rsiOverboughtBand],
      [RSI_OVERSOLD, COLORS.rsiOversoldBand],
    ];
    for (const [level, color] of bands) {
      this.rsiSeries.createPriceLine({
        price: level,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: '',
      });
    }

    this.resizeObserver = new ResizeObserver(() => this.layoutPanes());
    this.resizeObserver.observe(element);
    this.layoutPanes();
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

  /** Panes are sized in pixels, so they need recomputing on every container resize. */
  private layoutPanes(): void {
    const panes = this.chart?.panes();
    if (!panes || panes.length < 3) {
      return;
    }
    const total = this.host().nativeElement.clientHeight;
    if (total <= 0) {
      return;
    }
    panes[0].setHeight(Math.round(total * PANE_RATIOS.price));
    panes[1].setHeight(Math.round(total * PANE_RATIOS.volume));
    panes[2].setHeight(Math.round(total * PANE_RATIOS.rsi));
  }
}
