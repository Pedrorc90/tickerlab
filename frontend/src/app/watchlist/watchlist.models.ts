/** One ticker saved inside a list. Mirrors the backend `WatchlistResponse.Entry`. */
export interface WatchlistEntry {
  symbol: string;
  /** Company name as it was when saved; null for rows added before it was known. */
  name: string | null;
}

export interface Watchlist {
  id: string;
  name: string;
  entries: WatchlistEntry[];
}
