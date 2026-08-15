# TickerLab — Roadmap

Fuente de verdad del plan por fases. Claude lo lee al inicio de sesión y lo actualiza al cerrar cada fase.

## Fases

- [x] **F1 — Gráfico base** (2026-08-15, probada en la app): scaffolding Angular 22 + Spring Boot 4.1, buscador de tickers USA, velas + volumen + RSI(14) en paneles separados, timeframes día/semana/mes. El RSI es una `BaselineSeries` con base en 50 (verde arriba, rojo abajo) y no una línea: a esa altura de panel la línea fina no se leía. Datos de Yahoo Finance tras `MarketDataProvider`, caché Caffeine (15 min velas / 24 h búsqueda). Sin BD.
- [ ] **F2 — Screener tipo Finviz**: tabla filtrable de acciones USA (sector, variación %, volumen, capitalización) con enlace al gráfico. El universo sale de los ficheros de Nasdaq Trader (decidido 2026-08-15); como el endpoint `chart` de Yahoo es uno-a-uno, aquí sí hace falta persistencia (Postgres) y un job de refresco.
- [ ] **F3 — MACD y medias móviles**: MACD en un cuarto panel (12/26/9) y medias móviles (SMA/EMA, periodos configurables) superpuestas sobre las velas. El cálculo vive en el cliente, junto a `indicators/rsi.ts`.
- [ ] **F4 — Mostrar/ocultar indicadores en vivo**: panel de control para activar y desactivar cada indicador sin recargar el gráfico, con los paneles redimensionándose solos. Depende de F3 (antes solo hay dos indicadores que ocultar).

## Notas

- **Yahoo Finance es un endpoint no oficial**: sin API key, histórico desde los 80, precio del día con ~15 min de retardo. Si cambia, solo se toca `YahooMarketDataProvider`.
- **Boot 4**: `RestClient.Builder` exige el starter `spring-boot-starter-restclient`; ya no viene con el starter web.
- **lightweight-charts v5**: los paneles son nativos (`addSeries(def, options, paneIndex)` + `pane.setHeight`). Las alturas van en píxeles, así que se recalculan en cada resize.
- **Etiquetas de panel**: `createTextWatermark(pane, …)` es la vía nativa en v5 (el watermark dejó de ser opción del chart). Así se rotula el panel del RSI, arriba a la derecha.
- **Relleno y altura del RSI validados en la app** (2026-08-15): se quedan como están (relleno 0.45, panel al 27 %).

- **Universo de tickers de F2: Nasdaq Trader** (decidido 2026-08-15). Ficheros públicos y oficiales de valores listados (`nasdaqlisted.txt` + `otherlisted.txt`), sin API key, ~6.000 símbolos. Descartados: fichero estático del S&P 500 (500 nombres, se pudre a mano) y los `screener` de Yahoo (traen los campos ya filtrados, pero son aún menos documentados que el `chart`). Queda por concretar al abrir F2: esquema en Postgres y cadencia del job de refresco.

## Pendiente de decidir

- Nada abierto ahora mismo.
