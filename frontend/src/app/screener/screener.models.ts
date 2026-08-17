/**
 * One listed share. Everything below `exchange` is null until a quote sweep has reached
 * the ticker, and every percentage is a percentage: 2.5 means 2.5 %.
 */
export interface ScreenerSymbol {
  readonly symbol: string;
  readonly name: string;
  readonly exchange: string;
  readonly price: number | null;
  readonly changePercent: number | null;
  readonly volume: number | null;
  readonly marketCap: number | null;
  readonly per: number | null;
  readonly priceToBook: number | null;
  readonly dividendYield: number | null;
  readonly change52w: number | null;
  /** Distance to the 52-week high: zero at the high, negative below it. */
  readonly fromHigh52w: number | null;
  readonly vsSma50: number | null;
  readonly vsSma200: number | null;
  /** Distance to the 52-week low: zero at the low, positive above it. */
  readonly fromLow52w: number | null;
  readonly avgVolume3m: number | null;
  readonly sharesOutstanding: number | null;
  readonly forwardPer: number | null;
  readonly eps: number | null;
  /** Analyst consensus: 1 is a strong buy and 5 a sell, so lower is better. */
  readonly analystRating: number | null;
  /**
   * Relative strength against every other listed share, 1 to 99, the way IBD scores it:
   * 99 means only 1 % of the market has done better. Unlike the columns above it is not
   * quoted but computed, so it moves whenever the universe is re-swept.
   */
  readonly rsRating: number | null;
}

/** Every column the backend accepts an order by. */
export type SortField = keyof ScreenerSymbol;

export interface ScreenerPage {
  readonly items: ScreenerSymbol[];
  /** Size of the whole filtered set, not of this page. */
  readonly total: number;
  readonly page: number;
  readonly size: number;
  /** A quote sweep is under way: the numbers are about to change on their own. */
  readonly refreshing: boolean;
  readonly quotedAt: string | null;
}

export interface RefreshResult {
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  readonly total: number;
  readonly refreshedAt: string;
}

/** A page is what fits on screen at once: the table shows every row it gets, without scrolling. */
export const PAGE_SIZE = 25;

/**
 * How the numbers read. They live here rather than in the table because the detail panel
 * under it shows the same fields and has to write them the same way.
 */
export function formatPrice(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/** A ratio Yahoo leaves out is a company with no earnings to divide by. */
export function formatRatio(value: number | null): string {
  return value === null ? '—' : value.toFixed(1);
}

/** A multiple, not a count: the × is what stops «1,8» being read as 1,8 M de acciones. */
export function formatMultiple(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}×`;
}

/**
 * Today's volume against the usual, worked out here rather than quoted: both halves already
 * travel with the row, so the column costs no extra call. Null when there is no average to
 * divide by — a fresh listing — which is the same case the filter drops on the server.
 */
export function relativeVolume(row: ScreenerSymbol): number | null {
  if (row.volume === null || row.avgVolume3m === null || row.avgVolume3m <= 0) {
    return null;
  }
  return row.volume / row.avgVolume3m;
}

export function formatCompact(value: number | null): string {
  if (value === null) {
    return '—';
  }
  if (value >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(2)} B`;
  }
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)} MM`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)} M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)} K`;
  }
  return `${value}`;
}

/** Every bound the backend accepts. Null is "no filter" on every one of them. */
export interface Filters {
  query: string;
  exchange: string;
  minMarketCap: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  minVolume: number | null;
  minChange: number | null;
  maxChange: number | null;
  minPer: number | null;
  maxPer: number | null;
  maxPriceToBook: number | null;
  minDividendYield: number | null;
  minChange52w: number | null;
  minFromHigh52w: number | null;
  minVsSma50: number | null;
  maxVsSma50: number | null;
  minVsSma200: number | null;
  maxVsSma200: number | null;
  maxFromLow52w: number | null;
  minAvgVolume3m: number | null;
  minSharesOutstanding: number | null;
  minForwardPer: number | null;
  maxForwardPer: number | null;
  minEps: number | null;
  maxAnalystRating: number | null;
  minRsRating: number | null;
  /** Today's volume as a multiple of the three-month average: 1.5 is half again the usual. */
  minRelVolume: number | null;
  /** The same ratio from above: 0.7 is a stock trading quietly, the way a base does. */
  maxRelVolume: number | null;
}

/** The numeric half of the filters: what a dropdown can set. */
type Bound = Exclude<keyof Filters, 'query' | 'exchange'>;

/** One entry of a dropdown: a label and the bounds picking it sets. */
export interface RangeOption {
  readonly label: string;
  readonly min?: number;
  readonly max?: number;
}

