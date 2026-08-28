import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Order, OrderSide, Portfolio } from './portfolio.models';

/** Which portfolio was open last. UI state, so it lives in the browser and not in the database. */
const ACTIVE_KEY = 'tickerlab.activePortfolio';

/**
 * Every write returns the whole portfolio back, so the panel repaints from one response — the
 * same contract as `WatchlistService`.
 *
 * <p>Note what `execute` does not send: a price. The client asks for units of a symbol and the
 * server decides what they cost. A price chosen in the browser is a price chosen after seeing
 * the chart, which is the self-deception this screen exists to avoid.
 */
@Injectable({ providedIn: 'root' })
export class PortfolioService {
  private readonly http = inject(HttpClient);

  /**
   * Which portfolio is open. It lives here and not inside the panel because the chart screen
   * draws the fills of this same portfolio: two copies of "which one" is exactly how the
   * watchlists ended up being read twice.
   */
  readonly activeId = signal<string | null>(localStorage.getItem(ACTIVE_KEY));

  /**
   * Bumped on every fill. The chart screen watches it to redraw its markers — without it, an
   * order placed on the portfolio screen would only show up after changing ticker.
   */
  readonly revision = signal(0);

  setActive(id: string | null): void {
    this.activeId.set(id);
    if (id) {
      localStorage.setItem(ACTIVE_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_KEY);
    }
  }

  list(): Promise<Portfolio[]> {
    return firstValueFrom(this.http.get<Portfolio[]>('/api/portfolios'));
  }

  create(name: string, initialCash: number | null): Promise<Portfolio> {
    return firstValueFrom(this.http.post<Portfolio>('/api/portfolios', { name, initialCash }));
  }

  rename(id: string, name: string): Promise<Portfolio> {
    return firstValueFrom(this.http.put<Portfolio>(`/api/portfolios/${id}`, { name }));
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/portfolios/${id}`));
  }

  async execute(
    id: string,
    symbol: string,
    name: string | null,
    side: OrderSide,
    quantity: number,
  ): Promise<Portfolio> {
    const saved = await firstValueFrom(
      this.http.post<Portfolio>(`/api/portfolios/${id}/orders`, { symbol, name, side, quantity }),
    );
    this.revision.update((value) => value + 1);
    return saved;
  }

  orders(id: string): Promise<Order[]> {
    return firstValueFrom(this.http.get<Order[]>(`/api/portfolios/${id}/orders`));
  }

  /** The fills of one symbol, oldest first, for drawing them on that symbol's chart. */
  ordersFor(id: string, symbol: string): Promise<Order[]> {
    return firstValueFrom(
      this.http.get<Order[]>(`/api/portfolios/${id}/orders`, { params: { symbol } }),
    );
  }
}
