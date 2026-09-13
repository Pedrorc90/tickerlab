package dev.tickerlab.broker;

import dev.tickerlab.broker.dto.BrokerAccountRequest;
import dev.tickerlab.broker.dto.BrokerAccountResponse;
import dev.tickerlab.broker.dto.HoldingResponse;
import dev.tickerlab.broker.dto.ImportResultResponse;
import dev.tickerlab.broker.dto.TransactionResponse;
import dev.tickerlab.broker.parse.DegiroCashParser;
import dev.tickerlab.broker.parse.DegiroTradesParser;
import dev.tickerlab.broker.parse.ParsedMovement;
import dev.tickerlab.market.FxRates;
import dev.tickerlab.portfolio.PriceLookup;
import dev.tickerlab.user.AppUserRepository;
import dev.tickerlab.user.CurrentUser;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * Ownership is filtered here and not in the repository, the same way {@code PortfolioService} and
 * {@code WatchlistService} do it: the repository takes an owner id like any other parameter, and
 * this is the one place that decides whose id that is.
 */
@Service
public class BrokerService {

    /** The longest statement filename kept on a row; the column is 160 and truncating beats failing. */
    private static final int SOURCE_FILE_LIMIT = 160;

    private final BrokerAccountRepository accounts;
    private final BrokerTransactionRepository transactions;
    private final BrokerSymbolMapRepository tickers;
    private final AppUserRepository users;
    private final DegiroTradesParser trades;
    private final DegiroCashParser cash;
    private final PriceLookup prices;
    private final FxRates fx;
    private final CurrentUser currentUser;

    BrokerService(BrokerAccountRepository accounts, BrokerTransactionRepository transactions,
                  BrokerSymbolMapRepository tickers, AppUserRepository users,
                  DegiroTradesParser trades, DegiroCashParser cash, PriceLookup prices,
                  FxRates fx, CurrentUser currentUser) {
        this.accounts = accounts;
        this.transactions = transactions;
        this.tickers = tickers;
        this.users = users;
        this.trades = trades;
        this.cash = cash;
        this.prices = prices;
        this.fx = fx;
        this.currentUser = currentUser;
    }

    @Transactional(readOnly = true)
    public List<BrokerAccountResponse> list() {
        return accounts.findAllByOwnerIdOrderByCreatedAtAsc(currentUser.id()).stream()
                .map(this::valued)
                .toList();
    }

    @Transactional
    public BrokerAccountResponse create(BrokerAccountRequest request) {
        String trimmed = request.name().trim();
        requireFreeName(trimmed);
        BrokerAccount account = new BrokerAccount();
        account.setId(UUID.randomUUID());
        account.setName(trimmed);
        account.setBroker(request.broker());
        account.setOwner(users.getReferenceById(currentUser.id()));
        return BrokerAccountResponse.empty(accounts.save(account));
    }

    /** The broker is not touched here: it decides how every stored row was read. */
    @Transactional
    public BrokerAccountResponse rename(UUID id, BrokerAccountRequest request) {
        BrokerAccount account = require(id);
        String trimmed = request.name().trim();
        if (!trimmed.equalsIgnoreCase(account.getName())) {
            requireFreeName(trimmed);
        }
        account.setName(trimmed);
        return valued(account);
    }

    @Transactional
    public void delete(UUID id) {
        BrokerAccount account = require(id);
        // Same reason as on a portfolio: the database would cascade, but JPA does not know the
        // statement is related, so Hibernate would hold rows it believes still exist.
        transactions.deleteAllByAccountId(id);
        accounts.delete(account);
    }