/** One dropdown: which fields its bounds land on, and the tiers it offers. */
export interface RangeSelect {
  readonly id: string;
  /**
   * What the dropdown filters, drawn above it. It cannot live in the options: a select shows
   * only the entry it sits on, so a chosen tier replaces whatever named the field — and
   * «Precio por encima» is the very same text in the SMA 50 and the SMA 200 dropdowns.
   */
  readonly label: string;
  readonly group: FilterGroup;
  readonly minKey?: Bound;
  readonly maxKey?: Bound;
  readonly options: readonly RangeOption[];
}

export type FilterGroup = 'Descriptivo' | 'Fundamental' | 'Técnico';

export const FILTER_GROUPS: readonly FilterGroup[] = ['Descriptivo', 'Fundamental', 'Técnico'];

/**
 * The dropdowns, as data. Tiers follow the ones a screener usually offers, so a filter is
 * picked rather than typed. Option 0 is always "no filter", and it is worded as the absence
 * of one rather than by naming the field: the field is on the label above, always visible.
 */
export const RANGE_SELECTS: readonly RangeSelect[] = [
  {
    id: 'marketCap',
    label: 'Capitalización',
    group: 'Descriptivo',
    minKey: 'minMarketCap',
    options: [
      { label: 'Toda' },
      { label: 'Mega (200.000 M+)', min: 200_000_000_000 },
      { label: 'Grande (10.000 M+)', min: 10_000_000_000 },
      { label: 'Mediana (2.000 M+)', min: 2_000_000_000 },
      { label: 'Pequeña (300 M+)', min: 300_000_000 },
      { label: 'Micro (50 M+)', min: 50_000_000 },
    ],
  },
  {
    id: 'price',
    label: 'Precio',
    group: 'Descriptivo',
    minKey: 'minPrice',
    maxKey: 'maxPrice',
    options: [
      { label: 'Cualquiera' },
      { label: 'Menos de 5 $', max: 5 },
      { label: 'Menos de 20 $', max: 20 },
      { label: 'Más de 20 $', min: 20 },
      { label: 'Más de 50 $', min: 50 },
      { label: 'Más de 200 $', min: 200 },
    ],
  },
  {
    id: 'volume',
    label: 'Volumen',
    group: 'Descriptivo',
    minKey: 'minVolume',
    options: [
      { label: 'Todo' },
      { label: '100 K+', min: 100_000 },
      { label: '500 K+', min: 500_000 },
      { label: '1 M+', min: 1_000_000 },
      { label: '5 M+', min: 5_000_000 },
    ],
  },
  {
    id: 'avgVolume3m',
    label: 'Vol. medio 3m',
    group: 'Descriptivo',
    minKey: 'minAvgVolume3m',
    options: [
      { label: 'Todo' },
      { label: '200 K+ de media', min: 200_000 },
      { label: '1 M+ de media', min: 1_000_000 },
      { label: '5 M+ de media', min: 5_000_000 },
    ],
  },
  {
    id: 'sharesOutstanding',
    label: 'Acciones',
    group: 'Descriptivo',
    minKey: 'minSharesOutstanding',
    options: [
      { label: 'Cualquiera' },
      { label: '50 M+ en circulación', min: 50_000_000 },
      { label: '500 M+ en circulación', min: 500_000_000 },
      { label: '1.000 M+ en circulación', min: 1_000_000_000 },
    ],
  },
  {
    id: 'per',
    label: 'PER',
    group: 'Fundamental',
    minKey: 'minPer',
    maxKey: 'maxPer',
    options: [
      { label: 'Cualquiera' },
      { label: 'Con beneficios (PER > 0)', min: 0 },
      { label: 'Bajo (< 15)', min: 0, max: 15 },
      { label: 'Moderado (15-25)', min: 15, max: 25 },
      { label: 'Alto (> 25)', min: 25 },
    ],
  },
  {
    id: 'priceToBook',
    label: 'P/VC',
    group: 'Fundamental',
    maxKey: 'maxPriceToBook',
    options: [
      { label: 'Cualquiera' },
      { label: 'Bajo valor contable (< 1)', max: 1 },
      { label: 'Menos de 3', max: 3 },
      { label: 'Menos de 5', max: 5 },
    ],
  },
  {
    id: 'dividendYield',
    label: 'Dividendo',
    group: 'Fundamental',
    minKey: 'minDividendYield',
    options: [
      { label: 'Cualquiera' },
      { label: 'Reparte algo (> 0 %)', min: 0.0001 },
      { label: '2 % o más', min: 2 },
      { label: '4 % o más', min: 4 },
      { label: '6 % o más', min: 6 },
    ],
  },
  {
    id: 'forwardPer',
    label: 'PER futuro',
    group: 'Fundamental',
    minKey: 'minForwardPer',
    maxKey: 'maxForwardPer',
    options: [
      { label: 'Cualquiera' },
      { label: 'Bajo (< 15)', min: 0, max: 15 },
      { label: 'Moderado (15-25)', min: 15, max: 25 },
      { label: 'Alto (> 25)', min: 25 },
    ],
  },
  {
    id: 'eps',
    label: 'BPA',
    group: 'Fundamental',
    minKey: 'minEps',
    options: [
      { label: 'Cualquiera' },
      { label: 'En beneficios (> 0)', min: 0.0001 },
      { label: '1 $ o más', min: 1 },
      { label: '5 $ o más', min: 5 },
    ],
  },
  {
    id: 'analystRating',
    label: 'Analistas',
    group: 'Fundamental',
    maxKey: 'maxAnalystRating',
    options: [
      // Yahoo's scale runs 1 (strong buy) to 5 (sell), so every tier is a ceiling.
      { label: 'Cualquiera' },
      { label: 'Compra fuerte', max: 1.5 },
      { label: 'Compra o mejor', max: 2.5 },
      { label: 'Mantener o mejor', max: 3 },
    ],
  },
  {
    // First of the technical group on purpose: in the IBD method the rating is what you
    // filter on before anything else, and the rest only narrows what it already picked.
    id: 'rsRating',
    label: 'RS',
    group: 'Técnico',
    minKey: 'minRsRating',
    options: [
      { label: 'Cualquiera' },
      { label: 'RS 70+', min: 70 },
      { label: 'RS 80+ (líder)', min: 80 },
      { label: 'RS 90+ (top 10 %)', min: 90 },
    ],
  },
  {
    id: 'change',
    label: 'Hoy',
    group: 'Técnico',
    minKey: 'minChange',
    maxKey: 'maxChange',
    options: [
      { label: 'Cualquiera' },
      { label: 'Sube', min: 0 },
      { label: 'Sube +2 %', min: 2 },
      { label: 'Sube +5 %', min: 5 },
      { label: 'Baja', max: 0 },
      { label: 'Baja −2 %', max: -2 },
      { label: 'Baja −5 %', max: -5 },
    ],
  },
  {
    // Right after today's move because it is the same question asked properly: a 3 % day on a
    // fifth of the usual volume is nobody buying, and the absolute volume filter cannot tell
    // the two apart — it only ever selects big companies.
    id: 'relVolume',
    label: 'Vol. relativo',
    group: 'Técnico',
    minKey: 'minRelVolume',
    maxKey: 'maxRelVolume',
    options: [
      // "Seco" is the opposite scan, not a smaller version of the ones above it: a stock
      // pinned to its 50-day on thin volume is a base, and the surge is what confirms it
      // breaking. Asking for both at once returns nothing, and should.
      { label: 'Cualquiera' },
      { label: '1,2× la media', min: 1.2 },
      { label: '1,5× la media', min: 1.5 },
      { label: '2× la media', min: 2 },
      { label: '3× la media', min: 3 },
      { label: 'Seco (≤0,7× la media)', max: 0.7 },
    ],
  },
  {
    id: 'change52w',
    label: '52 semanas',
    group: 'Técnico',
    minKey: 'minChange52w',
    options: [
      { label: 'Cualquiera' },
      { label: 'En positivo', min: 0 },
      { label: '+25 % o más', min: 25 },
      { label: '+50 % o más', min: 50 },
      { label: '+100 % o más', min: 100 },
    ],
  },
  {
    id: 'fromHigh52w',
    label: 'Máximo 52s',
    group: 'Técnico',
    minKey: 'minFromHigh52w',
    options: [
      { label: 'Cualquiera' },
      { label: 'A menos del 5 %', min: -5 },
      { label: 'A menos del 10 %', min: -10 },
      { label: 'A menos del 25 %', min: -25 },
    ],
  },
  {
    id: 'fromLow52w',
    label: 'Mínimo 52s',
    group: 'Técnico',
    maxKey: 'maxFromLow52w',
    options: [
      { label: 'Cualquiera' },
      { label: 'A menos del 10 % encima', max: 10 },
      { label: 'A menos del 25 % encima', max: 25 },
      { label: 'A menos del 50 % encima', max: 50 },
    ],
  },
  {
    id: 'vsSma50',
    label: 'SMA 50',
    group: 'Técnico',
    minKey: 'minVsSma50',
    maxKey: 'maxVsSma50',
    options: [
      // The tiers separate an entry with a short stop from a chase: the same ticker is a
      // different trade 3 % over its 50-day and 20 % over it. They sit after the two coarse
      // options rather than beside "por encima" because a saved view stores the index it
      // picked, and inserting in the middle would leave it filtering by another tier.
      { label: 'Cualquiera' },
      { label: 'Precio por encima', min: 0 },
      { label: 'Precio por debajo', max: 0 },
      { label: 'Pegado (0-5 % encima)', min: 0, max: 5 },
      { label: 'Cerca (0-15 % encima)', min: 0, max: 15 },
      { label: 'Extendido (+15 %)', min: 15 },
    ],
  },
  {
    id: 'vsSma200',
    label: 'SMA 200',
    group: 'Técnico',
    minKey: 'minVsSma200',
    maxKey: 'maxVsSma200',
    options: [
      { label: 'Cualquiera' },
      { label: 'Precio por encima', min: 0 },
      { label: 'Precio por debajo', max: 0 },
    ],
  },
];

