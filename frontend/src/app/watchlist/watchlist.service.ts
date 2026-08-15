import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Watchlist } from './watchlist.models';

/** Every write returns the whole list back, so the panel repaints from one response. */
@Injectable({ providedIn: 'root' })
export class WatchlistService {
  private readonly http = inject(HttpClient);

  list(): Promise<Watchlist[]> {
    return firstValueFrom(this.http.get<Watchlist[]>('/api/watchlists'));
  }

  create(name: string): Promise<Watchlist> {
    return firstValueFrom(this.http.post<Watchlist>('/api/watchlists', { name }));
  }

  rename(id: string, name: string): Promise<Watchlist> {
    return firstValueFrom(this.http.put<Watchlist>(`/api/watchlists/${id}`, { name }));
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/watchlists/${id}`));
  }

  addEntry(id: string, symbol: string, name: string | null): Promise<Watchlist> {
    return firstValueFrom(this.http.post<Watchlist>(`/api/watchlists/${id}/entries`, { symbol, name }));
  }

  removeEntry(id: string, symbol: string): Promise<Watchlist> {
    return firstValueFrom(
      this.http.delete<Watchlist>(`/api/watchlists/${id}/entries/${encodeURIComponent(symbol)}`),
    );
  }
}
