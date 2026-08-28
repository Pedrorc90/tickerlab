package dev.tickerlab.portfolio.dto;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

/**
 * One line of the holdings table, already valued. Every field the screen prints is computed
 * here and not in the browser: ten positions are one query against the screener table, against
 * ten calls to {@code /api/candles} from Angular.
 *
 * <p>Everything downstream of the price is null when the price is null. A position the sweep
 * cannot quote prints dashes, the way the screener already prints them — filling the gap with
 * the cost would show a P&L of exactly zero, which reads as "it has not moved".
 */
public record PositionResponse(
        String symbol,
        String name,
        long quantity,
        BigDecimal avgCost,
        BigDecimal cost,
        BigDecimal price,
        BigDecimal marketValue,
        BigDecimal openPnl,
        BigDecimal openPnlPercent,
        BigDecimal weight,
        OffsetDateTime openedAt
) {
}
