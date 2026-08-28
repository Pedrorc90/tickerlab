package dev.tickerlab.portfolio;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.OffsetDateTime;

/**
 * What is held of one symbol inside a {@link Portfolio}. Like {@link
 * dev.tickerlab.watchlist.WatchlistEntry}, it only exists inside its parent and the symbol is
 * its whole identity — there is no ticker table to point at.
 */
@Embeddable
public class Position {

    /** Four decimals, same as the screener's price column: an average is not a price paid. */
    static final int COST_SCALE = 4;

    @Column(nullable = false, length = 20)
    private String symbol;

    @Column(nullable = false)
    private long quantity;

    @Column(name = "avg_cost", nullable = false, precision = 18, scale = COST_SCALE)
    private BigDecimal avgCost;

    @Column(name = "opened_at", nullable = false)
    private OffsetDateTime openedAt;

    protected Position() {
        // for Hibernate
    }

    Position(String symbol, long quantity, BigDecimal avgCost, OffsetDateTime openedAt) {
        this.symbol = symbol;
        this.quantity = quantity;
        this.avgCost = avgCost.setScale(COST_SCALE, RoundingMode.HALF_UP);
        this.openedAt = openedAt;
    }

    public String getSymbol() {
        return symbol;
    }

    public long getQuantity() {
        return quantity;
    }

    public BigDecimal getAvgCost() {
        return avgCost;
    }

    public OffsetDateTime getOpenedAt() {
        return openedAt;
    }

    /**
     * Weighted average, which is the whole reason this row exists: buying the same ticker twice
     * at different prices has to collapse into one cost, and doing it on read would mean
     * replaying the order book and picking FIFO or average on every request.
     */
    void add(long units, BigDecimal price) {
        BigDecimal held = avgCost.multiply(BigDecimal.valueOf(quantity));
        BigDecimal added = price.multiply(BigDecimal.valueOf(units));
        quantity += units;
        avgCost = held.add(added)
                .divide(BigDecimal.valueOf(quantity), COST_SCALE, RoundingMode.HALF_UP);
    }

    /**
     * Selling realises a profit; it does not change what the remaining shares cost. Touching the
     * average here would make the next sell measure itself against a number nobody ever paid.
     *
     * @return the profit or loss taken, rounded to cents
     */
    BigDecimal remove(long units, BigDecimal price) {
        quantity -= units;
        return price.subtract(avgCost)
                .multiply(BigDecimal.valueOf(units))
                .setScale(Portfolio.CASH_SCALE, RoundingMode.HALF_UP);
    }
}
