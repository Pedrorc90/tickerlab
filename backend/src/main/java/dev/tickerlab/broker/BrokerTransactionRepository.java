package dev.tickerlab.broker;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface BrokerTransactionRepository extends JpaRepository<BrokerTransaction, UUID> {

    /** Newest first: a statement is read from the last thing that happened. */
    List<BrokerTransaction> findAllByAccountIdOrderByExecutedAtDesc(UUID accountId);

    /** Oldest first: holdings are rebuilt by walking one instrument forward through its fills. */
    List<BrokerTransaction> findAllByAccountIdOrderByExecutedAtAsc(UUID accountId);

    /**
     * The fingerprints already stored, so an import can skip what it has seen without a query per
     * row. Read as a set and compared in memory rather than left to the unique index and a caught
     * violation: a statement is thousands of rows, and most of a second upload is duplicates.
     */
    @Query("select t.fingerprint from BrokerTransaction t where t.accountId = :accountId")
    Set<String> fingerprintsOf(UUID accountId);

    /**
     * Which exports this account has been fed from. Read before every import: the two DeGiro files
     * describe the same money at two granularities, so an account has to commit to one of them.
     */
    @Query("select distinct t.statement from BrokerTransaction t where t.accountId = :accountId")
    Set<StatementKind> statementsOf(UUID accountId);

    void deleteAllByAccountId(UUID accountId);
}
