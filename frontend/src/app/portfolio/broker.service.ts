import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Broker, BrokerAccount, ImportResult, Transaction } from './broker.models';

/** Which real account was open last. UI state, so it lives in the browser and not the database. */
const ACTIVE_KEY = 'tickerlab.activeBrokerAccount';

/** Which half of Cartera was open last: the paper portfolios, or the real accounts. */
const TAB_KEY = 'tickerlab.portfolioTab';

export type PortfolioTab = 'paper' | 'real';

/**
 * Real accounts, filled by importing broker statements.
 *
 * <p>Note what is missing next to `PortfolioService`: there is no `execute`. Nothing here is ever
 * written by hand — a real account only changes when a statement says it did, which is the whole
 * reason it is kept apart from the paper portfolios rather than being one more of them.
 */
@Injectable({ providedIn: 'root' })
export class BrokerService {
  private readonly http = inject(HttpClient);

  readonly activeId = signal<string | null>(localStorage.getItem(ACTIVE_KEY));

  /** Paper or real. Here and not inside the panel so the choice survives leaving the screen. */
  readonly tab = signal<PortfolioTab>(
    localStorage.getItem(TAB_KEY) === 'real' ? 'real' : 'paper',
  );

  setActive(id: string | null): void {
    this.activeId.set(id);
    if (id) {
      localStorage.setItem(ACTIVE_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_KEY);
    }
  }

  setTab(tab: PortfolioTab): void {
    this.tab.set(tab);
    localStorage.setItem(TAB_KEY, tab);
  }

  list(): Promise<BrokerAccount[]> {
    return firstValueFrom(this.http.get<BrokerAccount[]>('/api/broker/accounts'));
  }

  create(name: string, broker: Broker): Promise<BrokerAccount> {
    return firstValueFrom(
      this.http.post<BrokerAccount>('/api/broker/accounts', { name, broker }),
    );
  }

  rename(id: string, name: string, broker: Broker): Promise<BrokerAccount> {
    return firstValueFrom(
      this.http.put<BrokerAccount>(`/api/broker/accounts/${id}`, { name, broker }),
    );
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/broker/accounts/${id}`));
  }

  /**
   * Uploads a statement. Multipart and not a JSON body of text: the file is read on the server,
   * so that what got imported is decided in one place and can be re-run over a stored copy later.
   */
  importStatement(id: string, file: File): Promise<ImportResult> {
    const body = new FormData();
    body.append('file', file);
    return firstValueFrom(
      this.http.post<ImportResult>(`/api/broker/accounts/${id}/import`, body),
    );
  }

  /**
   * Says what ticker an ISIN is, or forgets it when `symbol` is empty. Sent for the user rather
   * than for one account — the answer does not change between two of them — and answered with
   * every account already marked to market, so the panel repaints from this one call.
   */
  mapSymbol(isin: string, symbol: string): Promise<BrokerAccount[]> {
    return firstValueFrom(
      this.http.put<BrokerAccount[]>('/api/broker/accounts/symbols', { isin, symbol }),
    );
  }

  transactions(id: string): Promise<Transaction[]> {
    return firstValueFrom(
      this.http.get<Transaction[]>(`/api/broker/accounts/${id}/transactions`),
    );
  }
}
