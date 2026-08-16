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
        this.changePercent = quote.changePercent();
        this.volume = quote.volume();
        this.marketCap = quote.marketCap();
        this.per = quote.per();
        this.priceToBook = quote.priceToBook();
        this.dividendYield = quote.dividendYield();
        this.change52w = quote.change52w();
        this.fromHigh52w = quote.fromHigh52w();
        this.fromLow52w = quote.fromLow52w();
        this.vsSma50 = quote.vsSma50();
        this.vsSma200 = quote.vsSma200();
        this.avgVolume3m = quote.avgVolume3m();
        this.sharesOutstanding = quote.sharesOutstanding();
        this.forwardPer = quote.forwardPer();
        this.eps = quote.eps();
        this.analystRating = quote.analystRating();
        this.quotedAt = quotedAt;
    }
}
