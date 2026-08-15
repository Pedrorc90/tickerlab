# TickerLab — Roadmap

Fuente de verdad del plan por fases. Claude lo lee al inicio de sesión y lo actualiza al cerrar cada fase.

## Fases

- [x] **F1 — Gráfico base** (2026-08-15, probada en la app): scaffolding Angular 22 + Spring Boot 4.1, buscador de tickers USA, velas + volumen + RSI(14) en paneles separados, timeframes día/semana/mes. El RSI es una `BaselineSeries` con base en 50 (verde arriba, rojo abajo) y no una línea: a esa altura de panel la línea fina no se leía. Datos de Yahoo Finance tras `MarketDataProvider`, caché Caffeine (15 min velas / 24 h búsqueda). Sin BD.
- [ ] **F2 — Screener tipo Finviz**: tabla filtrable de acciones USA (sector, variación %, volumen, capitalización) con enlace al gráfico. Requiere resolver de dónde sale el universo de tickers y dónde se almacena — el endpoint `chart` de Yahoo es uno-a-uno, así que aquí sí hace falta persistencia (Postgres) y un job de refresco.
- [ ] **F3 — MACD y medias móviles**: MACD en un cuarto panel (12/26/9) y medias móviles (SMA/EMA, periodos configurables) superpuestas sobre las velas. El cálculo vive en el cliente, junto a `indicators/rsi.ts`.
- [ ] **F4 — Mostrar/ocultar indicadores en vivo**: panel de control para activar y desactivar cada indicador sin recargar el gráfico, con los paneles redimensionándose solos. Depende de F3 (antes solo hay dos indicadores que ocultar).

## Notas

- **Yahoo Finance es un endpoint no oficial**: sin API key, histórico desde los 80, precio del día con ~15 min de retardo. Si cambia, solo se toca `YahooMarketDataProvider`.
- **Boot 4**: `RestClient.Builder` exige el starter `spring-boot-starter-restclient`; ya no viene con el starter web.
- **lightweight-charts v5**: los paneles son nativos (`addSeries(def, options, paneIndex)` + `pane.setHeight`). Las alturas van en píxeles, así que se recalculan en cada resize.

## Pendiente de decidir

- **Relleno del RSI y altura del panel** (abierto 2026-08-15): pendiente de que Pedro lo mire en la app y diga si quiere el relleno más opaco o el panel más alto que el 27 % actual.
- **F2 — universo de tickers y almacenamiento**: Yahoo no publica un listado descargable. Opciones a evaluar cuando toque: fichero estático de constituyentes del S&P 500, los `screener` de Yahoo (no documentados) o un proveedor con listado (Nasdaq Trader publica ficheros públicos).
