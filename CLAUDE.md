# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

TickerLab: charting terminal + screener + paper/real portfolio + strategy backtester for US stocks. Spring Boot 4.1 (Java 21) backend, Angular 22 frontend, Postgres 16. Two users, deployed as one Docker image on Render with the DB on Neon. `README.md` covers deploy and API; `docs/ROADMAP.md` (Spanish) is the source of truth for phases, decisions and "closed, don't redo" items — read the relevant entry before changing a feature.

## Commands

```bash
docker compose up -d                  # Postgres on 5433 (5432 belongs to keepory)
cd backend  && mvn spring-boot:run    # :8080
cd frontend && npm start              # :4200, proxies /api to :8080
cd frontend && npm run build          # the only check that enforces bundle/style budgets
cd backend  && mvn -B -q -DskipTests package
```

There are **no tests** in either half (no `src/test`, no `*.spec.ts`), so `ng build` and `mvn package` are the verification. `ng serve` ignores the `angular.json` budgets; a component whose CSS grows past the limit only breaks in `ng build`. Don't run prettier over a whole file: the repo doesn't follow its own `.prettierrc` and it would reformat unrelated code.

Local login needs `TICKERLAB_USERS=name:password,...` in the backend's environment (see README). Optional: `ALPACA_KEY_ID` / `ALPACA_SECRET_KEY` (premarket volume), `TICKERLAB_PREMARKET_TOKEN`.

## Backend (`backend/src/main/java/dev/tickerlab`)

Package-per-feature, each with controller / service / JPA repository / `dto/`: `market`, `watchlist`, `screener`, `portfolio` (paper trading), `broker` (real account imported from DEGIRO CSV statements via `broker/parse`), `user`/`auth`, `config`.

- **Schema is Flyway-owned** (`db/migration/V*.sql`, next is V18); Hibernate runs `ddl-auto: validate`. A new column = migration + entity field.
- **Market data** sits behind `MarketDataProvider`; everything Yahoo-specific is in `YahooMarketDataProvider`. Candles are Caffeine-cached (`CacheConfig`).
- **Screener** keeps a ~5,956-row `symbol` table (Nasdaq Trader files, stocks only). `QuoteRefresher` sweeps Yahoo's `quote` (needs cookie + crumb, batches of 100) and writes prices, derived ratings (RS rating, then score — order matters, score uses RS) in a background thread. Filters are JPA `Specification`s in `SymbolSpecs`, not JPQL. `POST /api/screener/premarket` is the one route outside the session cookie: it authenticates with `X-Tickerlab-Token` and answers 503 when the token is unset (`SecurityConfig`).
- **Auth**: Spring Security session cookie held **in memory** (restart signs everyone out), CSRF off (SPA with JSON). Everything under `/api` needs a session except login.
- **DB pool is deliberately tiny** (`minimum-idle: 0`, max 3) so Neon can scale to zero; don't add scheduled jobs that touch the DB on a timer. Neon needs the non-`-pooler` host because Flyway takes a session advisory lock.
- Yahoo mixes percent units (some fields are percent, some fractions); `YahooQuoteClient.asPercent` normalises. Sector/industry are intentionally not stored.

## Frontend (`frontend/src/app`)

Standalone components, signals, zoneless, **no router** (`app.routes.ts` is empty): `App` switches screens (chart / screener / strategies / portfolio) with a `view` signal, gated by an `@if` on the auth signal (three states: `undefined` = not yet known). Feature folders hold `*.service.ts` (HTTP + signals), `*.models.ts` and one large panel component each (screener, strategies and broker panels are 1,100–1,900 lines).

- **Indicators and backtests are computed client-side**: `market/indicators/*.ts` (pure functions), `strategies/signals.ts` + `backtest.ts` + `basket.ts`. Backtests are long-only and read the cached candles; there is no backend for them.
- **lightweight-charts v5**: `price-chart.component.ts` owns the chart; indicators are native panes with pixel heights recomputed on resize. Changing theme or chart type recreates the whole chart. Adding an indicator touches three places (`INDICATORS` in `market.models.ts`, a `case` in `createPlot`, the pill colour in `indicator-legend.component.ts`) — see ROADMAP "Notas". Adding a screener filter touches four (migration + `Symbol` field, `SymbolSpecs`, controller param + `ScreenerFilters`, `RANGE_SELECTS` in `screener.models.ts`).
- **Browser state** lives in `localStorage` under `tickerlab.*` keys and stores only what deviates from default (e.g. indicators switched *off*, periods moved from textbook). Saved selects are stored by option **label**, not index, so inserting a bracket doesn't shift saved filters.
- Theme palettes: `THEMES` in `theme/theme.service.ts` plus a `:root[data-theme]` block in `styles.css`.
- Component styles are inline template literals — no backticks inside them (breaks the literal; only `ng build` catches it).

## Deploy

`Dockerfile` is three stages: Angular build → copied into the jar's `static/` → JRE image. UI and API are same-origin. Render deploys on push, so run `ng build` and `mvn package` before pushing. Secrets (`TICKERLAB_DB_*`) live only in the Render dashboard; accounts in production are inserted into `app_user` as bcrypt hashes, never via `TICKERLAB_USERS`.
