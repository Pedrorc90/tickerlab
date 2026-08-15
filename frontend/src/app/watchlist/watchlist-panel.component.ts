import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Watchlist } from './watchlist.models';
import { WatchlistService } from './watchlist.service';

/** What the inline text field is doing, if anything. */
type EditMode = 'create' | 'rename';

/** Which tab was open last. UI state, so it lives in the browser and not in the database. */
const ACTIVE_LIST_KEY = 'tickerlab.activeWatchlist';

@Component({
  selector: 'app-watchlist-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Pills, not a <select>: the native box would not follow a freshly created list,
         and the legend already proved pills read as pressable here. -->
    <header class="panel-head">
      @for (list of lists(); track list.id) {
        <button
          type="button"
          class="tab"
          [class.active]="list.id === active()?.id"
          [attr.aria-pressed]="list.id === active()?.id"
          (click)="select(list.id)"
        >
          {{ list.name }} <span class="tab-count">{{ list.entries.length }}</span>
        </button>
      }
      <button type="button" class="tab new" title="Nueva lista" (click)="startEdit('create')">+</button>
    </header>

    @if (active()) {
      <div class="list-actions">
        <button type="button" class="link" (click)="startEdit('rename')">Renombrar</button>
        <button type="button" class="link danger" (click)="removeList()">Borrar lista</button>
      </div>
    }

    @if (editing()) {
      <form class="editor" (submit)="$event.preventDefault(); submitEdit(box.value)">
        <input
          #box
          type="text"
          maxlength="60"
          placeholder="Nombre de la lista"
          autocomplete="off"
          [value]="editing() === 'rename' ? (active()?.name ?? '') : ''"
          (keydown.escape)="cancelEdit()"
        />
        <button type="submit" class="icon" title="Guardar">✓</button>
        <button type="button" class="icon" title="Cancelar" (click)="cancelEdit()">×</button>
      </form>
    }

    @if (error(); as message) {
      <p class="panel-error">{{ message }}</p>
    }

    <button
      type="button"
      class="add-current"
      [disabled]="!active() || holdsCurrent()"
      (click)="addCurrent()"
    >
      @if (holdsCurrent()) {
        {{ currentSymbol() }} ya está en la lista
      } @else {
        ✚ Añadir {{ currentSymbol() }}
      }
    </button>

    <ul class="entries">
      @for (entry of active()?.entries ?? []; track entry.symbol) {
        <li class="entry-row" [class.current]="entry.symbol === currentSymbol()">
          <button type="button" class="entry" (click)="selected.emit(entry.symbol)">
            <span class="entry-symbol">{{ entry.symbol }}</span>
            <span class="entry-name">{{ entry.name }}</span>
          </button>
          <button
            type="button"
            class="entry-remove"
            [title]="'Quitar ' + entry.symbol"
            (click)="removeEntry(entry.symbol)"
          >
            ×
          </button>
        </li>
      } @empty {
        <li class="empty">
          {{ active() ? 'Lista vacía. Añade el ticker del gráfico.' : 'Crea una lista con +.' }}
        </li>
      }
    </ul>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      background: var(--bg-panel);
      border-left: 1px solid var(--border);
    }

    .panel-head {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      padding: 0.5rem;
      border-bottom: 1px solid var(--border);
    }

    .tab {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.2rem 0.5rem;
      border: 1px solid var(--border-control);
      border-radius: 999px;
      background: var(--bg-control);
      color: var(--text-secondary);
      font: inherit;
      font-size: 0.75rem;
      line-height: 1.5;
      cursor: pointer;
    }

    .tab:hover {
      border-color: var(--border-focus);
      color: var(--text-strong);
    }

    .tab.active {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--on-accent);
    }

    .tab-count {
      color: inherit;
      opacity: 0.6;
      font-variant-numeric: tabular-nums;
    }

    .tab.new {
      padding: 0.2rem 0.55rem;
      border-style: dashed;
    }

    .list-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.6rem;
      padding: 0.35rem 0.6rem 0;
    }

    .link {
      border: 0;
      background: transparent;
      color: var(--text-dim);
      font: inherit;
      font-size: 0.68rem;
      text-decoration: underline;
      cursor: pointer;
    }

    .link:hover {
      color: var(--text-secondary);
    }

    .link.danger:hover {
      color: var(--chart-down);
    }

    .editor {
      display: flex;
      gap: 0.25rem;
      padding: 0.5rem;
      border-bottom: 1px solid var(--border);
    }

    .editor input {
      flex: 1;
      min-width: 0;
      padding: 0.3rem 0.4rem;
      border: 1px solid var(--border-control);
      border-radius: 4px;
      background: var(--bg-app);
      color: var(--text);
      font: inherit;
      font-size: 0.8rem;
    }

    .editor input:focus {
      border-color: var(--accent);
      outline: none;
    }

    .panel-error {
      margin: 0;
      padding: 0.4rem 0.6rem;
      background: var(--danger-soft);
      color: var(--chart-down);
      font-size: 0.72rem;
    }

    .add-current {
      margin: 0.5rem;
      padding: 0.4rem;
      border: 1px dashed var(--border-control);
      border-radius: 6px;
      background: transparent;
      color: var(--accent);
      font: inherit;
      font-size: 0.78rem;
      cursor: pointer;
    }

    .add-current:hover:not(:disabled) {
      border-color: var(--accent);
      background: var(--accent-soft);
    }

    .add-current:disabled {
      color: var(--text-dim);
      cursor: default;
    }

    .entries {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      margin: 0;
      padding: 0 0.35rem 0.5rem;
      list-style: none;
    }

    .entry-row {
      display: flex;
      align-items: center;
      border-radius: 4px;
    }

    .entry-row:hover {
      background: var(--bg-raised);
    }

    /* The ticker on the chart right now. */
    .entry-row.current {
      background: var(--accent-soft);
      box-shadow: inset 2px 0 0 var(--accent);
    }

    .entry {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0.05rem;
      flex: 1;
      min-width: 0;
      padding: 0.35rem 0.45rem;
      border: 0;
      background: transparent;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .entry-symbol {
      color: var(--text);
      font-size: 0.82rem;
      font-weight: 600;
    }

    .entry-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-dim);
      font-size: 0.7rem;
    }

    .entry-remove {
      padding: 0.1rem 0.4rem;
      border: 0;
      background: transparent;
      color: var(--border-focus);
      font: inherit;
      cursor: pointer;
    }

    .entry-remove:hover {
      color: var(--chart-down);
    }

    .empty {
      padding: 0.5rem 0.45rem;
      color: var(--text-dim);
      font-size: 0.72rem;
    }
  `,
})
export class WatchlistPanelComponent {
  /** Ticker on the chart right now: what the add button saves and what gets highlighted. */
  readonly currentSymbol = input.required<string>();
  readonly currentName = input<string | null>(null);
  readonly selected = output<string>();

  protected readonly lists = signal<Watchlist[]>([]);
  protected readonly activeId = signal<string | null>(localStorage.getItem(ACTIVE_LIST_KEY));
  protected readonly editing = signal<EditMode | null>(null);
  protected readonly error = signal<string | null>(null);

  /** Falls back to the first list so the panel is never left pointing at nothing. */
  protected readonly active = computed(() => {
    const lists = this.lists();
    return lists.find((list) => list.id === this.activeId()) ?? lists[0] ?? null;
  });

  protected readonly holdsCurrent = computed(
    () => this.active()?.entries.some((entry) => entry.symbol === this.currentSymbol()) ?? false,
  );

  private readonly editBox = viewChild<ElementRef<HTMLInputElement>>('box');
  private readonly service = inject(WatchlistService);

  constructor() {
    // The field only exists while editing, so focus has to wait for it to appear.
    effect(() => this.editBox()?.nativeElement.focus());
    // Stores `active()`, not `activeId()`: a stored id whose list is gone resolves to the
    // fallback here and gets overwritten instead of lingering.
    effect(() => {
      const id = this.active()?.id;
      if (id) {
        localStorage.setItem(ACTIVE_LIST_KEY, id);
      }
    });
    void this.reload();
  }

  protected select(id: string): void {
    this.activeId.set(id);
    this.cancelEdit();
    this.error.set(null);
  }

  protected startEdit(mode: EditMode): void {
    this.error.set(null);
    this.editing.set(mode);
  }

  protected cancelEdit(): void {
    this.editing.set(null);
  }

  protected async submitEdit(raw: string): Promise<void> {
    const name = raw.trim();
    if (!name) {
      return;
    }
    const mode = this.editing();
    const current = this.active();
    await this.run(async () => {
      const saved =
        mode === 'rename' && current
          ? await this.service.rename(current.id, name)
          : await this.service.create(name);
      this.upsert(saved);
      this.activeId.set(saved.id);
      this.editing.set(null);
    });
  }

  protected async removeList(): Promise<void> {
    const current = this.active();
    if (!current || !confirm(`¿Borrar la lista "${current.name}"?`)) {
      return;
    }
    await this.run(async () => {
      await this.service.remove(current.id);
      this.lists.update((lists) => lists.filter((list) => list.id !== current.id));
      this.activeId.set(null);
    });
  }

  protected async addCurrent(): Promise<void> {
    const current = this.active();
    if (!current) {
      return;
    }
    await this.run(async () => {
      this.upsert(await this.service.addEntry(current.id, this.currentSymbol(), this.currentName()));
    });
  }

  protected async removeEntry(symbol: string): Promise<void> {
    const current = this.active();
    if (!current) {
      return;
    }
    await this.run(async () => {
      this.upsert(await this.service.removeEntry(current.id, symbol));
    });
  }

  private async reload(): Promise<void> {
    await this.run(async () => this.lists.set(await this.service.list()));
  }

  private upsert(saved: Watchlist): void {
    this.lists.update((lists) => {
      const index = lists.findIndex((list) => list.id === saved.id);
      if (index < 0) {
        return [...lists, saved];
      }
      const next = [...lists];
      next[index] = saved;
      return next;
    });
  }

  /** Every call goes through here so a failed request always surfaces in the panel. */
  private async run(action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    try {
      await action();
    } catch (failure) {
      this.error.set(this.messageOf(failure));
    }
  }

  private messageOf(failure: unknown): string {
    if (failure instanceof HttpErrorResponse) {
      const detail = (failure.error as { error?: string } | null)?.error;
      return detail ?? (failure.status === 0 ? 'Backend no disponible.' : 'No se pudo guardar.');
    }
    return 'No se pudo guardar.';
  }
}
