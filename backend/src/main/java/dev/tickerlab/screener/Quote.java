package dev.tickerlab.screener;

import java.math.BigDecimal;

/**
 * One reading of everything the screener filters on. Any field Yahoo omits stays null,
 * which the filters read as "unknown", never as zero.
 *
 * <p>Every percentage here is a percentage: 2.42 means 2.42 %.
 */
public record Quote(String symbol,
                    BigDecimal price,
                    BigDecimal changePercent,
                    Long volume,
                    BigDecimal marketCap,
                    BigDecimal per,
                    BigDecimal priceToBook,
                    BigDecimal dividendYield,
                    BigDecimal change52w,
                    /** Distance to the 52-week high: zero at the high, negative below it. */
                    BigDecimal fromHigh52w,
                    /** Distance to the 52-week low: zero at the low, positive above it. */
                    BigDecimal fromLow52w,
                    BigDecimal vsSma50,
                    BigDecimal vsSma200,
                    Long avgVolume3m,
                    Long sharesOutstanding,
                    BigDecimal forwardPer,
                    BigDecimal eps,
                    /** Analyst consensus: 1 is a strong buy and 5 a sell, so lower is better. */
                    BigDecimal analystRating) {
}
