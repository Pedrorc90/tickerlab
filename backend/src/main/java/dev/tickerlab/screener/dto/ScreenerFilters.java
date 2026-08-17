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
                              /**
                               * Ceiling on the yield, and the one bound a null passes: a company
                               * that pays nothing arrives without the field, not with a zero.
                               * Set to 0 it means "sin dividendo".
                               */
                              BigDecimal maxDividendYield,
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
                              Integer minRsRating,
                              /**
                               * Floor on the blended score, 1-99. Overlaps with the strength floor
                               * above on purpose: this one also asks the stock to be near its high
                               * and above its 200-day, so the same 80 is a stricter 80.
                               */
                              Integer minScore,
                              /**
                               * Today's volume as a multiple of the three-month average: 1.5 asks for half
                               * again the usual interest. A ratio and not a count, so it says the same thing
                               * about a mega cap as about a small one.
                               */
                              BigDecimal minRelVolume,
                              /**
                               * The other end of the same ratio. A ceiling of 0.7 asks for a stock
                               * trading quietly — what a base looks like before it breaks out, and the
                               * opposite setup to the floor above rather than a variant of it.
                               */
                              BigDecimal maxRelVolume) {
}
