package dev.tickerlab.watchlist;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WatchlistRepository extends JpaRepository<Watchlist, UUID> {

    List<Watchlist> findAllByOrderByCreatedAtAsc();

    boolean existsByNameIgnoreCase(String name);
}
