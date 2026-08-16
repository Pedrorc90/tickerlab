# TickerLab — Roadmap

Fuente de verdad del plan por fases. Claude lo lee al inicio de sesión y lo actualiza al cerrar cada fase.

## Fases

- [x] **F1 — Gráfico base** (2026-08-15, probada en la app): scaffolding Angular 22 + Spring Boot 4.1, buscador de tickers USA, velas + volumen + RSI(14) en paneles separados, timeframes día/semana/mes. El RSI es una `BaselineSeries` con base en 50 (verde arriba, rojo abajo) y no una línea: a esa altura de panel la línea fina no se leía. Datos de Yahoo Finance tras `MarketDataProvider`, caché Caffeine (15 min velas / 24 h búsqueda). Sin BD.
- [ ] **F2 — Screener tipo Finviz**: tabla filtrable de acciones USA (sector, variación %, volumen, capitalización) con enlace al gráfico. El universo sale de los ficheros de Nasdaq Trader (decidido 2026-08-15); como el endpoint `chart` de Yahoo es uno-a-uno, aquí sí hace falta persistencia (Postgres) y un job de refresco.
- [x] **F3 — MACD y medias móviles** (2026-08-15, probada en la app): MACD 12/26/9 en su propio panel (histograma + línea + señal) y SMA 50/200 sobre las velas. Cálculo en cliente (`indicators/macd.ts`, `indicators/moving-average.ts`). Las medias son *overlays*: van al panel del precio y no entran en el reparto de alturas. Periodos fijos, no configurables por el usuario — se decidió dejar la UI de configuración fuera.
- [x] **F4 — Mostrar/ocultar indicadores en vivo** (2026-08-15, probada en la app): la leyenda del pie es el control — cada indicador es una píldora que apaga y enciende su panel. Adelantada sobre F3 con los dos indicadores que ya había. Los paneles se añaden y se quitan (no se ocultan), así que el resto se reparte el alto liberado y el precio solo ocupa el 100 %.

- [x] **F5 — Bollinger y media de volumen** (2026-08-16, dada por buena con la app arrancada): bandas 20/2 como *overlay* sobre las velas (banda alta y baja continuas, base a trazos para no confundirla con una SMA más) y media móvil 20 del volumen dentro del propio panel de volumen, no como píldora aparte: sin volumen a la vista su media no dice nada. Cálculo en cliente (`indicators/bollinger.ts`, `volumeMovingAverage` en `indicators/moving-average.ts`), media y desviación típica en una sola pasada.

- [x] **F6 — Temas y zoom inicial** (2026-08-16, probada en la app): selector de tema arriba a la derecha con Dark (defecto) y Papel, recordado en `localStorage`. El chart abre sobre el último séptimo del histórico en vez de sobre todo (`INITIAL_VISIBLE_FRACTION`, ajustado a ojo en la app): con cinco años en pantalla cada vela era un píxel.

- [x] **F7 — ATR(14) y memoria de la leyenda** (2026-08-16, probada en la app): ATR en panel propio con suavizado de Wilder (`indicators/atr.ts`), el eje autoescalado y no fijo —está en dólares, un rango fijo lo aplana en valores baratos—. La leyenda recuerda qué indicadores quedaron apagados: lo que se guarda es el conjunto **apagado**, no el visible, para que un indicador añadido más tarde aparezca solo en vez de nacer oculto.

- [x] **F8 — Watchlists y leyenda lateral** (2026-08-15/16, probada en la app, documentada a posteriori): listas de tickers con nombre a la derecha del chart, primera feature con persistencia — Postgres 16 en Docker (puerto 5433), Flyway dueño del esquema e Hibernate solo validando, igual que keepory. La pestaña abierta se recuerda en `localStorage`; las listas viven en la BD. La leyenda pasó de tira inferior a columna izquierda, con descripciones por indicador conmutables desde su cabecera, y los periodos (SMA, RSI, MACD) son editables desde cada píldora con un popover — en memoria, un recargado devuelve los de manual.

## Notas

