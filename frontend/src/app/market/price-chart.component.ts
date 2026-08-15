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
import { bollingerBands } from './indicators/bollinger';
import { macd } from './indicators/macd';
import { simpleMovingAverage, volumeMovingAverage } from './indicators/moving-average';
import { RSI_OVERBOUGHT, RSI_OVERSOLD, relativeStrengthIndex } from './indicators/rsi';
import {
  Candle,
  CandleSeries,
  DEFAULT_PERIODS,
  INDICATORS,
  Indicator,
  IndicatorPeriods,
  periodSuffix,
} from './market.models';

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
  volumeAverage: '#e0e3eb',
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
  bollingerBand: '#6f86c9',
  bollingerBasis: 'rgba(111, 134, 201, 0.55)',
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
  BOLLINGER: 0,
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
  /** Periods this plot was built with — a different one means it has to be rebuilt. */
  signature: string;
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
  readonly periods = input<IndicatorPeriods>(DEFAULT_PERIODS);

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
      const periods = this.periods();
      if (this.chart) {
        this.syncIndicators(indicators, periods);
        this.draw(series);
        this.layoutPanes();
      }
    });
  }

  ngAfterViewInit(): void {
    this.createChart();
    this.syncIndicators(this.indicators(), this.periods());
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

  /**
   * Adds and removes indicator series so the chart matches what the legend has switched on,
   * and rebuilds any whose periods changed — a new period means new data *and* a new pane
   * label, which is cheaper to redo from scratch than to patch in place.
   *
   * Teardown runs before setup on purpose: a fresh pane is created at `panes().length`, so
   * the stale empty panes have to be gone before anything new asks for an index.
   */
  private syncIndicators(visible: ReadonlySet<Indicator>, periods: IndicatorPeriods): void {
    const chart = this.chart;
    if (!chart) {
      return;
    }

    const stale: Indicator[] = [];
    for (const { value, params } of INDICATORS) {
      const plot = this.plots.get(value);
      if (!plot) {
        continue;
      }
      if (!visible.has(value) || plot.signature !== periodSuffix(params, periods)) {
        plot.label?.detach();
        for (const series of plot.series) {
          chart.removeSeries(series);
        }
        this.plots.delete(value);
        stale.push(value);
      }
    }

    if (stale.length) {
      this.dropEmptyPanes();
    }

    for (const { value } of INDICATORS) {
      if (visible.has(value) && !this.plots.get(value)) {
        this.plots.set(value, this.createPlot(chart, value, periods));
      }
    }

    this.dropEmptyPanes();
    this.orderPanes();
  }

  /**
   * Builds one indicator. Pane indicators land on a fresh pane at the bottom and
   * `orderPanes` moves them into place; overlays go straight onto the price pane.
   */
  private createPlot(
    chart: IChartApi,
    indicator: Indicator,
    periods: IndicatorPeriods,
  ): IndicatorPlot {
    const nextPane = chart.panes().length;
    const signature = periodSuffix(
      INDICATORS.find(({ value }) => value === indicator)?.params ?? [],
      periods,
    );

    switch (indicator) {
      case 'SMA50':
      case 'SMA200': {
        const period = indicator === 'SMA50' ? periods.smaFast : periods.smaSlow;
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
          signature,
          setData: (candles) =>
            series.setData(
              simpleMovingAverage(candles, period).map((point) => ({
                time: point.time as UTCTimestamp,
                value: point.value,
              })),
            ),
        };
      }

      case 'BOLLINGER': {
        // Three lines share one calculation. The basis is dashed so it is not mistaken
        // for one more SMA, and all three are hairlines: the candles come first.
        const [upper, basis, lower] = ['upper', 'basis', 'lower'].map((part) =>
          chart.addSeries(
            LineSeries,
            {
              color: part === 'basis' ? COLORS.bollingerBasis : COLORS.bollingerBand,
              lineWidth: 1,
              lineStyle: part === 'basis' ? LineStyle.Dashed : LineStyle.Solid,
              priceLineVisible: false,
              lastValueVisible: false,
              crosshairMarkerVisible: false,
            },
            PRICE_PANE,
          ),
        );

        return {
          series: [upper, basis, lower],
          signature,
          setData: (candles) => {
            const points = bollingerBands(
              candles,
              periods.bollinger,
              periods.bollingerDeviations,
            );
            upper.setData(
              points.map((point) => ({ time: point.time as UTCTimestamp, value: point.upper })),
            );
            basis.setData(
              points.map((point) => ({ time: point.time as UTCTimestamp, value: point.middle })),
            );
            lower.setData(
              points.map((point) => ({ time: point.time as UTCTimestamp, value: point.lower })),
            );
          },
        };
      }

      case 'VOLUME': {
        const series = chart.addSeries(
          HistogramSeries,
          { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
          nextPane,
        );
        // Added after the bars so the average is drawn over them: a bar clearing this
        // line is the whole point of the pane.
        const average = chart.addSeries(
          LineSeries,
          {
            color: COLORS.volumeAverage,
            lineWidth: 1,
            priceFormat: { type: 'volume' },
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          },
          nextPane,
        );

        return {
          series: [series, average],
          signature,
          setData: (candles) => {
            series.setData(
              candles.map((candle) => ({
                time: candle.time as UTCTimestamp,
                value: candle.volume,
                color: candle.close >= candle.open ? COLORS.volumeUp : COLORS.volumeDown,
              })),
            );
            average.setData(
              volumeMovingAverage(candles, periods.volumeAverage).map((point) => ({
                time: point.time as UTCTimestamp,
                value: point.value,
              })),
            );
          },
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
          signature,
          label: this.labelPane(series, `RSI ${periods.rsi}`),
          setData: (candles) =>
            series.setData(
              relativeStrengthIndex(candles, periods.rsi).map((point) => ({
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
          signature,
          label: this.labelPane(histogram, `MACD ${signature}`),
          setData: (candles) => {
            const points = macd(candles, periods.macdFast, periods.macdSlow, periods.macdSignal);
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
