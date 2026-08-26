import {
  CustomData,
  CustomSeriesOptions,
  CustomSeriesPricePlotValues,
  CustomSeriesWhitespaceData,
  ICustomSeriesPaneRenderer,
  ICustomSeriesPaneView,
  PaneRendererCustomData,
  PriceToCoordinateConverter,
  Time,
  customSeriesDefaultOptions,
} from 'lightweight-charts';

/** One bar of the band. A bar with no cloud is fed as whitespace: `{ time }` and nothing else. */
export interface CloudData extends CustomData<Time> {
  spanA: number;
  spanB: number;
}

export interface CloudSeriesOptions extends CustomSeriesOptions {
  /** Fill for the stretch where `spanA` runs above `spanB`, and for the stretch below it. */
  upFill: string;
  downFill: string;
}

/** The canvas target the library hands the renderer, without dragging in `fancy-canvas`. */
type RenderTarget = Parameters<ICustomSeriesPaneRenderer['draw']>[0];

/** A bar's two spans in bitmap coordinates. */
interface Edge {
  x: number;
  a: number;
  b: number;
}

/**
 * The kumo: the area between the two leading spans, filled. lightweight-charts has no way to
 * shade between two series, so the band is a series of its own — the two lines that bound it
 * are still ordinary line series drawn on top.
 *
 * It goes in before the lines and after the candles, which means it is painted over them:
 * the fills have to stay translucent or the price disappears underneath.
 */
export class CloudSeries implements ICustomSeriesPaneView<Time, CloudData, CloudSeriesOptions> {
  private readonly paneRenderer = new CloudRenderer();

  renderer(): ICustomSeriesPaneRenderer {
    return this.paneRenderer;
  }

  update(
    data: PaneRendererCustomData<Time, CloudData>,
    seriesOptions: CloudSeriesOptions,
  ): void {
    this.paneRenderer.update(data, seriesOptions);
  }

  /** Both edges, so the price scale keeps the whole band in view. */
  priceValueBuilder(plotRow: CloudData): CustomSeriesPricePlotValues {
    return [plotRow.spanB, plotRow.spanA];
  }

  isWhitespace(
    data: CloudData | CustomSeriesWhitespaceData<Time>,
  ): data is CustomSeriesWhitespaceData<Time> {
    return (data as CloudData).spanA === undefined;
  }

  defaultOptions(): CloudSeriesOptions {
    return {
      ...customSeriesDefaultOptions,
      upFill: 'rgba(74, 222, 128, 0.14)',
      downFill: 'rgba(248, 113, 113, 0.14)',
      priceLineVisible: false,
      lastValueVisible: false,
    };
  }

  destroy(): void {
    // Nothing held: the renderer only ever points at data the chart owns.
  }
}

class CloudRenderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, CloudData> | null = null;
  private options: CloudSeriesOptions | null = null;

  update(
    data: PaneRendererCustomData<Time, CloudData>,
    options: CloudSeriesOptions,
  ): void {
    this.data = data;
    this.options = options;
  }

  draw(target: RenderTarget, priceToCoordinate: PriceToCoordinateConverter): void {
    const data = this.data;
    const options = this.options;
    if (!data?.visibleRange || !options) {
      return;
    }

    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      // One bar past each end of the visible range, or the band would stop short of the
      // edges and leave a gap where the chart is still showing cloud.
      const from = Math.max(0, data.visibleRange!.from - 1);
      const to = Math.min(data.bars.length - 1, data.visibleRange!.to + 1);

      for (let i = from; i < to; i++) {
        const left = toEdge(data.bars[i], horizontalPixelRatio, verticalPixelRatio, priceToCoordinate);
        const right = toEdge(
          data.bars[i + 1],
          horizontalPixelRatio,
          verticalPixelRatio,
          priceToCoordinate,
        );
        if (!left || !right) {
          continue;
        }

        // Measured on screen, where down is up: a positive gap means `spanA` is drawn above
        // `spanB`, which is the bullish cloud.
        const leftGap = left.b - left.a;
        const rightGap = right.b - right.a;
        const leftFill = leftGap >= 0 ? options.upFill : options.downFill;

        if (leftGap * rightGap >= 0) {
          fillQuad(context, left, right, leftFill);
          continue;
        }

        // The spans cross inside this bar — the twist every Ichimoku reader looks for. Both
        // halves are drawn separately so the colour changes exactly where they meet.
        const ratio = leftGap / (leftGap - rightGap);
        const cross: Edge = {
          x: left.x + ratio * (right.x - left.x),
          a: left.a + ratio * (right.a - left.a),
          b: left.a + ratio * (right.a - left.a),
        };
        fillQuad(context, left, cross, leftFill);
        fillQuad(context, cross, right, rightGap >= 0 ? options.upFill : options.downFill);
      }
    });
  }
}

function toEdge(
  bar: PaneRendererCustomData<Time, CloudData>['bars'][number] | undefined,
  horizontalPixelRatio: number,
  verticalPixelRatio: number,
  priceToCoordinate: PriceToCoordinateConverter,
): Edge | null {
  const point = bar?.originalData;
  if (!point || point.spanA === undefined || point.spanB === undefined) {
    return null;
  }
  const a = priceToCoordinate(point.spanA);
  const b = priceToCoordinate(point.spanB);
  if (a === null || b === null) {
    return null;
  }
  return {
    x: bar!.x * horizontalPixelRatio,
    a: a * verticalPixelRatio,
    b: b * verticalPixelRatio,
  };
}

function fillQuad(
  context: CanvasRenderingContext2D,
  left: Edge,
  right: Edge,
  color: string,
): void {
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(left.x, left.a);
  context.lineTo(right.x, right.a);
  context.lineTo(right.x, right.b);
  context.lineTo(left.x, left.b);
  context.closePath();
  context.fill();
}
