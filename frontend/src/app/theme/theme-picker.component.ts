import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Theme, ThemeService } from './theme.service';

@Component({
  selector: 'app-theme-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="themes" role="group" aria-label="Tema">
      @for (theme of themes; track theme.id) {
        <button
          type="button"
          class="theme"
          [class.active]="current().id === theme.id"
          [attr.aria-pressed]="current().id === theme.id"
          [title]="'Tema ' + theme.label"
          (click)="select(theme)"
        >
          <i class="chip" [style.background]="chipOf(theme)"></i>
          {{ theme.label }}
        </button>
      }
    </div>
  `,
  styles: `
    .themes {
      display: flex;
      gap: 0.25rem;
      padding: 0.2rem;
      background: var(--bg-raised);
      border: 1px solid var(--border);
      border-radius: 6px;
    }

    .theme {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.35rem 0.7rem;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: var(--text-secondary);
      font: inherit;
      font-size: 0.85rem;
      cursor: pointer;
    }

    .theme:hover {
      color: var(--text);
    }

    .theme.active {
      background: var(--accent);
      color: var(--on-accent);
    }

    /* Half background, half candle colour: enough to tell the three palettes apart. */
    .chip {
      width: 0.65rem;
      height: 0.65rem;
      flex: none;
      border: 1px solid rgb(128 128 128 / 45%);
      border-radius: 2px;
    }

    /* Sharing the top bar's first line with three other controls at 360px: the chips are the
       choice anyway, and the label is only ever read once. Collapsing the type is what hides a
       bare text node; the chip is sized in rem and does not follow it down. */
    @media (max-width: 767px) {
      .theme {
        padding: 0.35rem 0.45rem;
        font-size: 0;
      }
    }
  `,
})
export class ThemePickerComponent {
  private readonly theme = inject(ThemeService);

  protected readonly themes = this.theme.themes;
  protected readonly current = this.theme.current;

  protected chipOf({ chart }: Theme): string {
    return `linear-gradient(135deg, ${chart.background} 50%, ${chart.up} 50%)`;
  }

  protected select(theme: Theme): void {
    this.theme.select(theme.id);
  }
}
