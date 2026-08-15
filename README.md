# TickerLab

Minimal charting terminal for US stocks: ticker search, candlestick chart, volume and RSI(14),
on daily / weekly / monthly bars.

Pending work lives in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Stack

- **backend/** — Spring Boot 4.1 (Java 21). Wraps Yahoo Finance's public endpoints behind
  `MarketDataProvider` and caches responses in memory (Caffeine).
- **frontend/** — Angular 22 (standalone, signals, zoneless) with lightweight-charts v5.
- **Postgres 16** in Docker — holds the watchlists. Schema owned by Flyway
  (`backend/src/main/resources/db/migration`); Hibernate only validates it.

## Running it

```bash
docker compose up -d                   # Postgres on 5433 (5432 is taken by another project)
cd backend  && mvn spring-boot:run     # http://localhost:8080
cd frontend && npm start               # http://localhost:4200
```

The dev server proxies `/api` to the backend, so the browser only talks to port 4200.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/symbols?q=apple` | Ticker autocomplete (equities and ETFs) |
| `GET /api/candles/AAPL?timeframe=DAY` | OHLCV history — `timeframe` is `DAY`, `WEEK` or `MONTH` |
| `GET/POST /api/watchlists` | Watchlists — create returns 409 if the name is taken |
| `PUT/DELETE /api/watchlists/{id}` | Rename, delete |
| `POST /api/watchlists/{id}/entries` | Add a ticker (idempotent); `DELETE …/entries/{symbol}` removes it |

## Data source

Yahoo Finance's `chart` and `search` endpoints: no API key, no rate limit in practice, history
back to the 1980s. Intraday prices are delayed roughly 15 minutes and the current day's bar keeps
moving until the close.

These endpoints are undocumented and can change without notice. Everything Yahoo-specific lives in
`YahooMarketDataProvider`; swapping in a paid feed means writing one more `MarketDataProvider`.

## Cache

| Cache | TTL | Why |
| --- | --- | --- |
| `candles` | 15 min | Matches the upstream delay — no point refetching sooner |
| `symbolSearch` | 24 h | Company names and sectors barely move |
