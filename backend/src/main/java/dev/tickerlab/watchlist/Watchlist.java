package dev.tickerlab.watchlist;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/** A named list of tickers. No owner: this runs single-user against a local database. */
@Entity
@Table(name = "watchlist")
public class Watchlist {

    @Id
    private UUID id;

    @Column(nullable = false, length = 60)
    private String name;

    /**
     * Entries are an element collection, not an entity: a ticker only exists inside the
     * list that holds it, and the symbol is its whole identity.
     */
    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "watchlist_entry", joinColumns = @JoinColumn(name = "watchlist_id"))
    @OrderBy("addedAt ASC")
    private List<WatchlistEntry> entries = new ArrayList<>();

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

    public List<WatchlistEntry> getEntries() {
        return entries;
    }

    /** Idempotent: a symbol already on the list keeps its original position and name. */
    public boolean addEntry(String symbol, String displayName) {
        String normalised = normalise(symbol);
        if (holds(normalised)) {
            return false;
        }
        entries.add(new WatchlistEntry(normalised, displayName, OffsetDateTime.now()));
        return true;
    }

    public boolean removeEntry(String symbol) {
        String normalised = normalise(symbol);
        return entries.removeIf(entry -> entry.getSymbol().equals(normalised));
    }

    public boolean holds(String symbol) {
        String normalised = normalise(symbol);
        return entries.stream().anyMatch(entry -> entry.getSymbol().equals(normalised));
    }

    /** Yahoo returns upper-case symbols; storing anything else would duplicate rows. */
    static String normalise(String symbol) {
        return symbol == null ? "" : symbol.trim().toUpperCase(Locale.ROOT);
    }
}
