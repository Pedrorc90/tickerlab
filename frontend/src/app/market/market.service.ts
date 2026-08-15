import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CandleSeries, SymbolMatch, Timeframe } from './market.models';

@Injectable({ providedIn: 'root' })
export class MarketService {
  private readonly http = inject(HttpClient);

  searchSymbols(query: string): Promise<SymbolMatch[]> {
    return firstValueFrom(this.http.get<SymbolMatch[]>('/api/symbols', { params: { q: query } }));
  }

  loadCandles(symbol: string, timeframe: Timeframe): Promise<CandleSeries> {
    return firstValueFrom(
      this.http.get<CandleSeries>(`/api/candles/${encodeURIComponent(symbol)}`, {
        params: { timeframe },
      }),
    );
  }
}
