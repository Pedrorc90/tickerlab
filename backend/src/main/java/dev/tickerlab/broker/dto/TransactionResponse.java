package dev.tickerlab.broker.dto;

import dev.tickerlab.broker.BrokerTransaction;
import dev.tickerlab.broker.TransactionKind;
import java.math.BigDecimal;
import java.time.OffsetDateTime;

/** One line of the statement, exactly as it was imported. Never recomputed. */
public record TransactionResponse(
        String id,
        TransactionKind kind,
        OffsetDateTime executedAt,
        String isin,
        String product,
        String symbol,
        Long quantity,
        BigDecimal price,
        String priceCurrency,
        BigDecimal amount,
        String currency,
        BigDecimal fees,
        BigDecimal fxRate,
        String externalId,
        String sourceFile
) {

    public static TransactionResponse from(BrokerTransaction transaction) {
        return new TransactionResponse(
                transaction.getId().toString(),
                transaction.getKind(),
                transaction.getExecutedAt(),
                transaction.getIsin(),
                transaction.getProduct(),
                transaction.getSymbol(),
                transaction.getQuantity(),
                transaction.getPrice(),
                transaction.getPriceCurrency(),
                transaction.getAmount(),
                transaction.getCurrency(),
                transaction.getFees(),
                transaction.getFxRate(),
                transaction.getExternalId(),
                transaction.getSourceFile());
    }
}
