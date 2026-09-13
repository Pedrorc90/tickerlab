package dev.tickerlab.broker;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BrokerAccountRepository extends JpaRepository<BrokerAccount, UUID> {

    List<BrokerAccount> findAllByOwnerIdOrderByCreatedAtAsc(UUID ownerId);

    /** The id alone is not enough: another owner's id is a 404, not a hit. */
    Optional<BrokerAccount> findByIdAndOwnerId(UUID id, UUID ownerId);

    boolean existsByOwnerIdAndNameIgnoreCase(UUID ownerId, String name);
}
