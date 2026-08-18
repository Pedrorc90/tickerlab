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

Everything under `/api` needs a session. Accounts are created by hand from one environment
variable and never from a file — without it nothing is seeded, and whoever is already in
`app_user` still signs in:

```bash
TICKERLAB_USERS=pedro:secret,sandra:secret   # name:password pairs
```

Every boot re-applies those passwords, so a forgotten one is changed by restarting with a new
value. Removing a name from the variable does **not** remove the account: that is a
`DELETE FROM app_user`, which takes their watchlists with it.

## Deploying

One Docker image on **Render** (free plan) holding both halves, with the database on **Neon**.
The UI ships inside the jar so the API is same-origin: no CORS, no cross-site cookie.

1. Neon: create the project, then take the connection string **without** the `-pooler` suffix —
   Flyway needs a session-level advisory lock and the pooler runs in transaction mode.
2. Render: new Web Service from this repository, Docker runtime. `render.yaml` declares the
   plan, the region and which variables to ask for.
3. Set `TICKERLAB_DB_URL`, `TICKERLAB_DB_USER` and `TICKERLAB_DB_PASSWORD` in the dashboard.
   They live there and nowhere else. `TICKERLAB_USERS` is **not** set there: seeding from the
   environment would keep login passwords in clear text next to the database ones. Accounts go
   straight into `app_user` as a hash, from Neon's SQL editor:

   ```sql
   INSERT INTO app_user (id, username, password_hash)
   VALUES (gen_random_uuid(), 'name', '$2a$10$…');
   ```

   The hash comes from booting locally once with `TICKERLAB_USERS=name:the-real-password` and
   copying what lands in the local `app_user`. Nothing outside that boot ever holds the
   password itself.
4. First boot runs Flyway on an empty database. The universe is not seeded by it: fill it once
   with `POST /api/screener/refresh` while signed in.

The free plan sleeps after 15 minutes: the next visit waits about a minute, and because the
session is held in memory rather than a table, sleeping signs everyone out.

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
