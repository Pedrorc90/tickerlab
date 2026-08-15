# TickerLab — Roadmap

Fuente de verdad del plan por fases. Claude lo lee al inicio de sesión y lo actualiza al cerrar cada fase.

## Fases

- [x] **F1 — Gráfico base** (2026-08-15, probada en la app): scaffolding Angular 22 + Spring Boot 4.1, buscador de tickers USA, velas + volumen + RSI(14) en paneles separados, timeframes día/semana/mes. El RSI es una `BaselineSeries` con base en 50 (verde arriba, rojo abajo) y no una línea: a esa altura de panel la línea fina no se leía. Datos de Yahoo Finance tras `MarketDataProvider`, caché Caffeine (15 min velas / 24 h búsqueda). Sin BD.
- [ ] **F2 — Screener tipo Finviz**: tabla filtrable de acciones USA (sector, variación %, volumen, capitalización) con enlace al gráfico. El universo sale de los ficheros de Nasdaq Trader (decidido 2026-08-15); como el endpoint `chart` de Yahoo es uno-a-uno, aquí sí hace falta persistencia (Postgres) y un job de refresco.
- [x] **F3 — MACD y medias móviles** (2026-08-15, probada en la app): MACD 12/26/9 en su propio panel (histograma + línea + señal) y SMA 50/200 sobre las velas. Cálculo en cliente (`indicators/macd.ts`, `indicators/moving-average.ts`). Las medias son *overlays*: van al panel del precio y no entran en el reparto de alturas. Periodos fijos, no configurables por el usuario — se decidió dejar la UI de configuración fuera.
- [x] **F4 — Mostrar/ocultar indicadores en vivo** (2026-08-15, probada en la app): la leyenda del pie es el control — cada indicador es una píldora que apaga y enciende su panel. Adelantada sobre F3 con los dos indicadores que ya había. Los paneles se añaden y se quitan (no se ocultan), así que el resto se reparte el alto liberado y el precio solo ocupa el 100 %.

## Notas

- **Yahoo Finance es un endpoint no oficial**: sin API key, histórico desde los 80, precio del día con ~15 min de retardo. Si cambia, solo se toca `YahooMarketDataProvider`.
- **Boot 4**: `RestClient.Builder` exige el starter `spring-boot-starter-restclient`; ya no viene con el starter web.
- **lightweight-charts v5**: los paneles son nativos (`addSeries(def, options, paneIndex)` + `pane.setHeight`). Las alturas van en píxeles, así que se recalculan en cada resize.
- **Etiquetas de panel**: `createTextWatermark(pane, …)` es la vía nativa en v5 (el watermark dejó de ser opción del chart). Así se rotula el panel del RSI, arriba a la derecha. El plugin se tipa con `Time`, no con `UTCTimestamp`.
- **Quitar y reordenar paneles**: `removeSeries` deja el panel vacío ocupando alto — hay que rematarlo con `removePane`. Para recolocar se usa `pane.moveTo(index)`, que mueve el panel entero (`series.moveToPane` metería la serie en un panel ajeno).
- **UI clicable**: un botón sin borde ni fondo dentro de la leyenda no se lee como pulsable, por muy correcto que sea el HTML. Los toggles son píldoras (2026-08-15, tras no verlos en la app).
- **Relleno y altura del RSI validados en la app** (2026-08-15): se quedan como están (relleno 0.45, panel al 27 %).

- **Universo de tickers de F2: Nasdaq Trader** (decidido 2026-08-15). Ficheros públicos y oficiales de valores listados (`nasdaqlisted.txt` + `otherlisted.txt`), sin API key, ~6.000 símbolos. Descartados: fichero estático del S&P 500 (500 nombres, se pudre a mano) y los `screener` de Yahoo (traen los campos ya filtrados, pero son aún menos documentados que el `chart`). Queda por concretar al abrir F2: esquema en Postgres y cadencia del job de refresco.

- **Añadir un indicador nuevo** son dos sitios: una entrada en `INDICATORS` (`market.models.ts`, con su `overlay`) y un `case` en `createPlot` (`price-chart.component.ts`). El toggle de la leyenda y el reparto de alturas salen gratis.

## Pendiente de decidir

- **Periodos configurables** (aparcado 2026-08-15): SMA 50/200 y MACD 12/26/9 están fijos. Hacerlos ajustables pide UI de configuración; se verá si hace falta de verdad.
- **Repo sin remoto** (2026-08-15): git init hecho, `gh repo create` + push pendientes; el código solo existe en local.
