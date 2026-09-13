package dev.tickerlab.broker.dto;

import java.time.OffsetDateTime;

/**
 * What an upload actually did. {@code skipped} is the number that matters and the reason the
 * screen prints all four: re-importing a statement whose range overlaps one already loaded is the
 * normal way to add a period, so a run reporting "0 new, 431 already there" is the import working,
 * not failing — and an import reporting 431 new on the second try is the bug.
 *
 * @param parsed  lines the reader understood as movements
 * @param imported movements written
 * @param skipped movements already present, matched by fingerprint
 * @param ignored lines the reader did not understand as movements: blanks, and the header
 */
public record ImportResultResponse(
        int parsed,
        int imported,
        int skipped,
        int ignored,
        OffsetDateTime from,
        OffsetDateTime to,
        BrokerAccountResponse account
) {
}
