package dev.tickerlab.broker;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.UUID;
import org.hibernate.annotations.CreationTimestamp;

/**
 * One line of a broker statement, imported as it was printed and never recomputed afterwards.
 *
 * <p>An entity and not an element collection of {@link BrokerAccount}, for the same reason
 * {@code PortfolioOrder} is one: the book only grows, and a decade of statements should not have
 * to be loaded to repaint a header.
 */
@Entity
@Table(name = "broker_transaction")
public class BrokerTransaction {

    /** Money: two decimals, or the balance stops adding up against the broker's own figure. */
    static final int AMOUNT_SCALE = 2;

    /** A price is not money moved — four decimals, same as the screener's price column. */
    static final int PRICE_SCALE = 4;

    @Id
    private UUID id;

    @Column(name = "account_id", nullable = false)
    private UUID accountId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private TransactionKind kind;

    @Column(name = "executed_at", nullable = false)
    private OffsetDateTime executedAt;

    @Column(length = 12)
    private String isin;

    @Column(length = 120)
    private String product;

    /** What the statement called the row. On a cash movement it is the only identity there is. */
    @Column(length = 200)
    private String description;

    /** Null until something maps the ISIN onto the screener's ticker universe. */
    @Column(length = 20)
    private String symbol;

    /** Signed as the statement signs it: positive bought, negative sold. Null on a cash row. */
    private Long quantity;

    @Column(precision = 18, scale = PRICE_SCALE)
    private BigDecimal price;

    @Column(name = "price_currency", length = 3)
    private String priceCurrency;

    /** Signed: negative leaves the account, positive arrives. Fees are already folded in. */
    @Column(nullable = false, precision = 18, scale = AMOUNT_SCALE)
    private BigDecimal amount;

    @Column(nullable = false, length = 3)
    private String currency;

    @Column(nullable = false, precision = 18, scale = AMOUNT_SCALE)
    private BigDecimal fees = BigDecimal.ZERO;

    @Column(name = "fx_rate", precision = 18, scale = 6)
    private BigDecimal fxRate;

    @Column(name = "external_id", length = 64)
    private String externalId;

    @Column(nullable = false, length = 64)
    private String fingerprint;

    @Column(name = "source_file", nullable = false, length = 160)
    private String sourceFile;

    /** Which export this came from. An account commits to one; see {@link StatementKind}. */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private StatementKind statement;

    @CreationTimestamp
    @Column(name = "imported_at", nullable = false, updatable = false)
    private OffsetDateTime importedAt;

    protected BrokerTransaction() {
        // for Hibernate
    }

    /**
     * Built from a parsed line rather than from fourteen positional arguments: every field here is
     * a nullable String or BigDecimal, so a pair swapped at a call site would compile and store
     * the wrong statement in silence.
     */
    BrokerTransaction(UUID accountId, dev.tickerlab.broker.parse.ParsedMovement movement,
                      StatementKind statement, String sourceFile) {
        this.id = UUID.randomUUID();
        this.accountId = accountId;
        this.kind = movement.kind();
        this.executedAt = movement.executedAt();
        this.isin = movement.isin();
        this.product = movement.product();
        this.description = movement.description();
        this.quantity = movement.quantity();
        this.price = scaled(movement.price(), PRICE_SCALE);
        this.priceCurrency = movement.priceCurrency();
        this.amount = scaled(movement.amount(), AMOUNT_SCALE);
        this.currency = movement.currency();
        this.fees = movement.fees() == null ? BigDecimal.ZERO
                : scaled(movement.fees(), AMOUNT_SCALE);
        this.fxRate = movement.fxRate();
        this.externalId = movement.externalId();
        this.statement = statement;
        this.sourceFile = sourceFile;
        this.fingerprint = fingerprint();
    }

    /**
     * What makes this movement itself, digested. Re-importing a statement whose date range
     * overlaps one already imported has to be a no-op, and the raw line cannot be the key: the
     * same transaction exported twice differs in column order and trailing commas, and DeGiro
     * leaves the order id empty on the rows it generates itself.
     *
     * <p>The instant is written as an epoch second so the digest does not depend on the offset
     * the export happened to be formatted in, and the amounts go in already scaled so that
     * {@code 89,12} and {@code 89,120} do not produce two different keys for one movement.
     */
    private String fingerprint() {
        String material = String.join("|",
                kind.name(),
                Long.toString(executedAt.toEpochSecond()),
                statement.name(),
                nullSafe(isin),
                nullSafe(product),
                nullSafe(description),
                quantity == null ? "" : Long.toString(quantity),
                price == null ? "" : price.toPlainString(),
                amount.toPlainString(),
                currency,
                nullSafe(externalId));
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(material.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException ex) {
            // SHA-256 is required of every JVM; if it is missing the problem is not this import.
            throw new IllegalStateException("SHA-256 unavailable", ex);
        }
    }

    private static String nullSafe(String value) {
        return value == null ? "" : value;
    }

    private static BigDecimal scaled(BigDecimal value, int scale) {
        return value == null ? null : value.setScale(scale, java.math.RoundingMode.HALF_UP);
    }

    /** The instant a statement row happened, in UTC. Statements print local time without offset. */
    static OffsetDateTime at(java.time.LocalDateTime local) {
        return local.atOffset(ZoneOffset.UTC);
    }

    public UUID getId() {
        return id;
    }

    public UUID getAccountId() {
        return accountId;
    }

    public TransactionKind getKind() {
        return kind;
    }

    public OffsetDateTime getExecutedAt() {
        return executedAt;
    }

    public String getIsin() {
        return isin;
    }

    public String getProduct() {
        return product;
    }

    public String getSymbol() {
        return symbol;
    }

    public Long getQuantity() {
        return quantity;
    }

    public BigDecimal getPrice() {
        return price;
    }

    public String getPriceCurrency() {
        return priceCurrency;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public String getCurrency() {
        return currency;
    }

    public BigDecimal getFees() {
        return fees;
    }

    public BigDecimal getFxRate() {
        return fxRate;
    }

    public String getExternalId() {
        return externalId;
    }

    public String getFingerprint() {
        return fingerprint;
    }

    public String getSourceFile() {
        return sourceFile;
    }

    public String getDescription() {
        return description;
    }

    public StatementKind getStatement() {
        return statement;
    }
}
