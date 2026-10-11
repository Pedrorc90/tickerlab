import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MarketService } from './market.service';
import { SymbolMatch } from './market.models';

/** Wait for the user to stop typing before hitting the API. */
const DEBOUNCE_MS = 250;

@Component({
  selector: 'app-ticker-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onGlobalKey($event)' },
  template: `
    <div class="search" (focusout)="onFocusOut($event)">
      <input
        #field
        type="text"
        class="search-input"
        placeholder="Buscar empresa o ticker"
        autocomplete="off"
        spellcheck="false"
        [value]="query()"
        (input)="onInput($event)"
        (focus)="open.set(true)"
        (keydown.enter)="chooseFirst()"
        (keydown.escape)="open.set(false)"
      />
      <kbd class="shortcut" aria-hidden="true">{{ shortcut }}</kbd>

      @if (open() && (matches().length || loading())) {
        <ul class="results">
          @if (loading() && !matches().length) {
            <li class="hint">Buscando…</li>
          }
          @for (match of matches(); track match.symbol) {
            <li>
              <button type="button" class="result" (click)="choose(match)">
                <span class="symbol">{{ match.symbol }}</span>
                <span class="name">{{ match.name }}</span>
                <span class="exchange">{{ match.exchange }}</span>
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .search {
      position: relative;
      width: 100%;
    }

    .search-input {
      width: 100%;
      padding: 0.55rem 3.4rem 0.55rem 2.2rem;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--bg-raised) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%239a8f80' stroke-width='1.5' stroke-linecap='round'%3E%3Ccircle cx='7' cy='7' r='4.5'/%3E%3Cpath d='M10.5 10.5L14 14'/%3E%3C/svg%3E") no-repeat 0.75rem center / 1rem;
      color: var(--text);
      font-size: 0.9rem;
      font-family: inherit;
    }

    .search-input:focus {
      outline: none;
      border-color: var(--accent);
    }

    .search-input::placeholder {
      color: var(--text-dim);
    }

    .shortcut {
      position: absolute;
      top: 50%;
      right: 0.6rem;
      transform: translateY(-50%);
      padding: 0.1rem 0.4rem;
      border: 1px solid var(--border-control);
      border-radius: 6px;
      background: var(--bg-control);
      color: var(--text-dim);
      font: inherit;
      font-size: 0.7rem;
      pointer-events: none;
    }

    .search-input:focus ~ .shortcut {
      display: none;
    }

    .results {
      position: absolute;
      z-index: 20;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      max-height: 20rem;
      overflow-y: auto;
      margin: 0;
      padding: 0.25rem;
      list-style: none;
      background: var(--bg-raised);
      border: 1px solid var(--border);
      border-radius: 6px;
      box-shadow: 0 12px 28px var(--shadow);
    }

    .result {
      display: grid;
      grid-template-columns: 4.5rem 1fr auto;
      gap: 0.6rem;
      align-items: baseline;
      width: 100%;
      padding: 0.45rem 0.5rem;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: var(--text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .result:hover {
      background: var(--bg-control-hover);
    }

    .symbol {
      font-weight: 600;
      color: var(--accent);
    }

    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.85rem;
    }

    .exchange,
    .hint {
      color: var(--text-dim);
      font-size: 0.75rem;
    }

    .hint {
      padding: 0.45rem 0.5rem;
    }
  `,
})
export class TickerSearchComponent implements OnDestroy {
  readonly selected = output<string>();

  protected readonly shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  protected readonly query = signal('');
  protected readonly matches = signal<SymbolMatch[]>([]);
  protected readonly loading = signal(false);
  protected readonly open = signal(false);

  private readonly market = inject(MarketService);
  private debounceHandle?: ReturnType<typeof setTimeout>;
  /** Guards against a slow early response overwriting a newer one. */
  private requestId = 0;

  ngOnDestroy(): void {
    clearTimeout(this.debounceHandle);
  }

  /** Cmd/Ctrl+K from anywhere on the page jumps to the box. */
  protected onGlobalKey(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.field().nativeElement.focus();
      this.field().nativeElement.select();
    }
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);
    this.open.set(true);
    clearTimeout(this.debounceHandle);

    if (!value.trim()) {
      this.matches.set([]);
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.debounceHandle = setTimeout(() => this.runSearch(value.trim()), DEBOUNCE_MS);
  }

  protected choose(match: SymbolMatch): void {
    this.query.set(match.symbol);
    this.matches.set([]);
    this.open.set(false);
    this.selected.emit(match.symbol);
  }

  protected chooseFirst(): void {
    const first = this.matches()[0];
    if (first) {
      this.choose(first);
    }
  }

  /** Closes the dropdown only when focus leaves the whole widget, not between its children. */
  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (!next || !(event.currentTarget as HTMLElement).contains(next)) {
      this.open.set(false);
    }
  }

  private async runSearch(term: string): Promise<void> {
    const id = ++this.requestId;
    try {
      const results = await this.market.searchSymbols(term);
      if (id === this.requestId) {
        this.matches.set(results);
      }
    } catch {
      if (id === this.requestId) {
        this.matches.set([]);
      }
    } finally {
      if (id === this.requestId) {
        this.loading.set(false);
      }
    }
  }
}
