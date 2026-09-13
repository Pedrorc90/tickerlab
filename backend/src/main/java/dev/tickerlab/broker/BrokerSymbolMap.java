package dev.tickerlab.broker;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.time.OffsetDateTime;
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * The ticker an ISIN stands for, as the user answered it.
 *
 * <p>The statement never says. It identifies an instrument by ISIN, which prices nothing, and the
 * mapping is the missing half — without it a real account can show what a position cost and never
 * what it is worth. It is asked for rather than derived because one ISIN trades on several venues
 * under several tickers, and a valuation built on the wrong guess is worse than no valuation.
 *
 * <p>Keyed on owner and ISIN, so it outlives the account: deleting one and re-importing its
 * statements does not make the user answer the same question twice.
 */
@Entity
@Table(name = "broker_symbol_map")
public class BrokerSymbolMap {

    @EmbeddedId
    private Key id;

    @Column(nullable = false, length = 20)
    private String symbol;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected BrokerSymbolMap() {
    }

    BrokerSymbolMap(UUID ownerId, String isin, String symbol) {
        this.id = new Key(ownerId, isin);
        this.symbol = symbol;
    }

    public String getIsin() {
        return id.isin();
    }

    public String getSymbol() {
        return symbol;
    }

    void setSymbol(String symbol) {
        this.symbol = symbol;
    }

    /** Composite key, mirroring the table: one answer per owner and instrument. */
    @Embeddable
    public record Key(@Column(name = "owner_id") UUID ownerId,
                      @Column(length = 12) String isin) implements Serializable {

        public Key {
            Objects.requireNonNull(ownerId);
            Objects.requireNonNull(isin);
        }
    }
}
