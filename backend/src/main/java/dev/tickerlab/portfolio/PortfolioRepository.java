package dev.tickerlab.portfolio;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PortfolioRepository extends JpaRepository<Portfolio, UUID> {

    List<Portfolio> findAllByOwnerIdOrderByCreatedAtAsc(UUID ownerId);

    /** The id alone is not enough: another owner's id is a 404, not a hit. */
    Optional<Portfolio> findByIdAndOwnerId(UUID id, UUID ownerId);

    boolean existsByOwnerIdAndNameIgnoreCase(UUID ownerId, String name);
}
