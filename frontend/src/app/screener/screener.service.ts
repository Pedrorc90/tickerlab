import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Filters, PAGE_SIZE, RefreshResult, ScreenerPage, SortField } from './screener.models';

@Injectable({ providedIn: 'root' })
export class ScreenerService {
  private readonly http = inject(HttpClient);

  /** Empty filters are left out of the query so the backend reads them as "no filter". */
  search(filters: Filters, page: number, sort: SortField, descending: boolean): Promise<ScreenerPage> {
    let params = new HttpParams()
      .set('page', page)
      .set('size', PAGE_SIZE)
      .set('sort', sort)
      .set('desc', descending);
    if (filters.query.trim()) {
      params = params.set('q', filters.query.trim());
    }
    if (filters.exchange) {
      params = params.set('exchange', filters.exchange);
    }
    // Every numeric bound shares the same shape, and its name is already the query
    // parameter the backend expects.
    for (const [name, value] of Object.entries(filters)) {
      if (typeof value === 'number') {
        params = params.set(name, value);
      }
    }
    return firstValueFrom(this.http.get<ScreenerPage>('/api/screener/symbols', { params }));
  }

  /** Starts a quote sweep. Returns without waiting for it: the table polls instead. */
  refreshQuotes(): Promise<{ started: boolean }> {
    return firstValueFrom(this.http.post<{ started: boolean }>('/api/screener/quotes/refresh', {}));
  }

  exchanges(): Promise<string[]> {
    return firstValueFrom(this.http.get<string[]>('/api/screener/exchanges'));
  }

  /** Downloads the Nasdaq Trader files and rewrites the universe. Takes a few seconds. */
  refresh(): Promise<RefreshResult> {
    return firstValueFrom(this.http.post<RefreshResult>('/api/screener/refresh', {}));
  }
}
