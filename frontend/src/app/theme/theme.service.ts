import { Injectable, computed, signal } from '@angular/core';

export type ThemeId = 'dark' | 'paper';

/**
 * Every colour the chart draws with. Lightweight-charts never reads CSS, so these have to
 * be handed to it as plain strings — which makes this object the source of truth for the
 * series colours, and the CSS variables the legend swatches use are derived from it.
 */
export interface ChartPalette {
  background: string;
  text: string;
  grid: string;
  border: string;
  up: string;
  down: string;
  volumeUp: string;
  volumeDown: string;
  volumeAverage: string;
  rsiStrong: string;
  rsiWeak: string;
  rsiStrongFill: string;
  rsiWeakFill: string;
  rsiFade: string;
  rsiOverboughtBand: string;
  rsiOversoldBand: string;
  paneLabel: string;
  smaFast: string;
  smaSlow: string;
  emaFast: string;
  emaSlow: string;
  bollingerBand: string;
  bollingerBasis: string;
  macdLine: string;
  macdSignal: string;
  macdHistUp: string;
  macdHistDown: string;
  atrLine: string;
}

export interface Theme {
  id: ThemeId;
  label: string;
  chart: ChartPalette;
}

/** Order matters: it is the order of the pills in the header, and the first one is the default. */
export const THEMES: readonly Theme[] = [
  {
    id: 'dark',
    label: 'Dark',
    chart: {
      background: '#131722',
      text: '#b2b5be',
      grid: '#1f2430',
      border: '#2a2e39',
      up: '#26a69a',
      down: '#ef5350',
      volumeUp: 'rgba(38, 166, 154, 0.5)',
      volumeDown: 'rgba(239, 83, 80, 0.5)',
      volumeAverage: '#e0e3eb',
      rsiStrong: '#2ec4b6',
      rsiWeak: '#ff6b6b',
      rsiStrongFill: 'rgba(46, 196, 182, 0.45)',
      rsiWeakFill: 'rgba(255, 107, 107, 0.45)',
      rsiFade: 'rgba(46, 196, 182, 0)',
      rsiOverboughtBand: 'rgba(46, 196, 182, 0.55)',
      rsiOversoldBand: 'rgba(255, 107, 107, 0.55)',
      paneLabel: 'rgba(178, 181, 190, 0.55)',
      smaFast: '#f0b90b',
      smaSlow: '#a78bfa',
      emaFast: '#38bdf8',
      emaSlow: '#fb7185',
      bollingerBand: '#6f86c9',
      bollingerBasis: 'rgba(111, 134, 201, 0.55)',
      macdLine: '#4b8bff',
      macdSignal: '#ff9f43',
      macdHistUp: 'rgba(38, 166, 154, 0.55)',
      macdHistDown: 'rgba(239, 83, 80, 0.55)',
      atrLine: '#f472b6',
    },
  },
  {
    id: 'paper',
    label: 'Papel',
    chart: {
      background: '#f4efe4',
      text: '#6a6152',
      grid: '#e2dac8',
      border: '#d5cab2',
      up: '#2f7d5f',
      down: '#b3402f',
      volumeUp: 'rgba(47, 125, 95, 0.4)',
      volumeDown: 'rgba(179, 64, 47, 0.4)',
      volumeAverage: '#6a6152',
      rsiStrong: '#2f7d5f',
      rsiWeak: '#b3402f',
      rsiStrongFill: 'rgba(47, 125, 95, 0.3)',
      rsiWeakFill: 'rgba(179, 64, 47, 0.3)',
      rsiFade: 'rgba(47, 125, 95, 0)',
      rsiOverboughtBand: 'rgba(47, 125, 95, 0.5)',
      rsiOversoldBand: 'rgba(179, 64, 47, 0.5)',
      paneLabel: 'rgba(106, 97, 82, 0.7)',
      smaFast: '#b8860b',
      smaSlow: '#6b4fa8',
      emaFast: '#1d7fa8',
      emaSlow: '#c04a5e',
      bollingerBand: '#4a6fa5',
      bollingerBasis: 'rgba(74, 111, 165, 0.5)',
      macdLine: '#2b5f9e',
      macdSignal: '#c26a1a',
      macdHistUp: 'rgba(47, 125, 95, 0.5)',
      macdHistDown: 'rgba(179, 64, 47, 0.5)',
      atrLine: '#a4487a',
    },
  },
];

/** Which theme was picked last. UI state, so it stays in the browser. */
const THEME_KEY = 'tickerlab.theme';

const DEFAULT_THEME = THEMES[0];

function storedTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  return THEMES.find((theme) => theme.id === saved) ?? DEFAULT_THEME;
}

/** `smaFast` -> `--chart-sma-fast`. */
function cssName(key: string): string {
  return `--chart-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly themes = THEMES;
  readonly current = signal<Theme>(storedTheme());
  /** What the chart component reads; a new palette here means the chart has to be repainted. */
  readonly chart = computed(() => this.current().chart);

  constructor() {
    // Applied straight away rather than through an effect: the first paint has to already
    // be in the right theme, and an effect would only run after the first change detection.
    this.apply(this.current());
  }

  select(id: ThemeId): void {
    const theme = THEMES.find((candidate) => candidate.id === id);
    if (!theme || theme.id === this.current().id) {
      return;
    }
    this.current.set(theme);
    this.apply(theme);
  }

  private apply(theme: Theme): void {
    localStorage.setItem(THEME_KEY, theme.id);
    const root = document.documentElement;
    // The rest of the UI is plain CSS keyed off this attribute.
    root.dataset['theme'] = theme.id;
    // The legend swatches have to match the lines the chart draws, so whatever feeds the
    // chart also feeds their CSS.
    for (const [key, value] of Object.entries(theme.chart)) {
      root.style.setProperty(cssName(key), value);
    }
  }
}
