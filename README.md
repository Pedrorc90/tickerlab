# TickerLab

Minimal charting terminal for US stocks: ticker search, candlestick chart, volume and RSI(14),
on daily / weekly / monthly bars.

Pending work lives in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Stack

- **backend/** — Spring Boot 4.1 (Java 21). Wraps Yahoo Finance's public endpoints behind
  `MarketDataProvider` and caches responses in memory (Caffeine).
- **frontend/** — Angular 22 (standalone, signals, zoneless) with lightweight-charts v5.

## Running it

Two terminals:

```bash
cd backend  && mvn spring-boot:run     # http://localhost:8080
cd frontend && npm start               # http://localhost:4200
```

The dev server proxies `/api` to the backend, so the browser only talks to port 4200.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/symbols?q=apple` | Ticker autocomplete (equities and ETFs) |
| `GET /api/candles/AAPL?timeframe=DAY` | OHLCV history — `timeframe` is `DAY`, `WEEK` or `MONTH` |

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
