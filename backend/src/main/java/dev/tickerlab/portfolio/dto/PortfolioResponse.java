package dev.tickerlab.portfolio.dto;

import dev.tickerlab.portfolio.Portfolio;
import dev.tickerlab.portfolio.Position;
import dev.tickerlab.portfolio.PriceLookup;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * A portfolio with its holdings already marked to market. The panel repaints from one response,
 * the way the watchlist panel does.
 *
 * @param totalReturn        money, not a rate: what the pot is worth minus what it started with
 * @param realizedPnl        the sum of every sell ever made, cashed in and no longer at risk
 * @param openPnl            what the current holdings are up or down, still at risk
 * @param fullyPriced        false when at least one position could not be quoted, which makes
 *                           every total below it an understatement rather than a number
 */
public record PortfolioResponse(
        String id,
        String name,
        BigDecimal initialCash,
        BigDecimal cash,
        BigDecimal holdingsValue,
        BigDecimal totalValue,
        BigDecimal totalReturn,
        BigDecimal totalReturnPercent,
        BigDecimal openPnl,
        BigDecimal realizedPnl,
        boolean fullyPriced,
        List<PositionResponse> positions,
        OffsetDateTime createdAt
) {

    private static final int MONEY = 2;
    private static final int PERCENT = 2;

    public static PortfolioResponse from(Portfolio portfolio,
                                         Map<String, PriceLookup.Snapshot> quotes,
                                         BigDecimal realizedPnl) {
        BigDecimal holdings = BigDecimal.ZERO.setScale(MONEY, RoundingMode.HALF_UP);
        BigDecimal openPnl = BigDecimal.ZERO.setScale(MONEY, RoundingMode.HALF_UP);
        boolean fullyPriced = true;

        // Two passes: the weight of a line needs the total, and the total needs every line.
        List<Valued> valued = new ArrayList<>();
        for (Position held : portfolio.getPositions()) {
            PriceLookup.Snapshot quote = quotes.get(held.getSymbol());
            BigDecimal price = quote == null ? null : quote.price();
            BigDecimal units = BigDecimal.valueOf(held.getQuantity());
            BigDecimal cost = held.getAvgCost().multiply(units).setScale(MONEY, RoundingMode.HALF_UP);
            BigDecimal value = price == null ? null : price.multiply(units).setScale(MONEY, RoundingMode.HALF_UP);
            if (value == null) {
                fullyPriced = false;
            } else {
                holdings = holdings.add(value);
                openPnl = openPnl.add(value.subtract(cost));
            }
            valued.add(new Valued(held, quote == null ? null : quote.name(), price, cost, value));
        }

        BigDecimal total = portfolio.getCash().add(holdings);
        List<PositionResponse> positions = valued.stream()
                .map(line -> line.toResponse(total))
                .toList();

        BigDecimal totalReturn = total.subtract(portfolio.getInitialCash());
        return new PortfolioResponse(
                portfolio.getId().toString(),
                portfolio.getName(),
                portfolio.getInitialCash(),
                portfolio.getCash(),
                holdings,
                total,
                totalReturn,
                percent(totalReturn, portfolio.getInitialCash()),
                openPnl,
                realizedPnl.setScale(MONEY, RoundingMode.HALF_UP),
                fullyPriced,
                positions,
                portfolio.getCreatedAt());
    }

    private record Valued(Position held, String name, BigDecimal price, BigDecimal cost, BigDecimal value) {

        PositionResponse toResponse(BigDecimal portfolioTotal) {
            return new PositionResponse(
                    held.getSymbol(),
                    name,
                    held.getQuantity(),
                    held.getAvgCost(),
                    cost,
                    price,
                    value,
                    value == null ? null : value.subtract(cost),
                    value == null ? null : percent(value.subtract(cost), cost),
                    value == null ? null : percent(value, portfolioTotal),
                    held.getOpenedAt());
        }
    }

    /** Null on a zero base rather than a division by zero: there is no percentage of nothing. */
    private static BigDecimal percent(BigDecimal amount, BigDecimal base) {
        if (base == null || base.signum() == 0) {
            return null;
        }
        return amount.multiply(BigDecimal.valueOf(100))
                .divide(base, PERCENT, RoundingMode.HALF_UP);
    }
}