- **Yahoo Finance es un endpoint no oficial**: sin API key, histórico desde los 80, precio del día con ~15 min de retardo. Si cambia, solo se toca `YahooMarketDataProvider`.
- **Boot 4**: `RestClient.Builder` exige el starter `spring-boot-starter-restclient`; ya no viene con el starter web.
- **lightweight-charts v5**: los paneles son nativos (`addSeries(def, options, paneIndex)` + `pane.setHeight`). Las alturas van en píxeles, así que se recalculan en cada resize.
- **Etiquetas de panel**: `createTextWatermark(pane, …)` es la vía nativa en v5 (el watermark dejó de ser opción del chart). Así se rotula el panel del RSI, arriba a la derecha. El plugin se tipa con `Time`, no con `UTCTimestamp`.
- **Quitar y reordenar paneles**: `removeSeries` deja el panel vacío ocupando alto — hay que rematarlo con `removePane`. Para recolocar se usa `pane.moveTo(index)`, que mueve el panel entero (`series.moveToPane` metería la serie en un panel ajeno).
- **UI clicable**: un botón sin borde ni fondo dentro de la leyenda no se lee como pulsable, por muy correcto que sea el HTML. Los toggles son píldoras (2026-08-15, tras no verlos en la app).
- **Relleno y altura del RSI validados en la app** (2026-08-15): se quedan como están (relleno 0.45, panel al 27 %).

- **Universo de tickers de F2: Nasdaq Trader** (decidido 2026-08-15). Ficheros públicos y oficiales de valores listados (`nasdaqlisted.txt` + `otherlisted.txt`), sin API key, ~6.000 símbolos. Descartados: fichero estático del S&P 500 (500 nombres, se pudre a mano) y los `screener` de Yahoo (traen los campos ya filtrados, pero son aún menos documentados que el `chart`). Queda por concretar al abrir F2: esquema en Postgres y cadencia del job de refresco.

- **Añadir un indicador nuevo** son tres sitios: una entrada en `INDICATORS` (`market.models.ts`, con su `overlay`), un `case` en `createPlot` (`price-chart.component.ts`) y el color de su píldora (`.swatch.<nombre>` en `app.css`, que hay que mantener igual al de la serie). El toggle de la leyenda y el reparto de alturas salen gratis. Si el indicador acompaña a otro en su panel (caso de la media de volumen), va como serie extra del `case` que ya existe: `overlay` solo distingue "panel del precio" de "panel propio".

- **Repo en GitHub** (2026-08-16): `Pedrorc90/tickerlab` como `origin`. Antes solo existía en local.

- **Estado del navegador**: cuatro claves de `localStorage`, todas con el prefijo `tickerlab.` — tema, pestaña de watchlist abierta, descripciones de indicadores abiertas e indicadores apagados. Lo que se persiste es siempre lo que se apartó de lo normal, no el estado entero.

- **Añadir un tema nuevo** son dos sitios: una entrada en `THEMES` (`theme/theme.service.ts`, con las 24 claves de la paleta del chart) y un bloque `:root[data-theme='<id>']` con los 17 tokens de UI (`styles.css`). El servicio empuja la paleta del chart a `--chart-*`, así que las píldoras de la leyenda se pintan solas con los colores exactos de las series. Cambiar de tema **recrea el chart entero**: los colores de serie se fijan al crearlas y se pierde el zoom.

## Pendiente de decidir

- **Indicadores aparcados** (2026-08-16): EMA 20/50 y ADX/DMI(14), recomendados al abrir F5 y descartados por ahora. VWAP e Ichimoku descartados: el VWAP es intradía y los timeframes son día/semana/mes.
- **Periodos entre sesiones** (2026-08-16): los periodos son editables pero viven en memoria. Persistirlos es una entrada más de `localStorage`; sin decidir si conviene o si el valor de manual es mejor punto de partida cada vez.
- **Tema Ámbar descartado** (2026-08-16): terminal negro y oro, construido y visto en la app; se quitó tras verlo. No rehacerlo sin pedirlo.
