package dev.tickerlab.portfolio;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface PortfolioOrderRepository extends JpaRepository<PortfolioOrder, UUID> {

    /** Newest first: the book is read from the last thing done, never from the first. */
    List<PortfolioOrder> findAllByPortfolioIdOrderByExecutedAtDesc(UUID portfolioId);

    /** Oldest first here: these become chart markers, and a chart runs left to right. */
    List<PortfolioOrder> findAllByPortfolioIdAndSymbolOrderByExecutedAtAsc(UUID portfolioId, String symbol);

    /**
     * Everything cashed in so far. Summed rather than kept as a column on the portfolio: a
     * running total that drifts from the book it is supposed to summarise is worse than a sum.
     */
    @Query("select coalesce(sum(o.realizedPnl), 0) from PortfolioOrder o where o.portfolioId = :portfolioId")
    BigDecimal sumRealizedPnl(UUID portfolioId);

    /** One statement for every portfolio of one owner, so the list endpoint stays at one query. */
    @Query("""
            select o.portfolioId, coalesce(sum(o.realizedPnl), 0)
            from PortfolioOrder o
            where o.portfolioId in :portfolioIds
            group by o.portfolioId
            """)
    List<Object[]> sumRealizedPnlByPortfolio(List<UUID> portfolioIds);
}
