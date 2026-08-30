package dev.tickerlab.screener;

import jakarta.annotation.PreDestroy;
import java.math.BigDecimal;
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
import org.springframework.data.domain.PageRequest;
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

    /**
     * How big a move earns the second call. Three percent is where a gap stops being the spread
     * and starts being news, and it is the number that decides how much of the Alpaca budget the
     * morning spends: on a quiet day it keeps a few dozen symbols, on a loud one it hits the cap.
     */
    private static final BigDecimal MIN_GAP = new BigDecimal("3");

    /**
     * The two floors under the gap. A dollar and a hundred thousand shares a day is not a view
     * of what is worth trading — it is the line under which the premarket volume would not be
     * measuring anything: a sub-dollar shell gaps 60% on two prints, every morning, forever.
     */
    private static final BigDecimal MIN_PRICE = BigDecimal.ONE;
    private static final long MIN_AVG_VOLUME = 100_000L;

    /**
     * Ceiling on the second pass, in symbols. Two hundred is two calls and a list nobody could
     * read anyway; what it really buys is that a broken sweep — every gap null, or every gap
     * huge — cannot turn into six thousand calls to a rate-limited endpoint.
     */
    private static final int MAX_CANDIDATES = 200;

    private final SymbolRepository repository;
    private final YahooQuoteClient client;
    private final AlpacaBarsClient alpaca;
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

    QuoteRefresher(SymbolRepository repository, YahooQuoteClient client, AlpacaBarsClient alpaca,
                   TransactionTemplate transactions) {
        this.repository = repository;
        this.client = client;
        this.alpaca = alpaca;
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

    /**
     * The morning run, and the only caller that fills the premarket pair. Same one-at-a-time
     * guard as an ordinary sweep, because it contains one.
     */
    public boolean triggerPremarket() {
        if (!running.compareAndSet(false, true)) {
            return false;
        }
        worker.submit(() -> {
            try {
                premarketSweep();
            } catch (RuntimeException failure) {
                log.warn("Premarket sweep failed: {}", failure.getMessage());
            } finally {
                running.set(false);
            }
        });
        return true;
    }

    /**
     * Three steps that have to happen in this order. The pair is wiped first so nothing from
     * yesterday survives into a morning that fails halfway. Then the ordinary Yahoo sweep, which
     * is what writes the gap — that field rides along in the quote the sweep already fetches, so
     * this costs no extra call. Only then Alpaca, and only for the handful the gap kept: the
     * premarket volume is the one number that needs a second provider, and asking it about the
     * whole universe would be six thousand symbols to learn that five thousand of them did not
     * trade before the bell.
     */
    private void premarketSweep() {
        transactions.execute(status -> repository.clearPremarket());
        sweep();
        if (!alpaca.isConfigured()) {
            log.info("Premarket sweep: gaps written, volume skipped — no Alpaca credentials set");
            return;
        }
        List<String> candidates = repository.findGapCandidates(
                MIN_GAP, MIN_PRICE, MIN_AVG_VOLUME, PageRequest.of(0, MAX_CANDIDATES));
        long start = System.currentTimeMillis();
        int measured = 0;
        for (int index = 0; index < candidates.size(); index += AlpacaBarsClient.BATCH_SIZE) {
            List<String> batch = candidates.subList(index,
                    Math.min(index + AlpacaBarsClient.BATCH_SIZE, candidates.size()));
            measured += applyPremarketQuietly(batch);
        }
        log.info("Premarket sweep finished: {} of {} gapping symbols got their volume, in {} ms",
                measured, candidates.size(), System.currentTimeMillis() - start);
    }

    /** One rejected batch must not cost the run, same rule as the quote sweep. */
    private int applyPremarketQuietly(List<String> batch) {
        try {
            return applyPremarket(batch);
        } catch (RuntimeException failure) {
            log.warn("Skipped premarket volume for {} symbols starting at {}: {}",
                    batch.size(), batch.getFirst(), failure.getMessage());
            return 0;
        }
    }

    private int applyPremarket(List<String> batch) {
        Map<String, Long> volumes = alpaca.premarketVolume(batch);
        if (volumes.isEmpty()) {
            return 0;
        }
        return transactions.execute(status -> {
            List<Symbol> symbols = repository.findAllById(volumes.keySet());
            for (Symbol symbol : symbols) {
                symbol.premarketVolume(volumes.get(symbol.getSymbol()));
            }
            repository.saveAll(symbols);
            return symbols.size();
        });
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
            quoted += applyBatchQuietly(batch);
            pause();
        }
        int ranked = rank();
        int scored = score();
        log.info("Quote sweep finished: {} of {} symbols quoted, {} ratings and {} scores moved, in {} ms",
                quoted, universe.size(), ranked, scored, System.currentTimeMillis() - start);
    }

    /**
     * Ranks relative strength once the last batch is in, never per batch: a percentile only
     * means something against a finished universe, and scoring half-refreshed numbers would
     * rate the symbols swept first against yesterday's version of everyone else.
     */
    private int rank() {
        Integer moved = transactions.execute(status -> repository.rankRelativeStrength());
        return moved == null ? 0 : moved;
    }

    /**
     * Right after the ranking and never before it: the rating it just wrote is half of what the
     * score reads, so running these two the other way round would blend today's distance to the
     * high with yesterday's strength.
     */
    private int score() {
        Integer moved = transactions.execute(status -> repository.scoreStrength());
        return moved == null ? 0 : moved;
    }

    /**
     * One rejected row must not cost the sweep. A batch is written in a single transaction,
     * so a value Postgres refuses does take that batch down with it — but the next hundred
     * still go in, and the ranking at the end still runs, which is what used to be lost.
     */
    private int applyBatchQuietly(List<String> batch) {
        try {
            return applyBatch(batch);
        } catch (RuntimeException failure) {
            log.warn("Skipped a batch of {} symbols starting at {}: {}",
                    batch.size(), batch.getFirst(), failure.getMessage());
            return 0;
        }
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
