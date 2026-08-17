import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import {
  AreaSeries,
  BarSeries,
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
import { ADX_TREND_THRESHOLD, averageDirectionalIndex } from './indicators/adx';
import { averageTrueRange } from './indicators/atr';
import { bollingerBands } from './indicators/bollinger';
import { macd } from './indicators/macd';
import {
  exponentialMovingAverage,
  simpleMovingAverage,
  volumeMovingAverage,
} from './indicators/moving-average';
import { relativeStrengthLine } from './indicators/relative-strength';
import { RSI_OVERBOUGHT, RSI_OVERSOLD, relativeStrengthIndex } from './indicators/rsi';
import {
  Candle,
  CandleSeries,
  ChartType,
  DEFAULT_PERIODS,
  INDICATORS,
  Indicator,
  IndicatorPeriods,
  periodSuffix,
} from './market.models';
import { ThemeService } from '../theme/theme.service';

/**
 * Relative pane heights. They are weights, not fractions: whatever is switched off
 * drops out and the rest share the full height, so price alone fills the chart.
 */
const PANE_WEIGHTS: Record<'price' | Indicator, number> = {
  price: 0.58,
  VOLUME: 0.15,
  RSI: 0.27,
  MACD: 0.27,
  ATR: 0.2,
  ADX: 0.22,
  // Overlays never get a pane of their own; these are here only to keep the record total.
  SMA50: 0,
  SMA200: 0,
  EMA20: 0,
  EMA50: 0,
  BOLLINGER: 0,
  RS: 0,
};

/** Candles live here, and so does anything drawn on top of them. */
const PRICE_PANE = 0;

/**
 * How much of the history the chart opens on. A seventh rather than all of it: fitting the
 * whole series in squeezes recent bars into a smudge, and recent is what gets looked at.
 * Whatever is left is still there, one scroll to the left.
 */
const INITIAL_VISIBLE_FRACTION = 1 / 7;

/** Empty slots kept to the right of the last bar, matching the time scale's `rightOffset`. */
const RIGHT_MARGIN_BARS = 4;

/** RSI pivots around 50: above it buyers dominate, below it sellers do. */
const RSI_MIDLINE = 50;

/**
 * The RS line rides its own scale rather than the price axis: the two measure different
 * things, and forcing the ratio onto the price scale squashes the candles into a flat line.
 * Any id that is not `right` or `left` makes lightweight-charts create an overlay scale.
 */
const RS_SCALE_ID = 'rs';

/** Keeps that overlay in the top band of the price pane, clear of the candles below it. */
const RS_SCALE_MARGINS = { top: 0.02, bottom: 0.74 };

/** What candles and bars are fed: the whole bar. */
const asBar = (candle: Candle) => ({
  time: candle.time as UTCTimestamp,
  open: candle.open,
  high: candle.high,
  low: candle.low,
  close: candle.close,
});

/** What line and area are fed: the close and nothing else. */
const asClose = (candle: Candle) => ({ time: candle.time as UTCTimestamp, value: candle.close });

/** One switched-on indicator: the series it owns, how to feed them, and its pane label. */
interface IndicatorPlot {
  series: ISeriesApi<SeriesType>[];
  /**
   * `benchmark` is the index series, and only the RS line reads it: every other indicator
   * is computed from the ticker's own candles and simply ignores it.
   */
  setData: (candles: Candle[], benchmark: Candle[]) => void;
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
      color: var(--text-dim);
      font-size: 0.95rem;
      pointer-events: none;
    }
  `,
})
export class PriceChartComponent implements AfterViewInit, OnDestroy {
  readonly series = input<CandleSeries | null>(null);
  /**
   * The index the RS line is divided by, on the same timeframe as `series`. Null whenever
   * that indicator is off — or when the ticker *is* the index — and the line simply goes.
   */
  readonly benchmark = input<CandleSeries | null>(null);
  readonly indicators = input<ReadonlySet<Indicator>>(
    new Set<Indicator>(INDICATORS.map(({ value }) => value)),
  );
  readonly periods = input<IndicatorPeriods>(DEFAULT_PERIODS);
  readonly chartType = input<ChartType>('CANDLES');

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');

  private readonly theme = inject(ThemeService);
  /**
   * Plain snapshot rather than a signal read: every method below paints with it, and none of
   * them should drag the theme into whatever effect happens to be running.
   */
  private palette = this.theme.chart();

  private chart?: IChartApi;
  /** Feeds whichever price series is up: candles take OHLC, line and area take the close. */
  private setPriceData: (candles: Candle[]) => void = () => undefined;
  /** The shape the current price series was built as — a different one means rebuilding. */
  private drawnType?: ChartType;
  /**
   * The series the initial framing was done for. Anything else — a switched indicator, a new
   * price shape, a theme — redraws inside the range the user left, instead of yanking it back.
   */
  private framedSeries?: CandleSeries | null;
  /** Only the indicators currently switched on. Everything else has been removed outright. */
  private readonly plots = new Map<Indicator, IndicatorPlot>();
  private resizeObserver?: ResizeObserver;

  constructor() {
    // Redraws whenever the parent swaps ticker, timeframe or indicators;
    // no-ops until the chart exists.
    effect(() => {
      const series = this.series();
      const benchmark = this.benchmark();
      const indicators = this.indicators();
      const periods = this.periods();
      const chartType = this.chartType();
      if (!this.chart) {
        return;
      }
      // A series' shape is fixed when it is created, so a new one is a rebuild — same as a
      // new palette. Everything below happens inside it.
      if (chartType !== this.drawnType) {
        this.rebuild();
        return;
      }
      this.syncIndicators(indicators, periods);
      this.draw(series, benchmark);
      this.layoutPanes();
    });

    // Series colours are fixed when the series is created, so a new palette means starting
    // over. Untracked so this only ever fires on a theme change, never on new data.
    effect(() => {
      const palette = this.theme.chart();
      untracked(() => {
        this.palette = palette;
        if (this.chart) {
          this.rebuild();
        }
      });
    });
  }

  ngAfterViewInit(): void {
    this.createChart();
    this.syncIndicators(this.indicators(), this.periods());
    this.draw(this.series(), this.benchmark());
    this.layoutPanes();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.chart?.remove();
  }

  /**
   * Tears the whole chart down and builds it again — the way both a new palette and a new
   * price shape are applied, since series colours and series type are both fixed at creation.
   * The visible range is carried over by hand: the new time scale knows nothing about the old
   * one, and coming back to the last seventh after every theme click is jarring.
   */
  private rebuild(): void {
    const range = this.chart?.timeScale().getVisibleLogicalRange();

    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.chart?.remove();
    this.chart = undefined;
    this.plots.clear();

    const chart = this.createChart();
    this.syncIndicators(this.indicators(), this.periods());
    this.draw(this.series(), this.benchmark());
    if (range) {
      chart.timeScale().setVisibleLogicalRange(range);
    }
    this.layoutPanes();
  }

  private createChart(): IChartApi {
    const COLORS = this.palette;
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

    this.createPriceSeries(this.chart);

    this.resizeObserver = new ResizeObserver(() => this.layoutPanes());
    this.resizeObserver.observe(element);

    return this.chart;
  }

  /**
   * Builds the price in whichever shape is switched on. Each one brings its own mapping: the
   * two bar shapes are fed the whole bar, the two continuous ones only the close.
   */
  private createPriceSeries(chart: IChartApi): void {
    const COLORS = this.palette;
    const type = this.chartType();
    this.drawnType = type;

    switch (type) {
      case 'CANDLES': {
        const series = chart.addSeries(CandlestickSeries, {
          upColor: COLORS.up,
          downColor: COLORS.down,
          borderUpColor: COLORS.up,
          borderDownColor: COLORS.down,
          wickUpColor: COLORS.up,
          wickDownColor: COLORS.down,
        });
        this.setPriceData = (candles) => series.setData(candles.map(asBar));
        break;
      }

      case 'BARS': {
        // `thinBars` off: the default hairline is unreadable next to the candles it replaces.
        const series = chart.addSeries(BarSeries, {
          upColor: COLORS.up,
          downColor: COLORS.down,
          thinBars: false,
        });
        this.setPriceData = (candles) => series.setData(candles.map(asBar));
        break;
      }

      case 'LINE': {
        const series = chart.addSeries(LineSeries, {
          color: COLORS.priceLine,
          lineWidth: 2,
        });
        this.setPriceData = (candles) => series.setData(candles.map(asClose));
        break;
      }

      case 'AREA': {
        const series = chart.addSeries(AreaSeries, {
          lineColor: COLORS.priceLine,
          lineWidth: 2,
          topColor: COLORS.priceAreaTop,
          bottomColor: COLORS.priceAreaBottom,
        });
        this.setPriceData = (candles) => series.setData(candles.map(asClose));
        break;
      }
    }
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
    const COLORS = this.palette;
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

      case 'EMA20':
      case 'EMA50': {
        // A hair thinner than the SMAs: with both pairs on, the exponential ones are the
        // fast-moving pack and the simple ones stay the reference.
        const period = indicator === 'EMA20' ? periods.emaFast : periods.emaSlow;
        const series = chart.addSeries(
          LineSeries,
          {
            color: indicator === 'EMA20' ? COLORS.emaFast : COLORS.emaSlow,
            lineWidth: 1,
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
              exponentialMovingAverage(candles, period).map((point) => ({
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

      case 'RS': {
        // Thicker than the moving averages around it: this one is read on its own, as a
        // shape, not compared bar by bar against the price underneath.
        const series = chart.addSeries(
          LineSeries,
          {
            color: COLORS.rsLine,
            lineWidth: 2,
            priceScaleId: RS_SCALE_ID,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          },
          PRICE_PANE,
        );
        series.priceScale().applyOptions({ scaleMargins: RS_SCALE_MARGINS });

        return {
          series: [series],
          signature,
          setData: (candles, benchmark) =>
            series.setData(
              relativeStrengthLine(candles, benchmark).map((point) => ({
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

      case 'ATR': {
        // Unlike the RSI this one is measured in dollars, so the pane keeps its own
        // autoscaled axis: a fixed range would flatten it on cheap stocks.
        const series = chart.addSeries(
          LineSeries,
          { color: COLORS.atrLine, lineWidth: 2, priceLineVisible: false },
          nextPane,
        );

        return {
          series: [series],
          signature,
          label: this.labelPane(series, `ATR ${periods.atr}`),
          setData: (candles) =>
            series.setData(
              averageTrueRange(candles, periods.atr).map((point) => ({
                time: point.time as UTCTimestamp,
                value: point.value,
              })),
            ),
        };
      }

      case 'ADX': {
        // The DIs go in first so the ADX, which is what the pane is named after, stays on top.
        const plusDi = chart.addSeries(
          LineSeries,
          { color: COLORS.adxPlusDi, lineWidth: 1, priceLineVisible: false },
          nextPane,
        );
        const minusDi = chart.addSeries(
          LineSeries,
          { color: COLORS.adxMinusDi, lineWidth: 1, priceLineVisible: false },
          nextPane,
        );
        // All three are bounded by 0-100 but rarely climb past 60, so the axis is left to
        // autoscale instead of being pinned like the RSI: fixing it flattens every line.
        const adx = chart.addSeries(
          LineSeries,
          { color: COLORS.adxLine, lineWidth: 2, priceLineVisible: false },
          nextPane,
        );

        adx.createPriceLine({
          price: ADX_TREND_THRESHOLD,
          color: COLORS.adxTrendBand,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: '',
        });

        return {
          series: [plusDi, minusDi, adx],
          signature,
          label: this.labelPane(plusDi, `ADX ${periods.adx}`),
          setData: (candles) => {
            const points = averageDirectionalIndex(candles, periods.adx);
            plusDi.setData(
              points.map((point) => ({ time: point.time as UTCTimestamp, value: point.plusDi })),
            );
            minusDi.setData(
              points.map((point) => ({ time: point.time as UTCTimestamp, value: point.minusDi })),
            );
            // The ADX needs a second round of smoothing, so it starts later than the DIs.
            adx.setData(
              points
                .filter((point) => point.adx !== null)
                .map((point) => ({ time: point.time as UTCTimestamp, value: point.adx as number })),
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
      lines: [{ text, color: this.palette.paneLabel, fontSize: 11 }],
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

  private draw(series: CandleSeries | null, benchmark: CandleSeries | null): void {
    const candles = series?.candles ?? [];

    this.setPriceData(candles);

    for (const plot of this.plots.values()) {
      plot.setData(candles, benchmark?.candles ?? []);
    }

    // Only a genuinely new series gets framed. A toggled indicator, a new price shape or a
    // theme change redraw the same bars, and re-framing there would undo the user's scrolling.
    if (candles.length && series !== this.framedSeries) {
      const visibleBars = Math.max(1, Math.round(candles.length * INITIAL_VISIBLE_FRACTION));
      this.chart?.timeScale().setVisibleLogicalRange({
        from: candles.length - visibleBars,
        to: candles.length - 1 + RIGHT_MARGIN_BARS,
      });
    }
    this.framedSeries = series;
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
