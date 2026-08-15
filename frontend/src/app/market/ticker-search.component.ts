import { ChangeDetectionStrategy, Component, OnDestroy, inject, output, signal } from '@angular/core';
import { MarketService } from './market.service';
import { SymbolMatch } from './market.models';

/** Wait for the user to stop typing before hitting the API. */
const DEBOUNCE_MS = 250;

@Component({
  selector: 'app-ticker-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="search" (focusout)="onFocusOut($event)">
      <input
        type="text"
        class="search-input"
        placeholder="Busca una empresa o ticker (AAPL, Tesla, NVDA…)"
        autocomplete="off"
        spellcheck="false"
        [value]="query()"
        (input)="onInput($event)"
        (focus)="open.set(true)"
        (keydown.enter)="chooseFirst()"
        (keydown.escape)="open.set(false)"
      />

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
      padding: 0.55rem 0.85rem;
      border: 1px solid #2a2e39;
      border-radius: 6px;
      background: #1c2030;
      color: #e6e8ed;
      font-size: 0.9rem;
      font-family: inherit;
    }

    .search-input:focus {
      outline: none;
      border-color: #4c7dff;
    }

    .search-input::placeholder {
      color: #6b7280;
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
      background: #1c2030;
      border: 1px solid #2a2e39;
      border-radius: 6px;
      box-shadow: 0 12px 28px rgb(0 0 0 / 45%);
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
      color: #e6e8ed;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .result:hover {
      background: #262b3d;
    }

    .symbol {
      font-weight: 600;
      color: #4c7dff;
    }

    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.85rem;
    }

    .exchange,
    .hint {
      color: #6b7280;
      font-size: 0.75rem;
    }

    .hint {
      padding: 0.45rem 0.5rem;
    }
  `,
})
export class TickerSearchComponent implements OnDestroy {
  readonly selected = output<string>();

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
