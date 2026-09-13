package dev.tickerlab.broker;

import dev.tickerlab.user.AppUser;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * A real account at a real broker, filled by importing its statements. Unlike {@link
 * dev.tickerlab.portfolio.Portfolio} it holds no cash figure and no positions of its own: both
 * are derived by walking the imported transactions, because the statement is the only thing here
 * that is true and anything cached beside it is a second version of the same fact.
 */
@Entity
@Table(name = "broker_account")
public class BrokerAccount {

    @Id
    private UUID id;

    @Column(nullable = false, length = 60)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private Broker broker;

    /** Lazy, same as on a portfolio: the owner is already the user doing the asking. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_id", nullable = false)
    private AppUser owner;

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

    public Broker getBroker() {
        return broker;
    }

    public void setBroker(Broker broker) {
        this.broker = broker;
    }

    public AppUser getOwner() {
        return owner;
    }

    public void setOwner(AppUser owner) {
        this.owner = owner;
    }

    public OffsetDateTime getCreatedAt() {
        return createdAt;
    }
}
