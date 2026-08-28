package dev.tickerlab.portfolio;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.hibernate.annotations.CreationTimestamp;

/**
 * One filled order. Append-only and never updated: the fill price is copied into the row so a
 * later sweep moving the quote cannot rewrite what an order cost.
 *
 * <p>An entity and not an element collection of {@link Portfolio}, unlike {@link Position}: the
 * book only grows, and loading a year of it to repaint a summary would be the wrong trade.
 */
@Entity
@Table(name = "portfolio_order")
public class PortfolioOrder {

    @Id
    private UUID id;

    @Column(name = "portfolio_id", nullable = false)
    private UUID portfolioId;

    @Column(nullable = false, length = 20)
    private String symbol;

    /** A cached label, not a key — same as on a watchlist entry. */
    @Column(length = 120)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 4)
    private OrderSide side;

    @Column(nullable = false)
    private long quantity;

    @Column(nullable = false, precision = 18, scale = 4)
    private BigDecimal price;

    /** Null on a buy: a purchase realises nothing. */
    @Column(name = "realized_pnl", precision = 18, scale = 2)
    private BigDecimal realizedPnl;

    @Enumerated(EnumType.STRING)
    @Column(name = "price_source", nullable = false, length = 10)
    private PriceSource priceSource;

    @CreationTimestamp
    @Column(name = "executed_at", nullable = false, updatable = false)
    private OffsetDateTime executedAt;

    protected PortfolioOrder() {
        // for Hibernate
    }

    PortfolioOrder(UUID portfolioId, String symbol, String name, OrderSide side, long quantity,
                   BigDecimal price, BigDecimal realizedPnl, PriceSource priceSource) {
        this.id = UUID.randomUUID();
        this.portfolioId = portfolioId;
        this.symbol = symbol;
        this.name = name;
        this.side = side;
        this.quantity = quantity;
        this.price = price;
        this.realizedPnl = realizedPnl;
        this.priceSource = priceSource;
    }

    public UUID getId() {
        return id;
    }

    public UUID getPortfolioId() {
        return portfolioId;
    }

    public String getSymbol() {
        return symbol;
    }

    public String getName() {
        return name;
    }

    public OrderSide getSide() {
        return side;
    }

    public long getQuantity() {
        return quantity;
    }

    public BigDecimal getPrice() {
        return price;
    }

    public BigDecimal getRealizedPnl() {
        return realizedPnl;
    }

    public PriceSource getPriceSource() {
        return priceSource;
    }

    public OffsetDateTime getExecutedAt() {
        return executedAt;
    }
}
