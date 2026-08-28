package dev.tickerlab.portfolio;

import dev.tickerlab.portfolio.dto.OrderRequest;
import dev.tickerlab.portfolio.dto.OrderResponse;
import dev.tickerlab.portfolio.dto.PortfolioRequest;
import dev.tickerlab.portfolio.dto.PortfolioResponse;
import dev.tickerlab.user.AppUserRepository;
import dev.tickerlab.user.CurrentUser;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Ownership is filtered here and not in the repository, the same way {@code WatchlistService}
 * does it: the repository takes an owner id like any other parameter, and this is the one place
 * that decides whose id that is.
 */
@Service
public class PortfolioService {

    /**
     * What a new portfolio starts with. A round number on purpose — the same reason the backtest
     * normalises its equity curve to 100: the interesting figure is the percentage, and a tidy
     * base is the one that can be read off a total at a glance.
     */
    private static final BigDecimal DEFAULT_CASH = new BigDecimal("100000");

    private final PortfolioRepository repository;
    private final PortfolioOrderRepository orders;
    private final AppUserRepository users;
    private final PriceLookup prices;
    private final CurrentUser currentUser;

    PortfolioService(PortfolioRepository repository, PortfolioOrderRepository orders,
                     AppUserRepository users, PriceLookup prices, CurrentUser currentUser) {
        this.repository = repository;
        this.orders = orders;
        this.users = users;
        this.prices = prices;
        this.currentUser = currentUser;
    }

    /**
     * Every portfolio, each one valued. All of them in one price query and one sum query rather
     * than one pair per portfolio: the selector at the top of the screen shows the total of each,
     * so the list is never asked for without the numbers.
     */
    @Transactional(readOnly = true)
    public List<PortfolioResponse> list() {
        List<Portfolio> owned = repository.findAllByOwnerIdOrderByCreatedAtAsc(currentUser.id());
        if (owned.isEmpty()) {
            return List.of();
        }
        Set<String> tickers = new LinkedHashSet<>();
        owned.forEach(portfolio -> portfolio.getPositions().forEach(held -> tickers.add(held.getSymbol())));
        Map<String, PriceLookup.Snapshot> quotes = prices.snapshot(tickers);
        Map<UUID, BigDecimal> realized = realizedByPortfolio(owned.stream().map(Portfolio::getId).toList());

        List<PortfolioResponse> responses = new ArrayList<>(owned.size());
        for (Portfolio portfolio : owned) {
            responses.add(PortfolioResponse.from(portfolio, quotes,
                    realized.getOrDefault(portfolio.getId(), BigDecimal.ZERO)));
        }
        return responses;
    }

    @Transactional
    public PortfolioResponse create(PortfolioRequest request) {
        String trimmed = request.name().trim();
        requireFreeName(trimmed);
        Portfolio portfolio = new Portfolio();
        portfolio.setId(UUID.randomUUID());
        portfolio.setName(trimmed);
        portfolio.setOwner(users.getReferenceById(currentUser.id()));
        portfolio.setInitialCash(request.initialCash() == null ? DEFAULT_CASH : request.initialCash());
        return valued(repository.save(portfolio));
    }

    /** The starting cash is not touched here: it is frozen at creation, and the request says so. */
    @Transactional
    public PortfolioResponse rename(UUID id, PortfolioRequest request) {
        Portfolio portfolio = require(id);
        String trimmed = request.name().trim();
        if (!trimmed.equalsIgnoreCase(portfolio.getName())) {
            requireFreeName(trimmed);
        }
        portfolio.setName(trimmed);
        return valued(portfolio);
    }

    @Transactional
    public void delete(UUID id) {
        Portfolio portfolio = require(id);
        // The database would cascade this on its own, but JPA does not know the book is related:
        // leaving it to the foreign key means Hibernate holds order rows it believes still exist.
        orders.deleteAll(orders.findAllByPortfolioIdOrderByExecutedAtDesc(id));
        repository.delete(portfolio);
    }

    /**
     * Fills an order at the price the server looks up, writes it into the book and returns the
     * whole portfolio back so the panel repaints from one response.
     *
     * <p>One transaction for the three writes — cash, position and order row. A book that
     * records a fill the cash never paid for is worse than a failed order.
     */
    @Transactional
    public PortfolioResponse execute(UUID id, OrderRequest request) {
        Portfolio portfolio = require(id);
        String symbol = Portfolio.normalise(request.symbol());
        PriceLookup.Priced priced = prices.require(symbol);

        BigDecimal realized = null;
        if (request.side() == OrderSide.BUY) {
            portfolio.buy(symbol, request.quantity(), priced.price());
        } else {
            realized = portfolio.sell(symbol, request.quantity(), priced.price());
        }

        String name = request.name() == null || request.name().isBlank() ? priced.name() : request.name();
        orders.save(new PortfolioOrder(portfolio.getId(), symbol, name, request.side(),
                request.quantity(), priced.price(), realized, priced.source()));
        return valued(portfolio);
    }

    @Transactional(readOnly = true)
    public List<OrderResponse> orders(UUID id) {
        require(id);
        return orders.findAllByPortfolioIdOrderByExecutedAtDesc(id).stream()
                .map(OrderResponse::from)
                .toList();
    }

    /** The fills of one symbol, oldest first, for drawing them on the chart of that symbol. */
    @Transactional(readOnly = true)
    public List<OrderResponse> orders(UUID id, String symbol) {
        require(id);
        return orders.findAllByPortfolioIdAndSymbolOrderByExecutedAtAsc(id, Portfolio.normalise(symbol))
                .stream()
                .map(OrderResponse::from)
                .toList();
    }

    private PortfolioResponse valued(Portfolio portfolio) {
        List<String> tickers = portfolio.getPositions().stream().map(Position::getSymbol).toList();
        return PortfolioResponse.from(portfolio, prices.snapshot(tickers),
                orders.sumRealizedPnl(portfolio.getId()));
    }

    private Map<UUID, BigDecimal> realizedByPortfolio(List<UUID> ids) {
        Map<UUID, BigDecimal> sums = new HashMap<>();
        for (Object[] row : orders.sumRealizedPnlByPortfolio(ids)) {
            sums.put((UUID) row[0], (BigDecimal) row[1]);
        }
        return sums;
    }

    /** Someone else's portfolio is a 404 and not a 403: the id is not theirs to know about. */
    private Portfolio require(UUID id) {
        return repository.findByIdAndOwnerId(id, currentUser.id())
                .orElseThrow(() -> new PortfolioNotFoundException(id));
    }

    private void requireFreeName(String name) {
        if (repository.existsByOwnerIdAndNameIgnoreCase(currentUser.id(), name)) {
            throw new DuplicatePortfolioNameException(name);
        }
    }
}
