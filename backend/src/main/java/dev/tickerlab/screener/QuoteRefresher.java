package dev.tickerlab.screener;

import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Keeps the quotes on the symbol table fresh without a schedule. Opening the screener is
 * what triggers a sweep, and only when the numbers already went stale — so the app never
 * calls Yahoo on a day nobody looks at it, and nobody ever waits for the twenty seconds
 * the full universe takes.
 */
@Component
public class QuoteRefresher {

    private static final Logger log = LoggerFactory.getLogger(QuoteRefresher.class);

    /** Yahoo delays its prices about this much, so asking more often buys nothing. */
    private static final Duration MAX_AGE = Duration.ofMinutes(15);

    /** A short breather between batches; the measured sweep never tripped a rate limit. */
    private static final long BATCH_PAUSE_MS = 50;

    private final SymbolRepository repository;
    private final YahooQuoteClient client;
    private final TransactionTemplate transactions;

    /**
     * One sweep at a time. Every screener page view calls in, and without this a slow
     * sweep would be joined by a second one on the next keystroke.
     */
    private final AtomicBoolean running = new AtomicBoolean(false);

    /** Single thread: the sweep runs off the request thread but never in parallel. */
    private final ExecutorService worker = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "quote-refresher");
        thread.setDaemon(true);
        return thread;
    });

    QuoteRefresher(SymbolRepository repository, YahooQuoteClient client, TransactionTemplate transactions) {
        this.repository = repository;
        this.client = client;
        this.transactions = transactions;
    }

    public boolean isRunning() {
        return running.get();
    }

    public OffsetDateTime lastQuotedAt() {
        return repository.findLatestQuotedAt();
    }

    /** Called on every screener query; cheap and silent unless there is work to do. */
    public void triggerIfStale() {
        if (isStale()) {
            trigger();
        }
    }

    /** Starts a sweep unless one is already under way. Returns whether this call started it. */
    public boolean trigger() {
        if (!running.compareAndSet(false, true)) {
            return false;
        }
        worker.submit(() -> {
            try {
                sweep();
            } catch (RuntimeException failure) {
                log.warn("Quote sweep failed: {}", failure.getMessage());
            } finally {
                running.set(false);
            }
        });
        return true;
    }

    private boolean isStale() {
        OffsetDateTime latest = repository.findLatestQuotedAt();
        return latest == null || latest.isBefore(OffsetDateTime.now().minus(MAX_AGE));
    }

    /**
     * Each batch is read, quoted and written in its own transaction: a sweep of the whole
     * universe takes about twenty seconds, and holding one transaction open that long
     * would leave the screener reading a snapshot that never moves.
     */
    private void sweep() {
        List<String> universe = repository.findAllSymbols();
        long start = System.currentTimeMillis();
        int quoted = 0;
        for (int index = 0; index < universe.size(); index += YahooQuoteClient.BATCH_SIZE) {
            List<String> batch = universe.subList(index,
                    Math.min(index + YahooQuoteClient.BATCH_SIZE, universe.size()));
            quoted += applyBatch(batch);
            pause();
        }
        log.info("Quote sweep finished: {} of {} symbols quoted in {} ms",
                quoted, universe.size(), System.currentTimeMillis() - start);
    }

    private int applyBatch(List<String> batch) {
        List<Quote> quotes = client.quotes(batch);
        if (quotes.isEmpty()) {
            return 0;
        }
        Map<String, Quote> bySymbol = new HashMap<>();
        for (Quote quote : quotes) {
            bySymbol.put(quote.symbol(), quote);
        }
        OffsetDateTime now = OffsetDateTime.now();
        return transactions.execute(status -> {
            List<Symbol> symbols = repository.findAllById(bySymbol.keySet());
            for (Symbol symbol : symbols) {
                Quote quote = bySymbol.get(symbol.getSymbol());
                if (quote != null) {
                    symbol.quote(quote, now);
                }
            }
            repository.saveAll(symbols);
            return symbols.size();
        });
    }

    private void pause() {
        try {
            Thread.sleep(BATCH_PAUSE_MS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new ScreenerDataException("Quote sweep was interrupted");
        }
    }

    @PreDestroy
    void stop() {
        worker.shutdownNow();
    }
}
