package dev.tickerlab.portfolio.dto;

import dev.tickerlab.portfolio.OrderSide;
import dev.tickerlab.portfolio.PortfolioOrder;
import dev.tickerlab.portfolio.PriceSource;
import java.math.BigDecimal;
import java.time.OffsetDateTime;

/** One line of the order book. Nothing is recomputed: the row is what it was when it filled. */
public record OrderResponse(
        String id,
        String symbol,
        String name,
        OrderSide side,
        long quantity,
        BigDecimal price,
        BigDecimal amount,
        BigDecimal realizedPnl,
        PriceSource priceSource,
        OffsetDateTime executedAt
) {

    public static OrderResponse from(PortfolioOrder order) {
        return new OrderResponse(
                order.getId().toString(),
                order.getSymbol(),
                order.getName(),
                order.getSide(),
                order.getQuantity(),
                order.getPrice(),
                order.getPrice().multiply(BigDecimal.valueOf(order.getQuantity())),
                order.getRealizedPnl(),
                order.getPriceSource(),
                order.getExecutedAt());
    }
}
