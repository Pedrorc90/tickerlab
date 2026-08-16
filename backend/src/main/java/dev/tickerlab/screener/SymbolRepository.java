package dev.tickerlab.screener;

import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
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
}
