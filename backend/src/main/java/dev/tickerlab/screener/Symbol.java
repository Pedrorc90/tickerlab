package dev.tickerlab.screener;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * One listed security from the Nasdaq Trader files. The ticker is the identity: the files
 * carry no stable id of their own, and a delisted ticker simply stops being published.
 */
@Entity
@Table(name = "symbol")
public class Symbol {

    /** Long enough for the ETN descriptions the files use as a security name. */
    public static final int MAX_NAME_LENGTH = 500;

    /** What a NUMERIC(12,4) column holds: eight digits ahead of the point. */
    private static final BigDecimal MAX_12_4 = BigDecimal.TEN.pow(8);

    /** And a NUMERIC(10,4) one: six. */
    private static final BigDecimal MAX_10_4 = BigDecimal.TEN.pow(6);

    /** The analyst consensus column is NUMERIC(4,2), so two. */
    private static final BigDecimal MAX_4_2 = BigDecimal.TEN.pow(2);

    @Id
    @Column(length = 20)
    private String symbol;

    @Column(nullable = false, length = MAX_NAME_LENGTH)
    private String name;

    @Column(nullable = false, length = 40)
    private String exchange;

    /** Null until the first quote sweep reaches this ticker; Yahoo also omits the odd one. */
    @Column(precision = 18, scale = 4)
    private BigDecimal price;

    @Column(name = "change_percent", precision = 10, scale = 4)
    private BigDecimal changePercent;

    private Long volume;

    @Column(name = "market_cap", precision = 24, scale = 2)
    private BigDecimal marketCap;

    /** Trailing P/E. Negative for a company losing money, which is a real value, not a gap. */
    @Column(precision = 12, scale = 4)
    private BigDecimal per;

    @Column(name = "price_to_book", precision = 12, scale = 4)
    private BigDecimal priceToBook;

    @Column(name = "dividend_yield", precision = 10, scale = 4)
    private BigDecimal dividendYield;

    @Column(name = "change_52w", precision = 12, scale = 4)
    private BigDecimal change52w;

    @Column(name = "from_high_52w", precision = 10, scale = 4)
    private BigDecimal fromHigh52w;

    @Column(name = "vs_sma_50", precision = 10, scale = 4)
    private BigDecimal vsSma50;

    @Column(name = "vs_sma_200", precision = 10, scale = 4)
    private BigDecimal vsSma200;

    @Column(name = "from_low_52w", precision = 12, scale = 4)
    private BigDecimal fromLow52w;

    @Column(name = "avg_volume_3m")
    private Long avgVolume3m;

    @Column(name = "shares_outstanding")
    private Long sharesOutstanding;

    @Column(name = "forward_per", precision = 12, scale = 4)
    private BigDecimal forwardPer;

    @Column(precision = 12, scale = 4)
    private BigDecimal eps;

    /** Analyst consensus: 1 is a strong buy and 5 a sell, so lower is better here. */
    @Column(name = "analyst_rating", precision = 4, scale = 2)
    private BigDecimal analystRating;

    /**
     * Relative strength against the rest of the universe, 1 to 99. The one metric here that
     * Yahoo does not supply: it is written by {@code SymbolRepository#rankRelativeStrength}
     * once a sweep has quoted everything, which is why {@link #quote} never touches it.
     */
    @Column(name = "rs_rating")
    private Integer rsRating;

    /** When the quote above was read. What decides whether the universe needs a sweep. */
    @Column(name = "quoted_at")
    private OffsetDateTime quotedAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected Symbol() {
        // for JPA
    }

    public Symbol(String symbol, String name, String exchange) {
        this.symbol = symbol;
        this.name = name;
        this.exchange = exchange;
    }

    public String getSymbol() {
        return symbol;
    }

    public String getName() {
        return name;
    }

    public String getExchange() {
        return exchange;
    }

    public BigDecimal getPrice() {
        return price;
    }

    public BigDecimal getChangePercent() {
        return changePercent;
    }

    public Long getVolume() {
        return volume;
    }

    public BigDecimal getMarketCap() {
        return marketCap;
    }

    public BigDecimal getPer() {
        return per;
    }

    public BigDecimal getPriceToBook() {
        return priceToBook;
    }

    public BigDecimal getDividendYield() {
        return dividendYield;
    }

    public BigDecimal getChange52w() {
        return change52w;
    }

    public BigDecimal getFromHigh52w() {
        return fromHigh52w;
    }

    public BigDecimal getVsSma50() {
        return vsSma50;
    }

    public BigDecimal getVsSma200() {
        return vsSma200;
    }

    public BigDecimal getFromLow52w() {
        return fromLow52w;
    }

    public Long getAvgVolume3m() {
        return avgVolume3m;
    }

    public Long getSharesOutstanding() {
        return sharesOutstanding;
    }

    public BigDecimal getForwardPer() {
        return forwardPer;
    }

    public BigDecimal getEps() {
        return eps;
    }

    public BigDecimal getAnalystRating() {
        return analystRating;
    }

    public Integer getRsRating() {
        return rsRating;
    }

    public OffsetDateTime getQuotedAt() {
        return quotedAt;
    }

    public OffsetDateTime getUpdatedAt() {
        return updatedAt;
    }

    /** A refresh rewrites what the files say; the ticker itself never changes. */
    public void update(String name, String exchange) {
        this.name = name;
        this.exchange = exchange;
    }

    /**
     * A field Yahoo left out arrives as null and is stored as such: an empty cell is
     * honest, while keeping yesterday's price under today's timestamp is not.
     */
    public void quote(Quote quote, OffsetDateTime quotedAt) {
        this.price = quote.price();
        this.changePercent = fit(quote.changePercent(), MAX_10_4);
        this.volume = quote.volume();
        this.marketCap = quote.marketCap();
        this.per = fit(quote.per(), MAX_12_4);
        this.priceToBook = fit(quote.priceToBook(), MAX_12_4);
        this.dividendYield = fit(quote.dividendYield(), MAX_10_4);
        this.change52w = fit(quote.change52w(), MAX_12_4);
        this.fromHigh52w = fit(quote.fromHigh52w(), MAX_10_4);
        this.fromLow52w = fit(quote.fromLow52w(), MAX_12_4);
        this.vsSma50 = fit(quote.vsSma50(), MAX_10_4);
        this.vsSma200 = fit(quote.vsSma200(), MAX_10_4);
        this.avgVolume3m = quote.avgVolume3m();
        this.sharesOutstanding = quote.sharesOutstanding();
        this.forwardPer = fit(quote.forwardPer(), MAX_12_4);
        this.eps = fit(quote.eps(), MAX_12_4);
        this.analystRating = fit(quote.analystRating(), MAX_4_2);
        this.quotedAt = quotedAt;
    }

    /**
     * Drops a ratio too big for the column it is headed for. Yahoo hands out the odd
     * eight-digit percentage — a penny stock measured off a 0.0001 low, a split it never
     * adjusted for — and Postgres rejects the whole batch over one of them, which used to
     * take the rest of the sweep down with it.
     *
     * <p>Null rather than a clamp to the ceiling: a 40.000.000 % gain is not a measurement
     * that happens to be large, it is a broken one, and capping it would leave the ticker
     * sitting at the top of every ranking that reads the column.
     */
    private static BigDecimal fit(BigDecimal value, BigDecimal ceiling) {
        if (value == null) {
            return null;
        }
        return value.abs().compareTo(ceiling) < 0 ? value : null;
    }
}