/**
 * A saved screen: the dropdowns it moves, each named by the label of the option it lands on
 * rather than by its index. Adding a tier reorders a list — it already happened to the SMA 50
 * one — and an index would then quietly point a preset at a filter nobody chose.
 */
export interface Preset {
  readonly name: string;
  /** What the screen is after, shown on hover. */
  readonly hint: string;
  /** Dropdown id to the label of the option it should sit on. */
  readonly picks: Readonly<Record<string, string>>;
}

/**
 * Three screens rather than one, because they contradict each other on purpose: pinned to the
 * 50-day on dry volume is a base still forming, and the same ticker on 1.5× volume is that
 * base breaking. Asked for together they return nothing, and a single "va a subir" filter is
 * exactly the thing that cannot exist.
 */
export const PRESETS: readonly Preset[] = [
  {
    name: 'Base seca',
    hint: 'Líder consolidando pegado a la SMA 50 con el volumen apagado: la ruptura aún no ha llegado.',
    picks: {
      rsRating: 'RS 80+ (líder)',
      fromHigh52w: 'A menos del 10 %',
      vsSma200: 'Precio por encima',
      vsSma50: 'Pegado (0-5 % encima)',
      relVolume: 'Seco (≤0,7× la media)',
      avgVolume3m: '1 M+ de media',
    },
  },
  {
    name: 'Ruptura',
    hint: 'Se mueve hoy y con volumen detrás: la apuesta es que continúe.',
    picks: {
      rsRating: 'RS 80+ (líder)',
      fromHigh52w: 'A menos del 5 %',
      change: 'Sube +2 %',
      relVolume: '1,5× la media',
      vsSma50: 'Precio por encima',
      vsSma200: 'Precio por encima',
      price: 'Más de 20 $',
      avgVolume3m: '1 M+ de media',
    },
  },
  {
    name: 'Retroceso',
    hint: 'Cae hoy pero la tendencia sigue intacta: compra la debilidad, no la fuerza.',
    picks: {
      rsRating: 'RS 80+ (líder)',
      vsSma200: 'Precio por encima',
      vsSma50: 'Pegado (0-5 % encima)',
      change: 'Baja −2 %',
      change52w: '+25 % o más',
      avgVolume3m: '1 M+ de media',
    },
  },
];

