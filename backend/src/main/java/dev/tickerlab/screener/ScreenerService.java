package dev.tickerlab.screener;

import dev.tickerlab.screener.dto.RefreshResult;
import dev.tickerlab.screener.dto.ScreenerFilters;
import dev.tickerlab.screener.dto.ScreenerPage;
import dev.tickerlab.screener.dto.SymbolResponse;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ScreenerService {

    private static final Logger log = LoggerFactory.getLogger(ScreenerService.class);

    private static final int MAX_PAGE_SIZE = 200;

    /**
     * Whitelist, not a passthrough: the sort field arrives from the query string and
     * anything unknown would blow up inside the JPQL rather than at the edge.
     */
    private static final Set<String> SORTABLE = Set.of(
            "symbol", "name", "exchange", "price", "changePercent", "volume", "marketCap",
            "per", "priceToBook", "dividendYield", "change52w", "fromHigh52w", "vsSma50", "vsSma200",
            "fromLow52w", "avgVolume3m", "sharesOutstanding", "forwardPer", "eps", "analystRating",
            "rsRating", "score");

    private static final String DEFAULT_SORT = "symbol";

    /**
     * How many tickers come back starred. Five because the star is a shortlist to open one by
     * one, and a shortlist you have to page through is a second table, not a shortlist.
     */
    private static final int TOP_SIZE = 5;

    private final SymbolRepository repository;
    private final NasdaqTraderClient client;
    private final QuoteRefresher refresher;

    ScreenerService(SymbolRepository repository, NasdaqTraderClient client, QuoteRefresher refresher) {
        this.repository = repository;
        this.client = client;
        this.refresher = refresher;
    }

    /**
     * Every query is also what keeps the quotes alive: if they went stale a sweep starts in
     * the background and the page comes back flagged, so the UI can ask again in a moment
     * instead of anyone waiting for Yahoo.
     */
    @Transactional(readOnly = true)
    public ScreenerPage search(ScreenerFilters filters, int page, int size, String sort, boolean descending) {
        refresher.triggerIfStale();
        int safeSize = Math.clamp(size, 1, MAX_PAGE_SIZE);
        int safePage = Math.max(page, 0);
        Specification<Symbol> matching = SymbolSpecs.matching(filters);
        Page<Symbol> found = repository.findAll(
                matching,
                PageRequest.of(safePage, safeSize, sortBy(sort, descending)));
        return new ScreenerPage(
                found.getContent().stream().map(SymbolResponse::from).toList(),
                found.getTotalElements(),
                safePage,
                safeSize,
                refresher.isRunning(),
                refresher.lastQuotedAt(),
                top(matching));
    }

    /**
     * The best of the filtered set, worked out on the server because the browser only ever holds
     * one page of it. A second query rather than a flag on the row: which tickers are top depends
     * on what the filter left standing, so it cannot be stored — narrowing the filter promotes
     * whatever was second.
     *
     * <p>Unscored rows are excluded rather than sorted last: with an empty table or before the
     * first sweep, {@code NULLS_LAST} still returns five rows, and they would come back starred
     * as the best of a filter nobody has scored yet.
     */
    private List<String> top(Specification<Symbol> matching) {
        Specification<Symbol> scored = matching.and(
                (root, query, builder) -> builder.isNotNull(root.get("score")));
        return repository.findAll(scored, PageRequest.of(0, TOP_SIZE, sortBy("score", true)))
                .getContent().stream()
                .map(Symbol::getSymbol)
                .toList();
    }

    /**
     * Rows without a quote sink to the bottom whichever way the column is sorted: a null
     * is "not measured yet", not the smallest value.
     */
    private static Sort sortBy(String field, boolean descending) {
        String property = field != null && SORTABLE.contains(field) ? field : DEFAULT_SORT;
        Sort.Direction direction = descending ? Sort.Direction.DESC : Sort.Direction.ASC;
        return Sort.by(new Sort.Order(direction, property, Sort.NullHandling.NULLS_LAST));
    }

    /** Forces a sweep now, whatever the age of the quotes. Returns false if one is running. */
    public boolean refreshQuotes() {
        return refresher.trigger();
    }

    @Transactional(readOnly = true)
    public List<String> exchanges() {
        return repository.findExchanges();
    }

    /**
     * Rewrites the universe from the published files in one transaction: a ticker that
     * stopped being listed disappears, so the table always mirrors what Nasdaq Trader
     * says today rather than accumulating dead rows.
     */
    @Transactional
    public RefreshResult refresh() {
        Map<String, NasdaqTraderClient.Listing> incoming = client.fetchAll().stream()
                .filter(listing -> !listing.symbol().isEmpty())
                .collect(Collectors.toMap(
                        NasdaqTraderClient.Listing::symbol,
                        Function.identity(),
                        (first, duplicate) -> first,
                        LinkedHashMap::new));
        if (incoming.isEmpty()) {
            throw new ScreenerDataException("Nasdaq Trader returned no usable rows");
        }

        Map<String, Symbol> existing = repository.findAll().stream()
                .collect(Collectors.toMap(Symbol::getSymbol, Function.identity()));

        List<Symbol> toSave = new ArrayList<>();
        int added = 0;
        int updated = 0;
        for (NasdaqTraderClient.Listing listing : incoming.values()) {
            Symbol current = existing.get(listing.symbol());
            if (current == null) {
                toSave.add(new Symbol(listing.symbol(), listing.name(), listing.exchange()));
                added++;
            } else if (hasChanged(current, listing)) {
                current.update(listing.name(), listing.exchange());
                toSave.add(current);
                updated++;
            }
        }
        repository.saveAll(toSave);

        List<Symbol> stale = existing.values().stream()
                .filter(symbol -> !incoming.containsKey(symbol.getSymbol()))
                .toList();
        repository.deleteAll(stale);

        long total = incoming.size();
        log.info("Universe refreshed: {} added, {} updated, {} removed, {} listed", added, updated, stale.size(), total);
        return new RefreshResult(added, updated, stale.size(), total, OffsetDateTime.now());
    }

    private static boolean hasChanged(Symbol current, NasdaqTraderClient.Listing listing) {
        return !current.getName().equals(listing.name())
                || !current.getExchange().equals(listing.exchange());
    }

}
