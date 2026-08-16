package dev.tickerlab.screener.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * One page of the screener table. {@code total} is the size of the whole filtered set;
 * {@code refreshing} tells the UI a quote sweep is under way, so it knows to ask again.
 */
public record ScreenerPage(List<SymbolResponse> items, long total, int page, int size,
                           boolean refreshing, OffsetDateTime quotedAt) {
}
