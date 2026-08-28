import {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import { Candle, TradeMarker } from './market.models';

/**
 * How far off the wick the label sits, in pixels. The whole reason this primitive exists:
 * the library's own markers are welded to the bar, and «Compra» printed against the candles
 * is the one thing on the chart nobody can read.
 */
const LABEL_GAP = 80;
/** Where the leader starts, so it comes off the wick instead of touching it. */
const LINE_INSET = 3;
const ARROW_HEIGHT = 8;
const ARROW_HALF_WIDTH = 5;
/** Air between the arrow and its text. */
const TEXT_GAP = 3;
const FONT = '11px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif';

/**
 * Vertical room one label needs outside the bars: the gap, the arrow and the text under it.
 * The price scale is told to reserve it, or a trade taken on the lowest bar of the window
 * gets its label cropped by the pane it hangs out of.
 */
export const TRADE_LABEL_ROOM = LABEL_GAP + ARROW_HEIGHT + TEXT_GAP + 13;

export interface TradeMarkerColors {
  buy: string;
  sell: string;
  /** The dotted leader from the label back down to its candle. */
  link: string;
}

/** A marker resolved against the bar it landed on: the wick tip it hangs off, in price. */
interface Anchor {
  time: UTCTimestamp;
  price: number;
  /** Down the screen for an entry, up for an exit. Everything below is mirrored through it. */
  direction: 1 | -1;
  color: string;
  text: string;
}

/** The same marker in screen coordinates, recomputed on every pan and zoom. */
interface Placed {
  x: number;
  y: number;
  direction: 1 | -1;
  color: string;
  text: string;
}

/**
 * The backtest's entries and exits, drawn a fixed distance off the bar with a dotted line
 * back to it. The caller still says only what happened — which bar, which side, what text —
 * and the palette decides the hue, the same contract the built-in markers had.
 */
export class TradeMarkers implements ISeriesPrimitive<Time> {
  private readonly renderer: TradeMarkersRenderer;
  /** Held so the same array comes back every call: the library caches views by reference. */
  private readonly views: readonly IPrimitivePaneView[];
  private anchors: Anchor[] = [];
  private chart?: IChartApiBase<Time>;
  private series?: ISeriesApi<SeriesType, Time>;
  private requestUpdate?: () => void;

  constructor(private readonly colors: TradeMarkerColors) {
    this.renderer = new TradeMarkersRenderer(colors.link);
    this.views = [
      {
        // Over the candles: the label is the point, and a wick drawn through it is noise.
        zOrder: () => 'top',
        renderer: () => this.renderer,
      },
    ];
  }

  /**
   * The markers, matched to the bars they fall on. A marker whose bar is not in the series —
   * a stale backtest against a timeframe that has already been swapped — is simply dropped.
   */
  setMarkers(markers: ReadonlyArray<TradeMarker>, candles: readonly Candle[]): void {
    const byTime = new Map(candles.map((candle) => [candle.time, candle]));
    this.anchors = markers.flatMap((marker) => {
      const candle = byTime.get(marker.time);
      if (!candle) {
        return [];
      }
      const buy = marker.kind === 'buy';
      return [
        {
          time: marker.time as UTCTimestamp,
          // The wick tip and not the close: the leader has to leave the bar it points at.
          price: buy ? candle.low : candle.high,
          direction: buy ? 1 : -1,
          color: buy ? this.colors.buy : this.colors.sell,
          text: marker.text,
        } as Anchor,
      ];
    });
    this.updateAllViews();
    this.requestUpdate?.();
  }

  attached(param: SeriesAttachedParameter<Time, SeriesType>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
    this.updateAllViews();
  }

  detached(): void {
    this.chart = undefined;
    this.series = undefined;
    this.requestUpdate = undefined;
  }

  updateAllViews(): void {
    const timeScale = this.chart?.timeScale();
    const series = this.series;
    if (!timeScale || !series) {
      this.renderer.place([]);
      return;
    }
    this.renderer.place(
      this.anchors.flatMap((anchor) => {
        const x = timeScale.timeToCoordinate(anchor.time);
        const y = series.priceToCoordinate(anchor.price);
        if (x === null || y === null) {
          return [];
        }
        return [{ x, y, direction: anchor.direction, color: anchor.color, text: anchor.text }];
      }),
    );
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }
}

/** The canvas target the library hands the renderer, without dragging in `fancy-canvas`. */
type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

class TradeMarkersRenderer implements IPrimitivePaneRenderer {
  private placed: readonly Placed[] = [];

  constructor(private readonly linkColor: string) {}

  place(placed: readonly Placed[]): void {
    this.placed = placed;
  }

  /**
   * Media space rather than bitmap: the text is the hard part here, and letting the library
   * hand over an already-scaled context keeps it crisp without doing the ratio maths by hand.
   */
  draw(target: RenderTarget): void {
    if (!this.placed.length) {
      return;
    }
    target.useMediaCoordinateSpace(({ context }) => {
      context.save();
      context.font = FONT;
      context.textAlign = 'center';
      context.lineWidth = 1;

      for (const marker of this.placed) {
        const { x, y, direction } = marker;
        const tip = y + direction * LABEL_GAP;
        const base = tip + direction * ARROW_HEIGHT;

        // Dotted, so it reads as a pointer back to the bar and never as a price level.
        context.beginPath();
        context.setLineDash([2, 3]);
        context.strokeStyle = this.linkColor;
        context.moveTo(x + 0.5, y + direction * LINE_INSET);
        context.lineTo(x + 0.5, tip);
        context.stroke();
        context.setLineDash([]);

        context.beginPath();
        context.fillStyle = marker.color;
        context.moveTo(x, tip);
        context.lineTo(x - ARROW_HALF_WIDTH, base);
        context.lineTo(x + ARROW_HALF_WIDTH, base);
        context.closePath();
        context.fill();

        context.textBaseline = direction === 1 ? 'top' : 'bottom';
        context.fillText(marker.text, x, base + direction * TEXT_GAP);
      }

      context.restore();
    });
  }
}
