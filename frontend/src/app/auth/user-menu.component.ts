import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { Theme, ThemeService } from '../theme/theme.service';

/** Where the menu hangs, in viewport coordinates. See `toggle`. */
interface Anchor {
  top: number;
  right: number;
}

/** Header, both themes and the exit row. Only used to keep the menu on a short screen. */
const MENU_HEIGHT = 200;

/**
 * The two controls nobody is looking for — who is signed in, and how the app is painted —
 * behind the one button they belong to. The top bar already carries four groups that reshape
 * the chart; the theme pills were the only thing up there that had nothing to do with it.
 */
@Component({
  selector: 'app-user-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Same rule the screener's add menu follows: a click anywhere else dismisses it, and the
    // menu stops its own clicks from reaching the document.
    '(document:click)': 'close()',
    '(document:keydown.escape)': 'close()',
  },
  template: `
    <button
      type="button"
      class="user-button"
      [class.open]="anchor() !== null"
      aria-haspopup="menu"
      [attr.aria-expanded]="anchor() !== null"
      [title]="username()"
      (click)="toggle($event)"
    >
      <span class="avatar" aria-hidden="true">{{ initial() }}</span>
      <span class="user-name">{{ username() }}</span>
      <svg class="caret" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 6.5l4 3.5 4-3.5" />
      </svg>
    </button>

    <!-- Hung in viewport coordinates: the shell clips what overflows it, so an absolutely
         positioned menu would be cut off at the bottom of the bar. -->
    @if (anchor(); as at) {
      <div
        class="menu"
        role="menu"
        [style.top.px]="at.top"
        [style.right.px]="at.right"
        (click)="$event.stopPropagation()"
      >
        <div class="menu-head">
          <span class="menu-user">{{ username() }}</span>
          <span class="menu-note">Sesión iniciada</span>
        </div>

        <p class="menu-title">Tema</p>
        @for (theme of themes; track theme.id) {
          <button
            type="button"
            class="menu-item"
            role="menuitemradio"
            [attr.aria-checked]="current().id === theme.id"
            (click)="selectTheme(theme)"
          >
            <i class="chip" [style.background]="chipOf(theme)"></i>
            <span class="menu-label">{{ theme.label }}</span>
            @if (current().id === theme.id) {
              <span class="menu-mark" aria-hidden="true">✓</span>
            }
          </button>
        }

        <button type="button" class="menu-item exit" role="menuitem" (click)="auth.logout()">
          Salir
        </button>
      </div>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
    }

    .user-button {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.3rem 0.5rem 0.3rem 0.3rem;
      background: transparent;
      border: 1px solid var(--border-control);
      border-radius: 6px;
      color: var(--text-secondary);
      font: inherit;
      font-size: 0.85rem;
      cursor: pointer;
    }

    .user-button:hover,
    .user-button.open {
      background: var(--bg-control-hover);
      color: var(--text);
    }

    /* One letter is enough to say whose session this is, and it is what survives on a phone
       when the name goes. */
    .avatar {
      display: grid;
      width: 1.35rem;
      height: 1.35rem;
      flex: none;
      place-items: center;
      border-radius: 50%;
      background: var(--accent);
      color: var(--on-accent);
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .user-name {
      max-width: 8rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .caret {
      width: 0.7rem;
      height: 0.7rem;
      flex: none;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: transform 0.12s ease;
    }

    .user-button.open .caret {
      transform: rotate(180deg);
    }

    .menu {
      position: fixed;
      z-index: 20;
      display: grid;
      width: 11rem;
      gap: 0.1rem;
      padding: 0.35rem;
      border: 1px solid var(--border-control);
      border-radius: 6px;
      background: var(--bg-raised);
      box-shadow: 0 6px 20px var(--shadow);
    }

    .menu-head {
      display: grid;
      gap: 0.1rem;
      padding: 0.3rem 0.4rem 0.4rem;
      border-bottom: 1px solid var(--border);
    }

    .menu-user {
      overflow: hidden;
      color: var(--text);
      font-size: 0.82rem;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .menu-note {
      color: var(--text-dim);
      font-size: 0.68rem;
    }

    .menu-title {
      margin: 0;
      padding: 0.4rem 0.4rem 0.2rem;
      color: var(--text-dim);
      font-size: 0.68rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .menu-item {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.35rem 0.4rem;
      border: 0;
      border-radius: 4px;
      background: none;
      color: var(--text-secondary);
      font: inherit;
      font-size: 0.78rem;
      text-align: left;
      cursor: pointer;
    }

    .menu-item:hover {
      background: var(--accent-soft);
      color: var(--text);
    }

    .menu-label {
      flex: 1;
    }

    .menu-mark {
      color: var(--accent);
    }

    /* Half background, half candle colour: enough to tell the palettes apart. */
    .chip {
      width: 0.65rem;
      height: 0.65rem;
      flex: none;
      border: 1px solid rgb(128 128 128 / 45%);
      border-radius: 2px;
    }

    .exit {
      margin-top: 0.25rem;
      padding-top: 0.45rem;
      border-top: 1px solid var(--border);
      border-radius: 0 0 4px 4px;
    }

    .exit:hover {
      background: var(--danger-soft);
    }

    /* The name goes and the avatar stays: there is one user on a phone and they opened the app.
       The menu says the name in full the moment it opens. */
    @media (max-width: 767px) {
      .user-name {
        display: none;
      }
    }
  `,
})
export class UserMenuComponent {
  protected readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);

  protected readonly themes = this.theme.themes;
  protected readonly current = this.theme.current;

  protected readonly username = computed(() => this.auth.user()?.username ?? '');
  protected readonly initial = computed(() => this.username().slice(0, 1));

  /** Null while closed; the coordinates it hangs at while open. */
  protected readonly anchor = signal<Anchor | null>(null);

  protected toggle(event: MouseEvent): void {
    event.stopPropagation();
    if (this.anchor()) {
      this.close();
      return;
    }
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.anchor.set({
      top: Math.max(8, Math.min(box.bottom + 4, window.innerHeight - MENU_HEIGHT)),
      right: Math.max(8, window.innerWidth - box.right),
    });
  }

  protected close(): void {
    this.anchor.set(null);
  }

  /** Picking a theme closes the menu: the whole app repaints, and the answer is on screen. */
  protected selectTheme(theme: Theme): void {
    this.theme.select(theme.id);
    this.close();
  }

  protected chipOf({ chart }: Theme): string {
    return `linear-gradient(135deg, ${chart.background} 50%, ${chart.up} 50%)`;
  }
}