/** Where a preset leaves every dropdown. A label that matches nothing is left unfiltered. */
export function picksOf(preset: Preset): Record<string, number> {
  const picks: Record<string, number> = {};
  for (const [id, label] of Object.entries(preset.picks)) {
    const select = RANGE_SELECTS.find((candidate) => candidate.id === id);
    const index = select ? select.options.findIndex((option) => option.label === label) : -1;
    if (index > 0) {
      picks[id] = index;
    }
  }
  return picks;
}

/** Builds the request from the text box, the market box and where each dropdown sits. */
export function filtersFrom(
  query: string,
  exchange: string,
  picks: Readonly<Record<string, number>>,
): Filters {
  const filters: Filters = {
    query,
    exchange,
    minMarketCap: null,
    minPrice: null,
    maxPrice: null,
    minVolume: null,
    minChange: null,
    maxChange: null,
    minPer: null,
    maxPer: null,
    maxPriceToBook: null,
    minDividendYield: null,
    minChange52w: null,
    minFromHigh52w: null,
    minVsSma50: null,
    maxVsSma50: null,
    minVsSma200: null,
    maxVsSma200: null,
    maxFromLow52w: null,
    minAvgVolume3m: null,
    minSharesOutstanding: null,
    minForwardPer: null,
    maxForwardPer: null,
    minEps: null,
    maxAnalystRating: null,
    minRsRating: null,
    minRelVolume: null,
    maxRelVolume: null,
  };
  for (const select of RANGE_SELECTS) {
    const option = select.options[picks[select.id] ?? 0];
    if (!option) {
      continue;
    }
    if (select.minKey && option.min !== undefined) {
      filters[select.minKey] = option.min;
    }
    if (select.maxKey && option.max !== undefined) {
      filters[select.maxKey] = option.max;
    }
  }
  return filters;
}
