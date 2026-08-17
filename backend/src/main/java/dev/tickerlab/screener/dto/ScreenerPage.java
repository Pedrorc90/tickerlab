package dev.tickerlab.screener.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * One page of the screener table. {@code total} is the size of the whole filtered set;
 * {@code refreshing} tells the UI a quote sweep is under way, so it knows to ask again.
 *
 * <p>{@code top} are the highest-scoring tickers of that whole filtered set, not of this page:
 * a star drawn from the page alone would move as you paged, and would mark the best of twenty-five
 * rows as if it were the best of the filter. Empty while nothing has been scored yet.
 */
public record ScreenerPage(List<SymbolResponse> items, long total, int page, int size,
                           boolean refreshing, OffsetDateTime quotedAt, List<String> top) {
}
