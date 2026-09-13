package dev.tickerlab.broker.parse;

import dev.tickerlab.broker.TransactionKind;
import java.math.BigDecimal;
import java.time.OffsetDateTime;

/**
 * One statement line after parsing and before it belongs to anything. The parser knows nothing
 * about accounts or ownership: it turns a file into movements, and the service decides where they
 * go and which of them are already there.
 *
 * @param description what the statement called it. On a trade the instrument is the identity and
 *                    this adds little; on a dividend, a sweep or a connectivity fee it is the only
 *                    thing that tells one row from another, so it is also part of the fingerprint
 */
public record ParsedMovement(
        TransactionKind kind,
        OffsetDateTime executedAt,
        String isin,
        String product,
        String description,
        Long quantity,
        BigDecimal price,
        String priceCurrency,
        BigDecimal amount,
        String currency,
        BigDecimal fees,
        BigDecimal fxRate,
        String externalId) {

    /** The same movement relabelled, for when what a row means is only clear beside another row. */
    ParsedMovement as(TransactionKind other) {
        return new ParsedMovement(other, executedAt, isin, product, description, quantity, price,
                priceCurrency, amount, currency, fees, fxRate, externalId);
    }
}
