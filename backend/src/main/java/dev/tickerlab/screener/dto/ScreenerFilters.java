package dev.tickerlab.screener.dto;

import java.math.BigDecimal;

/**
 * What the screener is asking for. Every field is optional and null means "no filter", so
 * an empty instance returns the whole universe. Percentages are percentages: 2.5 is 2.5 %.
 *
 * <p>Bounds come in pairs where a dropdown needs both directions — "sube más de un 2 %"
 * is a minimum, "baja más de un 2 %" is a maximum of -2.
 */
public record ScreenerFilters(String query,
                              String exchange,
                              BigDecimal minMarketCap,
                              BigDecimal minPrice,
                              BigDecimal maxPrice,
                              Long minVolume,
                              BigDecimal minChange,
                              BigDecimal maxChange,
                              BigDecimal minPer,
                              BigDecimal maxPer,
                              BigDecimal maxPriceToBook,
                              BigDecimal minDividendYield,
                              BigDecimal minChange52w,
                              /** "Within X % of the 52-week high" is a floor on a negative number. */
                              BigDecimal minFromHigh52w,
                              BigDecimal minVsSma50,
                              BigDecimal maxVsSma50,
                              BigDecimal minVsSma200,
                              BigDecimal maxVsSma200,
                              BigDecimal maxFromLow52w,
                              Long minAvgVolume3m,
                              Long minSharesOutstanding,
                              BigDecimal minForwardPer,
                              BigDecimal maxForwardPer,
                              BigDecimal minEps,
                              /** Lower is better on this one: 1 is a strong buy, 5 a sell. */
                              BigDecimal maxAnalystRating,
                              /** Relative strength floor, 1-99. An 80 keeps the top fifth of the market. */
                              Integer minRsRating) {
}
