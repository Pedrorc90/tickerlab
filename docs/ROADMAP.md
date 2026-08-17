# TickerLab — Roadmap

Fuente de verdad del plan por fases. Claude lo lee al inicio de sesión y lo actualiza al cerrar cada fase.

## Fases

- [x] **F1 — Gráfico base** (2026-08-15, probada en la app): scaffolding Angular 22 + Spring Boot 4.1, buscador de tickers USA, velas + volumen + RSI(14) en paneles separados, timeframes día/semana/mes. El RSI es una `BaselineSeries` con base en 50 (verde arriba, rojo abajo) y no una línea: a esa altura de panel la línea fina no se leía. Datos de Yahoo Finance tras `MarketDataProvider`, caché Caffeine (15 min velas / 24 h búsqueda). Sin BD.
- [x] **F2 — Screener tipo Finviz** (2026-08-16, probada en la app): pantalla propia (botón Gráfico/Screener en la cabecera, sin router: el chart vive entero dentro de `App`), tabla de 5.956 acciones USA ordenable por cualquier columna y 17 filtros en tres grupos. El universo son los dos ficheros de Nasdaq Trader; se guardan **solo acciones**: ETFs, warrants, rights, units, preferentes y notes se descartan al ingerir (de 13.111 filas a 5.956, los ~6.000 que se esperaban). El punto de la clase se traduce a guion (`BRK.B` → `BRK-B`), que es como lo entiende Yahoo. **No hay job**: un barrido completo se midió en ~20 s (60 lotes de 100) y lo dispara abrir el screener, en su propio hilo y solo si las cotizaciones pasan de 15 min; la tabla pregunta cada 3 s y se repinta sola. Filtros como criteria (`SymbolSpecs`), no como una JPQL con doce `:param is null or …`.
- [x] **F3 — MACD y medias móviles** (2026-08-15, probada en la app): MACD 12/26/9 en su propio panel (histograma + línea + señal) y SMA 50/200 sobre las velas. Cálculo en cliente (`indicators/macd.ts`, `indicators/moving-average.ts`). Las medias son *overlays*: van al panel del precio y no entran en el reparto de alturas. Periodos fijos, no configurables por el usuario — se decidió dejar la UI de configuración fuera.
- [x] **F4 — Mostrar/ocultar indicadores en vivo** (2026-08-15, probada en la app): la leyenda del pie es el control — cada indicador es una píldora que apaga y enciende su panel. Adelantada sobre F3 con los dos indicadores que ya había. Los paneles se añaden y se quitan (no se ocultan), así que el resto se reparte el alto liberado y el precio solo ocupa el 100 %.

- [x] **F5 — Bollinger y media de volumen** (2026-08-16, dada por buena con la app arrancada): bandas 20/2 como *overlay* sobre las velas (banda alta y baja continuas, base a trazos para no confundirla con una SMA más) y media móvil 20 del volumen dentro del propio panel de volumen, no como píldora aparte: sin volumen a la vista su media no dice nada. Cálculo en cliente (`indicators/bollinger.ts`, `volumeMovingAverage` en `indicators/moving-average.ts`), media y desviación típica en una sola pasada.

- [x] **F6 — Temas y zoom inicial** (2026-08-16, probada en la app): selector de tema arriba a la derecha con Dark (defecto) y Papel, recordado en `localStorage`. El chart abre sobre el último séptimo del histórico en vez de sobre todo (`INITIAL_VISIBLE_FRACTION`, ajustado a ojo en la app): con cinco años en pantalla cada vela era un píxel.

- [x] **F7 — ATR(14) y memoria de la leyenda** (2026-08-16, probada en la app): ATR en panel propio con suavizado de Wilder (`indicators/atr.ts`), el eje autoescalado y no fijo —está en dólares, un rango fijo lo aplana en valores baratos—. La leyenda recuerda qué indicadores quedaron apagados: lo que se guarda es el conjunto **apagado**, no el visible, para que un indicador añadido más tarde aparezca solo en vez de nacer oculto.

- [x] **F8 — Watchlists y leyenda lateral** (2026-08-15/16, probada en la app, documentada a posteriori): listas de tickers con nombre a la derecha del chart, primera feature con persistencia — Postgres 16 en Docker (puerto 5433), Flyway dueño del esquema e Hibernate solo validando, igual que keepory. La pestaña abierta se recuerda en `localStorage`; las listas viven en la BD. La leyenda pasó de tira inferior a columna izquierda, con descripciones por indicador conmutables desde su cabecera, y los periodos (SMA, RSI, MACD) son editables desde cada píldora con un popover — en memoria, un recargado devuelve los de manual.

- [x] **F9 — EMA 20/50** (2026-08-16, probada en la app): las dos medias exponenciales como *overlay*, cada una con su píldora y su periodo editable (`exponentialMovingAverage` en `indicators/moving-average.ts`, semilla = SMA de las primeras `period` velas, así arrancan en la misma vela que su gemela simple). Van a 1 px frente a los 2 px de las SMA: con los dos pares encendidos, las exponenciales son el grupo rápido y las simples siguen siendo la referencia. Colores cian/rosa en Dark y azul/granate en Papel, lejos del ámbar y el violeta de las SMA.

