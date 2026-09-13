package dev.tickerlab.broker.dto;

import dev.tickerlab.broker.Broker;
import dev.tickerlab.broker.BrokerAccount;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * A real account with everything the screen prints, all of it derived from the imported rows.
 *
 * @param incompleteHistory true when at least one holding could not be explained by the imports —
 *                          shares sold that nothing ever bought. It is surfaced on the account and
 *                          not only on the line, because it makes every total below an
 *                          understatement, and a total that is quietly wrong is worse than a
 *                          missing one
 */
public record BrokerAccountResponse(
        String id,
        String name,
        Broker broker,
        int transactions,
        OffsetDateTime firstMovement,
        OffsetDateTime lastMovement,
        List<BalanceResponse> balances,
        List<FlowResponse> flows,
        List<HoldingResponse> holdings,
        boolean incompleteHistory,
        OffsetDateTime createdAt
) {

    /** An account with nothing imported yet: everything derived is empty, not null. */
    public static BrokerAccountResponse empty(BrokerAccount account) {
        return new BrokerAccountResponse(
                account.getId().toString(),
                account.getName(),
                account.getBroker(),
                0,
                null,
                null,
                List.of(),
                List.of(),
                List.of(),
                false,
                account.getCreatedAt());
    }
}
