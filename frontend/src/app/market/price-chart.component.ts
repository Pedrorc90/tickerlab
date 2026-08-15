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
  LineSeries,
  LineStyle,
  SeriesType,
  Time,
  UTCTimestamp,
  createChart,
  createTextWatermark,
} from 'lightweight-charts';
import { MACD_FAST, MACD_SIGNAL, MACD_SLOW, macd } from './indicators/macd';
import { SMA_FAST, SMA_SLOW, simpleMovingAverage } from './indicators/moving-average';
import { RSI_OVERBOUGHT, RSI_OVERSOLD, RSI_PERIOD, relativeStrengthIndex } from './indicators/rsi';
import { Candle, CandleSeries, INDICATORS, Indicator } from './market.models';

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
  smaFast: '#f0b90b',
  smaSlow: '#a78bfa',
  macdLine: '#4b8bff',
  macdSignal: '#ff9f43',
  macdHistUp: 'rgba(38, 166, 154, 0.55)',
  macdHistDown: 'rgba(239, 83, 80, 0.55)',
} as const;

/**
 * Relative pane heights. They are weights, not fractions: whatever is switched off
 * drops out and the rest share the full height, so price alone fills the chart.
 */
const PANE_WEIGHTS: Record<'price' | Indicator, number> = {
  price: 0.58,
  VOLUME: 0.15,
  RSI: 0.27,
  MACD: 0.27,
  // Overlays never get a pane of their own; these are here only to keep the record total.
  SMA50: 0,
  SMA200: 0,
};

/** Candles live here, and so does anything drawn on top of them. */
const PRICE_PANE = 0;

/** RSI pivots around 50: above it buyers dominate, below it sellers do. */
const RSI_MIDLINE = 50;

/** One switched-on indicator: the series it owns, how to feed them, and its pane label. */
interface IndicatorPlot {
  series: ISeriesApi<SeriesType>[];
  setData: (candles: Candle[]) => void;
  label?: ITextWatermarkPluginApi<Time>;
}

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
  readonly indicators = input<ReadonlySet<Indicator>>(
    new Set<Indicator>(INDICATORS.map(({ value }) => value)),
  );

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');

  private chart?: IChartApi;
  private candleSeries?: ISeriesApi<'Candlestick'>;
  /** Only the indicators currently switched on. Everything else has been removed outright. */
  private readonly plots = new Map<Indicator, IndicatorPlot>();
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
    const chart = this.chart;
    if (!chart) {
      return;
    }

    for (const { value } of INDICATORS) {
      const plot = this.plots.get(value);
      if (visible.has(value) && !plot) {
        this.plots.set(value, this.createPlot(chart, value));
      } else if (!visible.has(value) && plot) {
        plot.label?.detach();
        for (const series of plot.series) {
          chart.removeSeries(series);
        }
        this.plots.delete(value);
      }
    }

    this.dropEmptyPanes();
    this.orderPanes();
  }

  /**
   * Builds one indicator. Pane indicators land on a fresh pane at the bottom and
   * `orderPanes` moves them into place; overlays go straight onto the price pane.
   */
  private createPlot(chart: IChartApi, indicator: Indicator): IndicatorPlot {
    const nextPane = chart.panes().length;

    switch (indicator) {
      case 'SMA50':
      case 'SMA200': {
        const period = indicator === 'SMA50' ? SMA_FAST : SMA_SLOW;
        const series = chart.addSeries(
          LineSeries,
          {
            color: indicator === 'SMA50' ? COLORS.smaFast : COLORS.smaSlow,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          },
          PRICE_PANE,
        );
        return {
          series: [series],
          setData: (candles) =>
            series.setData(
              simpleMovingAverage(candles, period).map((point) => ({
                time: point.time as UTCTimestamp,
                value: point.value,
              })),
            ),
        };
      }

      case 'VOLUME': {
        const series = chart.addSeries(
          HistogramSeries,
          { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
          nextPane,
        );
        return {
          series: [series],
          setData: (candles) =>
            series.setData(
              candles.map((candle) => ({
                time: candle.time as UTCTimestamp,
                value: candle.volume,
                color: candle.close >= candle.open ? COLORS.volumeUp : COLORS.volumeDown,
              })),
            ),
        };
      }

      case 'RSI': {
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
          nextPane,
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

        return {
          series: [series],
          label: this.labelPane(series, `RSI ${RSI_PERIOD}`),
          setData: (candles) =>
            series.setData(
              relativeStrengthIndex(candles, RSI_PERIOD).map((point) => ({
                time: point.time as UTCTimestamp,
                value: point.value,
              })),
            ),
        };
      }

      case 'MACD': {
        // The histogram goes in first so the two lines are drawn over it, not under.
        const histogram = chart.addSeries(
          HistogramSeries,
          { priceLineVisible: false, lastValueVisible: false },
          nextPane,
        );
        const line = chart.addSeries(
          LineSeries,
          { color: COLORS.macdLine, lineWidth: 2, priceLineVisible: false },
          nextPane,
        );
        const signal = chart.addSeries(
          LineSeries,
          { color: COLORS.macdSignal, lineWidth: 1, priceLineVisible: false },
          nextPane,
        );

        return {
          series: [histogram, line, signal],
          label: this.labelPane(histogram, `MACD ${MACD_FAST}/${MACD_SLOW}/${MACD_SIGNAL}`),
          setData: (candles) => {
            const points = macd(candles);
            histogram.setData(
              points.map((point) => ({
                time: point.time as UTCTimestamp,
                value: point.histogram,
                color: point.histogram >= 0 ? COLORS.macdHistUp : COLORS.macdHistDown,
              })),
            );
            line.setData(
              points.map((point) => ({ time: point.time as UTCTimestamp, value: point.macd })),
            );
            signal.setData(
              points.map((point) => ({ time: point.time as UTCTimestamp, value: point.signal })),
            );
          },
        };
      }
    }
  }

  /** Names a pane, since stacked panes give no other clue about what each one holds. */
  private labelPane(series: ISeriesApi<SeriesType>, text: string): ITextWatermarkPluginApi<Time> {
    return createTextWatermark(series.getPane(), {
      horzAlign: 'right',
      vertAlign: 'top',
      lines: [{ text, color: COLORS.paneLabel, fontSize: 11 }],
    });
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
    let target = PRICE_PANE + 1;
    for (const { value, overlay } of INDICATORS) {
      if (overlay) {
        continue;
      }
      const pane = this.plots.get(value)?.series[0].getPane();
      if (!pane) {
        continue;
      }
      if (pane.paneIndex() !== target) {
        pane.moveTo(target);
      }
      target++;
    }
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

    for (const plot of this.plots.values()) {
      plot.setData(candles);
    }

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

    // Overlays share the price pane, so they get no height of their own.
    const visible = this.indicators();
    const weights = [
      PANE_WEIGHTS.price,
      ...INDICATORS.filter(({ value, overlay }) => !overlay && visible.has(value)).map(
        ({ value }) => PANE_WEIGHTS[value],
      ),
    ];
    const sum = weights.reduce((acc, weight) => acc + weight, 0);

    for (let i = 0; i < Math.min(panes.length, weights.length); i++) {
      panes[i].setHeight(Math.round((total * weights[i]) / sum));
    }
  }
}