    /**
     * Reads a statement into the account, skipping everything already there.
     *
     * <p>Idempotent by fingerprint and not by file, which is what makes adding a period safe: the
     * natural way to import 2024 is to re-export from the beginning, so most of what arrives on
     * the second upload is a movement already stored. Keying on the file name would import it all
     * again; keying on the broker's order id would import the corporate-action rows again, since
     * DeGiro leaves the id empty on the rows it writes itself.
     */
    @Transactional
    public ImportResultResponse importStatement(UUID id, MultipartFile file) {
        BrokerAccount account = require(id);
        if (account.getBroker() != Broker.DEGIRO) {
            throw new BrokerExceptions.UnreadableStatementException(
                    "De momento solo se leen extractos de DeGiro");
        }

        byte[] content = bytes(file);
        StatementKind statement = detect(content);
        requireSameStatement(id, statement);

        List<ParsedMovement> movements = read(content, statement);
        if (movements.isEmpty()) {
            throw new BrokerExceptions.UnreadableStatementException(
                    "El fichero no tiene movimientos que se puedan leer");
        }

        String source = sourceName(file);
        Set<String> seen = new HashSet<>(transactions.fingerprintsOf(id));
        List<BrokerTransaction> fresh = new ArrayList<>();
        for (ParsedMovement movement : movements) {
            BrokerTransaction row = new BrokerTransaction(id, movement, statement, source);
            // Checked against the batch as well as the database: a statement can legitimately
            // repeat a line, and two identical rows in one upload would collide on the index.
            if (seen.add(row.getFingerprint())) {
                fresh.add(row);
            }
        }
        transactions.saveAll(fresh);

        OffsetDateTime from = movements.stream().map(ParsedMovement::executedAt)
                .min(Comparator.naturalOrder()).orElse(null);
        OffsetDateTime to = movements.stream().map(ParsedMovement::executedAt)
                .max(Comparator.naturalOrder()).orElse(null);
        return new ImportResultResponse(movements.size(), fresh.size(),
                movements.size() - fresh.size(), 0, from, to, valued(account));
    }

    /**
     * Which of the two DeGiro exports this is, from its header row.
     *
     * <p>Detected rather than asked for. The user picking it from a dropdown is one wrong click
     * away from a book that reconciles against nothing, and the two headers could not be further
     * apart: only the cash book has a value date, only the trades export names an exchange.
     */
    private StatementKind detect(byte[] content) {
        String header = new String(content, StandardCharsets.UTF_8).lines().findFirst().orElse("");
        if (header.contains("Fecha valor") || header.contains("Saldo")) {
            return StatementKind.CASH;
        }
        if (header.contains("Bolsa de referencia") || header.contains("Centro de")) {
            return StatementKind.TRADES;
        }
        throw new BrokerExceptions.UnreadableStatementException(
                "No reconozco la cabecera. Sube el Account.csv o el Transactions.csv de DeGiro, "
                        + "sin abrirlos antes en Excel.");
    }

    /**
     * Refuses to mix the two exports in one account.
     *
     * <p>Not a duplicate check — a fingerprint would never catch this, because the rows really are
     * different rows. One purchase of NVIDIA is a single EUR-netted line in the trades export and
     * four lines in the cash book: the fill in USD, both legs of the currency conversion and the
     * commission. Loading both leaves the account having paid for it twice.
     */
    private void requireSameStatement(UUID id, StatementKind incoming) {
        Set<StatementKind> present = transactions.statementsOf(id);
        if (present.isEmpty() || present.contains(incoming)) {
            return;
        }
        String have = present.contains(StatementKind.CASH) ? "Account.csv" : "Transactions.csv";
        String want = incoming == StatementKind.CASH ? "Account.csv" : "Transactions.csv";
        throw new BrokerExceptions.UnreadableStatementException(
                "Esta cuenta ya lleva importado el " + have + ", y el " + want + " cuenta el mismo "
                        + "dinero de otra forma: sumarlos lo contaría dos veces. Borra la cuenta y "
                        + "vuelve a empezar con el que quieras, o usa una cuenta aparte. "
                        + "El Account.csv es el completo: trae dividendos, comisiones e ingresos.");
    }

    private byte[] bytes(MultipartFile file) {
        try {
            return file.getBytes();
        } catch (IOException ex) {
            throw new BrokerExceptions.UnreadableStatementException(
                    "No se pudo leer el fichero: " + ex.getMessage());
        }
    }

    private List<ParsedMovement> read(byte[] content, StatementKind statement) {
        try (ByteArrayInputStream in = new ByteArrayInputStream(content)) {
            return statement == StatementKind.CASH ? cash.parse(in) : trades.parse(in);
        } catch (IOException ex) {
            throw new BrokerExceptions.UnreadableStatementException(
                    "No se pudo leer el fichero: " + ex.getMessage());
        }
    }

    @Transactional(readOnly = true)
    public List<TransactionResponse> transactions(UUID id) {
        require(id);
        return transactions.findAllByAccountIdOrderByExecutedAtDesc(id).stream()
                .map(TransactionResponse::from)
                .toList();
    }

