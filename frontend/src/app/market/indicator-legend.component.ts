import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import {
  INDICATORS,
  Indicator,
  IndicatorPeriods,
  PeriodParam,
  periodSuffix,
} from './market.models';

/** What a period edit reports back: the param that moved and where it landed after clamping. */
export interface PeriodChange {
  readonly param: PeriodParam;
  readonly value: number;
}

/**
 * The legend is the control panel of the chart: one pill per indicator that switches its pane
 * on and off, plus a popover to move its periods. It carries its own popover state so two
 * legends can be on screen at once (the chart screen and the screener detail) without one
 * closing the other's popover.
 */
@Component({
  selector: 'app-indicator-legend',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Clicking anywhere else dismisses an open period popover; the popover itself stops
  // the event before it gets here.
  host: { '(document:click)': 'openPopover.set(null)' },
  template: `
    <aside class="indicators" aria-label="Indicadores">
      <div class="indicators-head">
        <span class="indicators-title">Indicadores</span>
        <button
          type="button"
          class="hints-toggle"
          [class.on]="showHints()"
          [attr.aria-pressed]="showHints()"
          [title]="showHints() ? 'Ocultar descripciones' : 'Mostrar descripciones'"
          (click)="hintsToggled.emit()"
        >
          ?
        </button>
      </div>

      @for (indicator of indicators; track indicator.value) {
        <span class="indicator-row">
          <span class="indicator-controls">
            <button
              type="button"
              class="legend-toggle"
              [class.off]="!visible().has(indicator.value)"
              [attr.aria-pressed]="visible().has(indicator.value)"
              [title]="
                visible().has(indicator.value)
                  ? 'Ocultar ' + indicator.label
                  : 'Mostrar ' + indicator.label
              "
              (click)="toggled.emit(indicator.value)"
            >
              <i class="swatch {{ indicator.swatch }}"></i>
              {{ labelOf(indicator.label, indicator.params) }}
            </button>
            @if (indicator.params.length) {
              <button
                type="button"
                class="legend-config"
                [class.open]="openPopover() === indicator.value"
                [attr.aria-expanded]="openPopover() === indicator.value"
                [title]="'Ajustar periodos de ' + indicator.label"
                (click)="$event.stopPropagation(); togglePopover(indicator.value)"
              >
                ▾
              </button>
            }
          </span>

          @if (openPopover() === indicator.value) {
            <div class="period-popover" (click)="$event.stopPropagation()">
              @for (param of indicator.params; track param.key) {
                <label class="period-field">
                  {{ param.label }}
                  <input
                    #box
                    type="number"
                    [min]="param.min"
                    [max]="param.max"
                    [value]="periods()[param.key]"
                    (click)="$event.stopPropagation()"
                    (change)="box.value = setPeriod(param, box.value)"
                  />
                </label>
              }
            </div>
          }

          @if (showHints()) {
            <small class="indicator-hint">{{ indicator.hint }}</small>
          }
        </span>
      }
    </aside>
  `,
  styles: `
    /* The aside is the grid child, so the host gets out of the way. */
    :host {
      display: contents;
    }

    .indicators {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      padding: 0.6rem 0.75rem;
      overflow-y: auto;
      background: var(--bg-panel);
      border-right: 1px solid var(--border);
      color: var(--text-dim);
      font-size: 0.72rem;
    }

    .indicators-head {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      color: var(--text-label);
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .indicators-title {
      flex: 1;
    }

    /* Shows and hides every description at once. */
    .hints-toggle {
      width: 1.25rem;
      height: 1.25rem;
      flex: none;
      border: 1px solid var(--border-control);
      border-radius: 999px;
      background: var(--bg-control);
      color: var(--text-dim);
      font: inherit;
      line-height: 1;
      cursor: pointer;
      transition:
        background 0.15s ease,
        color 0.15s ease;
    }

    .hints-toggle:hover {
      color: var(--text-strong);
    }

    .hints-toggle.on {
      border-color: var(--accent);
      color: var(--accent);
    }

    .indicator-row {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      /* Anchors the period popover to this row. */
      position: relative;
    }

    .indicator-controls {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    .indicator-hint {
      color: var(--text-dim);
      font-size: 0.68rem;
      line-height: 1.35;
    }

    /* Sits flush against its pill so the pair reads as one control. */
    .legend-config {
      padding: 0.15rem 0.35rem;
      border: 1px solid var(--border-control);
      border-radius: 999px;
      background: var(--bg-control);
      color: var(--text-dim);
      font: inherit;
      line-height: 1.5;
      cursor: pointer;
      transition:
        background 0.15s ease,
        color 0.15s ease;
    }

    .legend-config:hover,
    .legend-config.open {
      background: var(--bg-control-hover);
      color: var(--text-strong);
    }

    /* Opens over the chart, to the right: the panel itself is too narrow to hold it. */
    .period-popover {
      position: absolute;
      top: 100%;
      left: 0.5rem;
      z-index: 10;
      display: grid;
      gap: 0.4rem;
      padding: 0.6rem;
      border: 1px solid var(--border-control);
      border-radius: 6px;
      background: var(--bg-raised);
      box-shadow: 0 6px 20px var(--shadow);
      cursor: default;
    }

    .period-field {
      display: grid;
      grid-template-columns: 4rem 4.5rem;
      align-items: center;
      gap: 0.5rem;
      color: var(--text-label);
      white-space: nowrap;
    }

    .period-field input {
      padding: 0.2rem 0.4rem;
      border: 1px solid var(--border-control);
      border-radius: 4px;
      background: var(--bg-app);
      color: var(--text-input);
      font: inherit;
    }

    .period-field input:focus {
      border-color: var(--border-focus);
      outline: none;
    }

    .legend-toggle {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      flex: 1;
      padding: 0.15rem 0.55rem;
      border: 1px solid var(--border-control);
      border-radius: 999px;
      background: var(--bg-control);
      color: var(--text-input);
      font: inherit;
      line-height: 1.5;
      cursor: pointer;
      transition:
        background 0.15s ease,
        border-color 0.15s ease,
        color 0.15s ease;
    }

    .legend-toggle:hover {
      border-color: var(--border-focus);
      color: var(--text-strong);
    }

    /* Switched off: still readable, clearly inactive. */
    .legend-toggle.off {
      border-style: dashed;
      background: transparent;
      color: var(--text-dim);
      text-decoration: line-through;
    }

    .legend-toggle.off .swatch {
      filter: grayscale(1);
      opacity: 0.6;
    }

    .swatch {
      width: 0.65rem;
      height: 0.65rem;
      flex: none;
      border-radius: 2px;
    }

    /* --chart-* comes from the theme service: same strings the chart itself draws with. */
    .swatch.volume {
      background: var(--chart-volume-up);
    }

    .swatch.rsi {
      background: linear-gradient(180deg, var(--chart-rsi-strong) 50%, var(--chart-rsi-weak) 50%);
    }

    .swatch.sma50 {
      background: var(--chart-sma-fast);
    }

    .swatch.sma200 {
      background: var(--chart-sma-slow);
    }

    .swatch.ema20 {
      background: var(--chart-ema-fast);
    }

    .swatch.ema50 {
      background: var(--chart-ema-slow);
    }

    .swatch.bollinger {
      background: linear-gradient(
        180deg,
        var(--chart-bollinger-band) 30%,
        var(--chart-bollinger-basis) 30% 70%,
        var(--chart-bollinger-band) 70%
      );
    }

    .swatch.rs {
      background: var(--chart-rs-line);
    }

    .swatch.macd {
      background: linear-gradient(90deg, var(--chart-macd-line) 50%, var(--chart-macd-signal) 50%);
    }

    .swatch.atr {
      background: var(--chart-atr-line);
    }

    .swatch.adx {
      background: linear-gradient(
        90deg,
        var(--chart-adx-plus-di) 33%,
        var(--chart-adx-line) 33% 66%,
        var(--chart-adx-minus-di) 66%
      );
    }

    /* On a phone the legend appears in two shapes, and neither is the docked column. As the
       chart screen's sheet it is a list that slides up; inside the screener detail, where there
       is no sheet to open, it is a strip of pills over the candles that scrolls sideways. */
    @media (max-width: 767px) {
      .indicators {
        flex-direction: row;
        /* Wrapping and not a strip that scrolls sideways: a lateral drag over a single line
           is a gesture nobody goes looking for, so half the indicators were simply gone. The
           eleven pills take three lines at 360px, and the chart under them is guaranteed its
           20rem either way. */
        flex-wrap: wrap;
        align-items: center;
        gap: 0.4rem;
        padding: 0.4rem 0.6rem;
        overflow: visible;
        border-right: 0;
        border-bottom: 1px solid var(--border);
      }

      /* Every pill keeps its full width and the row scrolls, rather than each one shrinking
         until its periods are unreadable. */
      .indicator-row {
        flex: none;
      }

      /* The strip is one line tall: a description under each pill would make it four. */
      .indicators-head,
      .indicator-hint {
        display: none;
      }

      /* The sheet, on the other hand, has the height to be what it is on a desktop. A column
         rather than a block: the shell caps the host's height, and only a flex child with a
         floor of zero shrinks under that cap far enough to scroll instead of overflowing. */
      :host(.pane) {
        display: flex;
        flex-direction: column;
      }

      :host(.pane) .indicators {
        flex: 1;
        flex-direction: column;
        /* The strip above wraps; a column that also wraps is the reason the sheet would not
           scroll — the pills spill into a second and a third column sideways instead of
           overflowing downwards, so there is no vertical overflow left for a finger to drag. */
        flex-wrap: nowrap;
        align-items: stretch;
        gap: 0.55rem;
        min-height: 0;
        padding: 0.6rem 0.75rem;
        overflow-x: hidden;
        overflow-y: auto;
        /* The sheet keeps the gesture: without this a drag that finds no more list to move
           carries on into the page under it, and what the finger ends up scrolling is the
           chart. `pan-y` says the same thing to the browser before the drag even starts, so
           the chart's own touch handling never gets a look at it. */
        overscroll-behavior: contain;
        touch-action: pan-y;
        border-bottom: 0;
      }

      :host(.pane) .indicators-head,
      :host(.pane) .indicator-hint {
        display: revert;
      }

      :host(.pane) .indicators-head {
        display: flex;
      }
    }
  `,
})
export class IndicatorLegendComponent {
  protected readonly indicators = INDICATORS;

  readonly visible = input.required<ReadonlySet<Indicator>>();
  readonly periods = input.required<IndicatorPeriods>();
  readonly showHints = input(true);

  readonly toggled = output<Indicator>();
  readonly hintsToggled = output<void>();
  readonly periodChanged = output<PeriodChange>();

  /** Which pill has its period popover open, if any. */
  protected readonly openPopover = signal<Indicator | null>(null);

  /** `SMA 50`, `MACD 12/26/9`, plain `Volumen` — whatever the pill has to say right now. */
  protected labelOf(label: string, params: ReadonlyArray<PeriodParam>): string {
    const suffix = periodSuffix(params, this.periods());
    return suffix ? `${label} ${suffix}` : label;
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
    this.periodChanged.emit({ param, value });
    return `${value}`;
  }
}