- [x] **F10 — Añadir a watchlist desde el screener** (2026-08-16, probada en la app): una columna `+` al final de cada fila abre un menú con las listas y un «+ Nueva lista» con caja inline, que crea y añade de una vez. Las listas que ya tienen el ticker salen con ✓: el `POST /entries` es idempotente, así que sin la marca un segundo clic no diría nada. Solo se tocó `screener-panel.component.ts` — el backend de F8 ya servía. El menú va `position: fixed` con las coordenadas del botón, no `absolute` dentro de la celda: `.table-wrap` tiene `overflow: auto` y recortaba el menú en las últimas filas.

- [x] **F11 — ADX/DMI(14)** (2026-08-16, documentada a posteriori): tres líneas en panel propio (`indicators/adx.ts`), no el ADX solo — la fuerza por sí sola dice que hay tendencia pero no de quién, y eso ya lo enseñan las medias. +DI/−DI dan el lado, el ADX si ese lado merece confianza, y una línea a trazos en 25 marca dónde empieza a merecerla. Eje autoescalado y no fijo a 0-100 como el RSI: las tres líneas rara vez pasan de 60.

- [x] **F12 — Encuadre del screener** (2026-08-16, probada en la app): la tabla deja de ser la pantalla entera y pasa a ser un bloque — 1400 px centrados con borde y radio, y el hueco de abajo se queda vacío. **Sin scroll**: `PAGE_SIZE` baja de 50 a 25 para que una página traiga exactamente lo que cabe, así la tabla mide lo que miden sus filas y la barra desaparece. El padding vertical de fila baja a 0.25rem porque con 0.35rem esas 25 filas se salen de una ventana de 1080p y el scroll vuelve. El pager comparte ancho con la tabla en vez de ser una barra a sangre, que se leía como pie de página.

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

- **El `quote` de Yahoo exige sesión** (2026-08-16): a diferencia del `chart`, devuelve 401 sin cookie + crumb. Se piden a `fc.yahoo.com` y `/v1/test/getcrumb`, y se renuevan al primer 401. El crumb viaja como `text/plain`: esa petición debe pedir `*/*` o Yahoo responde **406**. Un lote admite 100 símbolos. Trae 87 campos, pero **no sector ni industria** — eso necesitaría `quoteSummary` uno a uno.

- **Yahoo mezcla unidades en los porcentajes** (2026-08-16): `regularMarketChangePercent` y `fiftyTwoWeekChangePercent` vienen ya en porcentaje (2.42 = 2,42 %), pero los que comparan contra un máximo o una media vienen en fracción (0.0242). Se normaliza todo a porcentaje en `YahooQuoteClient.asPercent`.

- **Añadir un filtro al screener** son cuatro sitios: la columna (migración + campo en `Symbol`), una línea en `SymbolSpecs`, el `@RequestParam` del controller con su hueco en `ScreenerFilters`, y una entrada en `RANGE_SELECTS` (`screener.models.ts`). El desplegable, el contador de activos y el botón Limpiar salen gratis. Si el filtro es sobre un campo nuevo de Yahoo, **mide antes su cobertura**: un campo que solo llega en el 10 % de los símbolos hace desaparecer al otro 90 % del resultado, porque `null >= x` es falso.

- **Estado del navegador**: cuatro claves de `localStorage`, todas con el prefijo `tickerlab.` — tema, pestaña de watchlist abierta, descripciones de indicadores abiertas e indicadores apagados. Lo que se persiste es siempre lo que se apartó de lo normal, no el estado entero.

- **Añadir un tema nuevo** son dos sitios: una entrada en `THEMES` (`theme/theme.service.ts`, con las 24 claves de la paleta del chart) y un bloque `:root[data-theme='<id>']` con los 17 tokens de UI (`styles.css`). El servicio empuja la paleta del chart a `--chart-*`, así que las píldoras de la leyenda se pintan solas con los colores exactos de las series. Cambiar de tema **recrea el chart entero**: los colores de serie se fijan al crearlas y se pierde el zoom.

## Pendiente de decidir

- **Indicadores aparcados** (2026-08-16): la lista se ha vaciado — las EMA salieron en F9 y el ADX/DMI en F11. VWAP e Ichimoku descartados: el VWAP es intradía y los timeframes son día/semana/mes.
- **Margen del alto del screener** (2026-08-16): con 25 filas y padding 0.25rem quedan 76 px libres en 1080p. Con barra de marcadores o una ventana más baja el scroll reaparece; bajar el padding a 0.22rem daría ~100 px de colchón. Sin decidir si compensa apretar más la fila o asumirlo.
- **Periodos entre sesiones** (2026-08-16): los periodos son editables pero viven en memoria. Persistirlos es una entrada más de `localStorage`; sin decidir si conviene o si el valor de manual es mejor punto de partida cada vez.
- **Tema Ámbar descartado** (2026-08-16): terminal negro y oro, construido y visto en la app; se quitó tras verlo. No rehacerlo sin pedirlo.
- **Sector e industria en el screener** (2026-08-16): los pedía F2 y se quedaron fuera — el `quote` no los trae y sacarlos de `quoteSummary` son 5.956 llamadas. Sin decidir si compensa (¿carga perezosa solo de lo que se ve? ¿otra fuente?).
- **Filtros del screener entre sesiones** (2026-08-16): el panel recuerda si quedó abierto (`tickerlab.screenerFiltersOpen`), pero los 17 desplegables y el orden vuelven a cero al recargar. Mismo dilema que los periodos de los indicadores.
