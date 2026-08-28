package dev.tickerlab.portfolio;

import dev.tickerlab.user.AppUser;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * A pot of money that is not real, kept exactly as if it were. Long only, whole shares, no
 * commission and no slippage — the same admissions the backtest of F25 prints on screen,
 * because a portfolio that hides what it did not charge is a number nothing can be compared to.
 */
@Entity
@Table(name = "portfolio")
public class Portfolio {

    /** Cents. Cash is money, not a rate: two decimals or the totals stop adding up. */
    static final int CASH_SCALE = 2;

    @Id
    private UUID id;

    @Column(nullable = false, length = 60)
    private String name;

    /** Lazy: the panel repaints from the portfolio, and the owner is already the user asking. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id", nullable = false)
    private AppUser owner;

    /**
     * Frozen at creation. The return of a portfolio means nothing without the number it started
     * from, and topping up later would silently rewrite every percentage already read off it.
     */
    @Column(name = "initial_cash", nullable = false, precision = 18, scale = CASH_SCALE)
    private BigDecimal initialCash;

    @Column(nullable = false, precision = 18, scale = CASH_SCALE)
    private BigDecimal cash;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "portfolio_position", joinColumns = @JoinColumn(name = "portfolio_id"))
    @OrderBy("symbol ASC")
    private List<Position> positions = new ArrayList<>();

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public AppUser getOwner() {
        return owner;
    }

    public void setOwner(AppUser owner) {
        this.owner = owner;
    }

    public BigDecimal getInitialCash() {
        return initialCash;
    }

    /** Sets both: a portfolio starts with everything in cash and nothing held. */
    public void setInitialCash(BigDecimal initialCash) {
        this.initialCash = initialCash.setScale(CASH_SCALE, RoundingMode.HALF_UP);
        this.cash = this.initialCash;
    }

    public BigDecimal getCash() {
        return cash;
    }

    public List<Position> getPositions() {
        return positions;
    }

    public OffsetDateTime getCreatedAt() {
        return createdAt;
    }

    public Optional<Position> position(String symbol) {
        String normalised = normalise(symbol);
        return positions.stream().filter(held -> held.getSymbol().equals(normalised)).findFirst();
    }

    /**
     * Buys at the price given, all of it out of cash. Refusing rather than going negative is the
     * point of the whole exercise: an account that lends you the difference is not a portfolio,
     * it is a spreadsheet.
     */
    void buy(String symbol, long units, BigDecimal price) {
        BigDecimal cost = price.multiply(BigDecimal.valueOf(units))
                .setScale(CASH_SCALE, RoundingMode.HALF_UP);
        if (cost.compareTo(cash) > 0) {
            throw new InsufficientCashException(cost, cash);
        }
        String normalised = normalise(symbol);
        position(normalised).ifPresentOrElse(
                held -> held.add(units, price),
                () -> positions.add(new Position(normalised, units, price, OffsetDateTime.now())));
        cash = cash.subtract(cost);
    }

    /**
     * Sells at the price given. A position taken down to zero is removed rather than kept at
     * zero units: an empty line on the screen reads as something still held.
     *
     * @return the profit or loss realised on those units
     */
    BigDecimal sell(String symbol, long units, BigDecimal price) {
        String normalised = normalise(symbol);
        Position held = position(normalised)
                .orElseThrow(() -> new InsufficientSharesException(normalised, units, 0));
        if (units > held.getQuantity()) {
            throw new InsufficientSharesException(normalised, units, held.getQuantity());
        }
        BigDecimal realized = held.remove(units, price);
        if (held.getQuantity() == 0) {
            positions.remove(held);
        }
        cash = cash.add(price.multiply(BigDecimal.valueOf(units))
                .setScale(CASH_SCALE, RoundingMode.HALF_UP));
        return realized;
    }

    /** Yahoo returns upper-case symbols; storing anything else would duplicate positions. */
    static String normalise(String symbol) {
        return symbol == null ? "" : symbol.trim().toUpperCase(Locale.ROOT);
    }
}
