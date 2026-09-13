package dev.tickerlab.broker.parse;

import dev.tickerlab.broker.TransactionKind;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Component;

/**
 * Reads a DeGiro {@code Transactions.csv} — the fills, not the cash book.
 *
 * <p>The layout is read by position and not by header name: two of the columns are unnamed, since
 * the currency of the price and the currency of the local value both sit under an empty heading,
 * so there is no name to look them up by. The columns are:
 *
 * <pre>
 * 0 date   1 time   2 product   3 ISIN   4 venue   5 execution centre   6 quantity   7 price
 * 8 price currency  9 local value  10 local currency  11 value EUR  12 FX rate
 * 13 AutoFX commission  14 transaction costs  15 total EUR  16.. order id
 * </pre>
 */
@Component
public class DegiroTradesParser {

    /** The account currency of a DeGiro statement: columns 11 and 15 are labelled in it. */
    private static final String SETTLEMENT_CURRENCY = "EUR";

    private static final DateTimeFormatter DATE =
            DateTimeFormatter.ofPattern("dd-MM-yyyy", Locale.ROOT);
    private static final DateTimeFormatter TIME =
            DateTimeFormatter.ofPattern("HH:mm", Locale.ROOT);

    private static final int PRODUCT = 2;
    private static final int ISIN = 3;
    private static final int QUANTITY = 6;
    private static final int PRICE = 7;
    private static final int PRICE_CURRENCY = 8;
    private static final int FX_RATE = 12;
    private static final int AUTOFX_FEE = 13;
    private static final int TRANSACTION_COSTS = 14;
    private static final int TOTAL_EUR = 15;
    private static final int ORDER_ID = 16;

    /** A row narrower than this never held a fill; it is a blank line the export left behind. */
    private static final int MINIMUM_FIELDS = 16;

    public List<ParsedMovement> parse(InputStream in) throws IOException {
        List<List<String>> rows = CsvRows.read(in);
        List<ParsedMovement> movements = new ArrayList<>();
        // Skip the header: row 0 is the column names, and its quantity cell parses as nothing.
        for (int i = 1; i < rows.size(); i++) {
            ParsedMovement movement = movement(rows.get(i));
            if (movement != null) {
                movements.add(movement);
            }
        }
        return markCorporateActions(movements);
    }

    private ParsedMovement movement(List<String> row) {
        if (row.size() < MINIMUM_FIELDS) {
            return null;
        }
        BigDecimal quantity = CsvRows.decimal(CsvRows.at(row, QUANTITY));
        BigDecimal total = CsvRows.decimal(CsvRows.at(row, TOTAL_EUR));
        if (quantity == null || quantity.signum() == 0 || total == null) {
            return null;
        }
        OffsetDateTime when = instant(CsvRows.at(row, 0), CsvRows.at(row, 1));
        if (when == null) {
            return null;
        }
        // Both are charges and both are printed negative; summing keeps that sign, so the fee
        // reads as money that left rather than as a positive that has to be subtracted later.
        BigDecimal fees = CsvRows.decimalOrZero(CsvRows.at(row, AUTOFX_FEE))
                .add(CsvRows.decimalOrZero(CsvRows.at(row, TRANSACTION_COSTS)));

        return new ParsedMovement(
                quantity.signum() > 0 ? TransactionKind.BUY : TransactionKind.SELL,
                when,
                emptyToNull(CsvRows.at(row, ISIN)),
                emptyToNull(CsvRows.at(row, PRODUCT)),
                // No description on this export: the instrument is the identity of every row.
                null,
                quantity.longValueExact(),
                CsvRows.decimal(CsvRows.at(row, PRICE)),
                emptyToNull(CsvRows.at(row, PRICE_CURRENCY)),
                total,
                SETTLEMENT_CURRENCY,
                fees,
                CsvRows.decimal(CsvRows.at(row, FX_RATE)),
                emptyToNull(CsvRows.lastNonBlank(row, ORDER_ID)));
    }

    /**
     * Finds the pairs DeGiro writes for a reincorporation or a ticker change and relabels both
     * legs, so neither is counted as a trade.
     *
     * <p>The signature is a swap of one instrument for another: same instant, same number of
     * shares, same price, opposite signs, and <strong>no order id</strong> — nobody placed it. The
     * two ISINs differ, which is the whole point: the old entity goes out and the new one comes
     * in. The commission is zero on both legs too, but that is deliberately not part of the test —
     * a free trade is a promotion, not a corporate action.
     *
     * <p>Getting this wrong is not cosmetic. Rocket Lab reincorporated on 27-05-2025 at 25,42 $,
     * well under the 29,99 $ the shares were actually bought at in January; taken as a purchase it
     * rewrites the cost of a position to the price of a piece of paperwork.
     */
    private List<ParsedMovement> markCorporateActions(List<ParsedMovement> movements) {
        List<ParsedMovement> result = new ArrayList<>(movements);
        boolean[] paired = new boolean[result.size()];
        for (int i = 0; i < result.size(); i++) {
            if (paired[i]) {
                continue;
            }
            for (int j = i + 1; j < result.size(); j++) {
                if (!paired[j] && swapOf(result.get(i), result.get(j))) {
                    paired[i] = true;
                    paired[j] = true;
                    result.set(i, result.get(i).as(TransactionKind.CORPORATE_ACTION));
                    result.set(j, result.get(j).as(TransactionKind.CORPORATE_ACTION));
                    break;
                }
            }
        }
        return result;
    }

    private boolean swapOf(ParsedMovement one, ParsedMovement other) {
        if (one.externalId() != null || other.externalId() != null) {
            return false;
        }
        if (one.quantity() == null || other.quantity() == null
                || one.price() == null || other.price() == null
                || one.isin() == null || other.isin() == null) {
            return false;
        }
        // longValue() and not ==: these are boxed, and outside the cache == compares references.
        return one.executedAt().equals(other.executedAt())
                && one.quantity().longValue() == -other.quantity().longValue()
                && one.price().compareTo(other.price()) == 0
                && !one.isin().equals(other.isin());
    }

    /**
     * Statements print a wall-clock time with no offset. It is stored as UTC rather than guessed
     * into a zone: the alternative is a date that shifts when the server moves, and the day a fill
     * happened is the one thing about it nobody may rewrite.
     */
    private OffsetDateTime instant(String date, String time) {
        try {
            LocalDate day = LocalDate.parse(date, DATE);
            LocalTime clock = time == null || time.isBlank()
                    ? LocalTime.MIDNIGHT
                    : LocalTime.parse(time, TIME);
            return day.atTime(clock).atOffset(ZoneOffset.UTC);
        } catch (DateTimeParseException ex) {
            return null;
        }
    }

    private static String emptyToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
