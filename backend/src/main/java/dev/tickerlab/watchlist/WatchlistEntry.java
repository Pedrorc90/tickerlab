package dev.tickerlab.watchlist;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.time.OffsetDateTime;

/** One ticker inside a {@link Watchlist}. The company name is a cached label, not a key. */
@Embeddable
public class WatchlistEntry {

    @Column(nullable = false, length = 20)
    private String symbol;

    @Column(length = 120)
    private String name;

    @Column(name = "added_at", nullable = false)
    private OffsetDateTime addedAt;

    protected WatchlistEntry() {
        // for Hibernate
    }

    WatchlistEntry(String symbol, String name, OffsetDateTime addedAt) {
        this.symbol = symbol;
        this.name = name;
        this.addedAt = addedAt;
    }

    public String getSymbol() {
        return symbol;
    }

    public String getName() {
        return name;
    }

    public OffsetDateTime getAddedAt() {
        return addedAt;
    }
}