    /** Everything the screen shows, derived from the rows. See {@link Ledger}. */
    private BrokerAccountResponse valued(BrokerAccount account) {
        List<BrokerTransaction> ordered =
                transactions.findAllByAccountIdOrderByExecutedAtAsc(account.getId());
        if (ordered.isEmpty()) {
            return BrokerAccountResponse.empty(account);
        }
        Ledger.Snapshot snapshot = Ledger.of(ordered);
        return new BrokerAccountResponse(
                account.getId().toString(),
                account.getName(),
                account.getBroker(),
                ordered.size(),
                ordered.getFirst().getExecutedAt(),
                ordered.getLast().getExecutedAt(),
                snapshot.balances(),
                snapshot.flows(),
                marked(snapshot.holdings()),
                snapshot.incompleteHistory(),
                account.getCreatedAt());
    }

    /**
     * The holdings with today's price on them, where the user has said what the ISIN is.
     *
     * <p>Only the open lines are quoted. A closed position's result is already final and pricing
     * it would say what it would have been worth had it been kept, which is a different question
     * and not one this screen asks.
     */
    private List<HoldingResponse> marked(List<HoldingResponse> holdings) {
        Map<String, String> mapped = symbols();
        Set<String> wanted = holdings.stream()
                .filter(holding -> holding.quantity() > 0)
                .map(holding -> mapped.get(holding.isin()))
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<String, PriceLookup.Snapshot> quotes = prices.quotes(wanted);
        return holdings.stream()
                .map(holding -> {
                    String ticker = mapped.get(holding.isin());
                    PriceLookup.Snapshot quote = ticker == null ? null : quotes.get(ticker);
                    // The quote arrives in the currency the share trades in and the account is
                    // funded in another, so the rate is part of the valuation and not a decoration
                    // on it. Towards the base currency and not towards `currency`: the fills of a
                    // euro account are booked in dollars, so `currency` is already USD here and
                    // converting into it would be a no-op that leaves the dollar return on screen.
                    // Asked for per line because two holdings can trade in two currencies; cached
                    // inside FxRates, so a page of US positions still costs one call.
                    BigDecimal rate = fx.rate(
                            holding.priceCurrency() == null ? holding.currency()
                                    : holding.priceCurrency(),
                            holding.baseCurrency()).orElse(null);
                    return holding.quoted(ticker, quote == null ? null : quote.price(), rate);
                })
                .toList();
    }

    /** Every ISIN this user has already named, as one map. */
    @Transactional(readOnly = true)
    public Map<String, String> symbols() {
        return tickers.findAllByIdOwnerId(currentUser.id()).stream()
                .collect(Collectors.toMap(BrokerSymbolMap::getIsin, BrokerSymbolMap::getSymbol));
    }

    /**
     * Names an ISIN, or forgets it when the ticker comes back blank. Upper-cased because that is
     * how every other ticker in this app is stored, and a lookup for "aapl" would otherwise miss
     * the sweep and fall through to an HTTP call that answers the same thing.
     *
     * <p>Not validated against the market: a ticker this app cannot quote yet is still the right
     * answer to write down, and the line simply keeps its dashes until something can price it.
     */
    @Transactional
    public void mapSymbol(String isin, String symbol) {
        UUID owner = currentUser.id();
        String trimmed = symbol == null ? "" : symbol.trim().toUpperCase(Locale.ROOT);
        if (trimmed.isEmpty()) {
            tickers.deleteByIdOwnerIdAndIdIsin(owner, isin);
            return;
        }
        tickers.findByIdOwnerIdAndIdIsin(owner, isin)
                .ifPresentOrElse(row -> row.setSymbol(trimmed),
                        () -> tickers.save(new BrokerSymbolMap(owner, isin, trimmed)));
    }

    private static String sourceName(MultipartFile file) {
        String name = file.getOriginalFilename();
        if (name == null || name.isBlank()) {
            return "sin-nombre.csv";
        }
        return name.length() > SOURCE_FILE_LIMIT ? name.substring(0, SOURCE_FILE_LIMIT) : name;
    }

    private BrokerAccount require(UUID id) {
        return accounts.findByIdAndOwnerId(id, currentUser.id())
                .orElseThrow(() -> new BrokerExceptions.AccountNotFoundException(id));
    }

    private void requireFreeName(String name) {
        if (accounts.existsByOwnerIdAndNameIgnoreCase(currentUser.id(), name)) {
            throw new BrokerExceptions.DuplicateNameException(name);
        }
    }
}
