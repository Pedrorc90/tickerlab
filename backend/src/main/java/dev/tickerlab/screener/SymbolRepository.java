package dev.tickerlab.screener;

import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

/**
 * Filtering goes through {@link JpaSpecificationExecutor}: the screener has a dozen
 * optional bounds and building them as criteria keeps the unused ones out of the query.
 */
public interface SymbolRepository extends JpaRepository<Symbol, String>, JpaSpecificationExecutor<Symbol> {

    @Query("select distinct s.exchange from Symbol s order by s.exchange asc")
    List<String> findExchanges();

    @Query("select s.symbol from Symbol s order by s.symbol asc")
    List<String> findAllSymbols();

    /** Null on an empty table or before the first sweep: both mean "quotes are stale". */
    @Query("select max(s.quotedAt) from Symbol s")
    OffsetDateTime findLatestQuotedAt();

    /**
     * Scores the whole universe against itself, IBD-style, in one statement. Two percentiles
     * rather than one: the year's return says who has been winning, the distance to the
     * 50-day average says who is winning <em>now</em>, and the recent stretch is weighted
     * heavier for the same reason IBD weights its latest quarter at 40% — a stock that ran
     * last autumn and has gone flat since is not a leader today.
     *
     * <p>Those two are then ranked <em>again</em>, and that second pass is the point: adding
     * percentiles bunches everything toward the middle, because whoever leads on the year is
     * rarely the same name leading against the 50-day. Ranking the blended score spreads it
     * back over a flat 1-99, which is what makes the number mean what it says — an 80 is a
     * stock beating four out of five listed shares, not merely a high-ish score.
     *
     * <p>Percentiles have to be taken over the whole table, so this cannot be a
     * {@code Specification}: those filter row by row, and a rank has no meaning for one row.
     * Every symbol is rewritten, not just the ranked ones — the outer left join sets a null
     * on anything missing an input, so a ticker that loses its quote loses its rating instead
     * of keeping a stale one. Rows whose rating did not move are skipped by the last
     * predicate, which is most of them on a quiet sweep.
     *
     * @return how many ratings actually changed
     */
    @Modifying
    @Query(value = """
            UPDATE symbol s
            SET rs_rating = ranked.rating
            FROM (SELECT u.symbol, r.rating
                  FROM symbol u
                  LEFT JOIN (SELECT scored.symbol,
                                    -- CAST, not `::int`: a colon in a native query is read as
                                    -- the start of a named parameter before Postgres sees it.
                                    CAST(1 + FLOOR(98 * PERCENT_RANK() OVER (ORDER BY scored.score))
                                         AS integer) AS rating
                             FROM (SELECT symbol,
                                          0.6 * PERCENT_RANK() OVER (ORDER BY change_52w)
                                        + 0.4 * PERCENT_RANK() OVER (ORDER BY vs_sma_50) AS score
                                   FROM symbol
                                   WHERE change_52w IS NOT NULL
                                     AND vs_sma_50 IS NOT NULL) scored) r ON r.symbol = u.symbol) ranked
            WHERE s.symbol = ranked.symbol
              AND s.rs_rating IS DISTINCT FROM ranked.rating
            """, nativeQuery = true)
    int rankRelativeStrength();
}
