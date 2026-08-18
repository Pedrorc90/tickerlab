import { Injectable, signal } from '@angular/core';

/**
 * Below this the workspace's three columns stop fitting side by side: the chart would be left
 * with less width than the two panels flanking it. The same number lives in the CSS media
 * queries — this signal exists for the decisions CSS cannot make on its own, like the screener
 * choosing cards over a table, and the two have to agree.
 */
const MOBILE = '(max-width: 767px)';

/** One matcher for the whole app, so every consumer flips on the same resize. */
@Injectable({ providedIn: 'root' })
export class ViewportService {
  private readonly query = matchMedia(MOBILE);

  /** Whether the layout is down to a single column. */
  readonly isMobile = signal(this.query.matches);

  constructor() {
    // Fires on rotation and on a dragged desktop window alike; matchMedia is the only listener
    // that does not run on every pixel of a resize.
    this.query.addEventListener('change', ({ matches }) => this.isMobile.set(matches));
  }
}
