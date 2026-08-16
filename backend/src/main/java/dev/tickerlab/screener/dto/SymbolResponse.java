package dev.tickerlab.screener.dto;

import dev.tickerlab.screener.Symbol;
import java.math.BigDecimal;

/** Metrics are null until a quote sweep has reached the ticker. Percentages are percentages. */
public record SymbolResponse(String symbol, String name, String exchange, BigDecimal price,
                             BigDecimal changePercent, Long volume, BigDecimal marketCap,
                             BigDecimal per, BigDecimal priceToBook, BigDecimal dividendYield,
                             BigDecimal change52w, BigDecimal fromHigh52w, BigDecimal vsSma50,
                             BigDecimal vsSma200, BigDecimal fromLow52w, Long avgVolume3m,
                             Long sharesOutstanding, BigDecimal forwardPer, BigDecimal eps,
                             BigDecimal analystRating) {

    public static SymbolResponse from(Symbol symbol) {
        return new SymbolResponse(
                symbol.getSymbol(),
                symbol.getName(),
                symbol.getExchange(),
                symbol.getPrice(),
                symbol.getChangePercent(),
                symbol.getVolume(),
                symbol.getMarketCap(),
                symbol.getPer(),
                symbol.getPriceToBook(),
                symbol.getDividendYield(),
                symbol.getChange52w(),
                symbol.getFromHigh52w(),
                symbol.getVsSma50(),
                symbol.getVsSma200(),
                symbol.getFromLow52w(),
                symbol.getAvgVolume3m(),
                symbol.getSharesOutstanding(),
                symbol.getForwardPer(),
                symbol.getEps(),
                symbol.getAnalystRating());
    }
}
