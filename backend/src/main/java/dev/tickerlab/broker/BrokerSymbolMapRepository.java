package dev.tickerlab.broker;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BrokerSymbolMapRepository
        extends JpaRepository<BrokerSymbolMap, BrokerSymbolMap.Key> {

    List<BrokerSymbolMap> findAllByIdOwnerId(UUID ownerId);

    Optional<BrokerSymbolMap> findByIdOwnerIdAndIdIsin(UUID ownerId, String isin);

    void deleteByIdOwnerIdAndIdIsin(UUID ownerId, String isin);
}
