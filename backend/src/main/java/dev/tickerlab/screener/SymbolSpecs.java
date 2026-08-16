package dev.tickerlab.screener;

import dev.tickerlab.screener.dto.ScreenerFilters;
import jakarta.persistence.criteria.Path;
import jakarta.persistence.criteria.Predicate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.data.jpa.domain.Specification;

/**
 * Turns the filter record into a query. Written as criteria rather than one JPQL string
 * with a dozen ":param is null or …" clauses: a filter nobody set contributes no predicate
 * at all, so the database plans the query it was actually given.
 *
 * <p>A row with no quote yet has nulls in these columns and drops out of any numeric
 * bound, which is the honest answer — it is unknown whether it belongs.
 */
final class SymbolSpecs {

    private SymbolSpecs() {
    }

    static Specification<Symbol> matching(ScreenerFilters filters) {
        return (root, query, builder) -> {
            List<Predicate> where = new ArrayList<>();

            String text = trimmed(filters.query());
            if (text != null) {
                String pattern = "%" + text.toLowerCase(Locale.ROOT) + "%";
                where.add(builder.or(
                        builder.like(builder.lower(root.get("symbol")), pattern),
                        builder.like(builder.lower(root.get("name")), pattern)));
            }

            String exchange = trimmed(filters.exchange());
            if (exchange != null) {
                where.add(builder.equal(root.get("exchange"), exchange));
            }

            atLeast(where, builder, root.get("marketCap"), filters.minMarketCap());
            atLeast(where, builder, root.get("price"), filters.minPrice());
            atMost(where, builder, root.get("price"), filters.maxPrice());
            atLeast(where, builder, root.get("volume"), filters.minVolume());
            atLeast(where, builder, root.get("changePercent"), filters.minChange());
            atMost(where, builder, root.get("changePercent"), filters.maxChange());
            atLeast(where, builder, root.get("per"), filters.minPer());
            atMost(where, builder, root.get("per"), filters.maxPer());
            atMost(where, builder, root.get("priceToBook"), filters.maxPriceToBook());
            atLeast(where, builder, root.get("dividendYield"), filters.minDividendYield());
            atLeast(where, builder, root.get("change52w"), filters.minChange52w());
            atLeast(where, builder, root.get("fromHigh52w"), filters.minFromHigh52w());
            atLeast(where, builder, root.get("vsSma50"), filters.minVsSma50());
            atMost(where, builder, root.get("vsSma50"), filters.maxVsSma50());
            atLeast(where, builder, root.get("vsSma200"), filters.minVsSma200());
            atMost(where, builder, root.get("vsSma200"), filters.maxVsSma200());
            atMost(where, builder, root.get("fromLow52w"), filters.maxFromLow52w());
            atLeast(where, builder, root.get("avgVolume3m"), filters.minAvgVolume3m());
            atLeast(where, builder, root.get("sharesOutstanding"), filters.minSharesOutstanding());
            atLeast(where, builder, root.get("forwardPer"), filters.minForwardPer());
            atMost(where, builder, root.get("forwardPer"), filters.maxForwardPer());
            atLeast(where, builder, root.get("eps"), filters.minEps());
            atMost(where, builder, root.get("analystRating"), filters.maxAnalystRating());

            return where.isEmpty() ? null : builder.and(where.toArray(new Predicate[0]));
        };
    }

    private static <T extends Comparable<? super T>> void atLeast(
            List<Predicate> where, jakarta.persistence.criteria.CriteriaBuilder builder, Path<T> column, T bound) {
        if (bound != null) {
            where.add(builder.greaterThanOrEqualTo(column, bound));
        }
    }

    private static <T extends Comparable<? super T>> void atMost(
            List<Predicate> where, jakarta.persistence.criteria.CriteriaBuilder builder, Path<T> column, T bound) {
        if (bound != null) {
            where.add(builder.lessThanOrEqualTo(column, bound));
        }
    }

    private static String trimmed(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
