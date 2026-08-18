import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from './auth.service';

/**
 * The whole screen while there is no session. There is no sign-up and no password recovery
 * link: accounts are created by hand, so anything else here would lead nowhere.
 */
@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="login">
      <form class="card" (ngSubmit)="submit()">
        <div class="brand">
          <span class="brand-mark">◧</span>
          <span class="brand-name">TickerLab</span>
        </div>

        <label class="field">
          <span>Usuario</span>
          <input name="username" autocomplete="username" autofocus [(ngModel)]="username" />
        </label>

        <label class="field">
          <span>Contraseña</span>
          <input
            type="password"
            name="password"
            autocomplete="current-password"
            [(ngModel)]="password"
          />
        </label>

        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }

        <button type="submit" class="submit" [disabled]="busy()">
          {{ busy() ? 'Entrando…' : 'Entrar' }}
        </button>
      </form>
    </div>
  `,
  styles: `
    .login {
      display: grid;
      place-items: center;
      min-height: 100dvh;
      padding: 1rem;
      background: var(--bg-app);
    }

    .card {
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
      /* Its own width until the screen is narrower than it, and then the screen's. */
      width: min(20rem, 100%);
      padding: 1.75rem;
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      box-shadow: 0 12px 32px var(--shadow);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      margin-bottom: 0.4rem;
      color: var(--text-strong);
      font-size: 1.15rem;
      font-weight: 600;
    }

    .brand-mark {
      color: var(--accent);
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      color: var(--text-label);
      font-size: 0.8rem;
    }

    .field input {
      padding: 0.5rem 0.6rem;
      background: var(--bg-control);
      border: 1px solid var(--border-control);
      border-radius: 6px;
      color: var(--text-input);
      font: inherit;
    }

    .field input:focus {
      outline: none;
      border-color: var(--border-focus);
    }

    .error {
      margin: 0;
      padding: 0.45rem 0.6rem;
      background: var(--danger-soft);
      border-radius: 6px;
      color: var(--text);
      font-size: 0.82rem;
    }

    .submit {
      margin-top: 0.3rem;
      padding: 0.55rem;
      background: var(--accent);
      border: 0;
      border-radius: 6px;
      color: var(--on-accent);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }

    .submit:disabled {
      opacity: 0.6;
      cursor: default;
    }
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);

  protected username = '';
  protected password = '';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.login(this.username.trim(), this.password);
    } catch {
      // Every failure reads the same on purpose: a message that separates "no such user" from
      // "wrong password" tells a stranger which half they got right.
      this.error.set('Usuario o contraseña incorrectos');
      this.password = '';
    } finally {
      this.busy.set(false);
    }
  }
}
