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
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * Reads a DeGiro {@code Account.csv} — the whole cash book, not just the fills.
 *
 * <p>This is the export worth having. It carries the trades <em>and</em> the dividends, the
 * withholding, the commissions, both legs of every currency conversion and the transfers to the
 * bank; and because it prints a running balance, what this parser produces can be checked against
 * the broker's own figure instead of merely being believed.
 *
 * <p><strong>The header lies.</strong> It names twelve columns and the data sits one to the left
 * of five of them: {@code Tipo} stands over the exchange rate, {@code Variación} over the currency,
 * the blank after it over the amount, {@code Saldo} over the balance currency and the second blank
 * over the balance. Read by name and every amount comes back as a currency code. So, by position:
 *
 * <pre>
 * 0 date  1 time  2 value date  3 product  4 ISIN  5 description  6 FX rate
 * 7 currency  8 amount  9 balance currency  10 balance  11 order id
 * </pre>
 */
@Component
public class DegiroCashParser {

    private static final DateTimeFormatter DATE =
            DateTimeFormatter.ofPattern("dd-MM-yyyy", Locale.ROOT);
    private static final DateTimeFormatter TIME =
            DateTimeFormatter.ofPattern("HH:mm", Locale.ROOT);

    private static final int PRODUCT = 3;
    private static final int ISIN = 4;
    private static final int DESCRIPTION = 5;
    private static final int FX_RATE = 6;
    private static final int CURRENCY = 7;
    private static final int AMOUNT = 8;
    private static final int ORDER_ID = 11;

    private static final int MINIMUM_FIELDS = 11;

    /**
     * The fill hidden inside a description: {@code Compra 2 NVIDIA Corp@94 USD (US67066G1040)}.
     * The price carries a decimal comma, which is why the number class is {@code [\\d.,]} and not
     * {@code [\\d.]} — {@code Venta 9 Cellebrite DI Ltd@18,28 USD} would otherwise read as 18.
     */
    private static final Pattern FILL = Pattern.compile(
            "^(Compra|Venta)\\s+(\\d+)\\s+(.+?)@([\\d.,]+)\\s+([A-Z]{3})");

    /**
     * The shouted label DeGiro puts in front of a line when the fill was not a fill: {@code CAMBIO
     * DE ISIN: Compra 5 Rocket Lab Corp@25,42 USD}. Always upper case, always before the verb.
     *
     * <p>Matched as a shape rather than as a list of the three labels seen so far, because the
     * failure mode of not recognising one is the worst this parser has: the line stops looking
     * like a trade, falls through to {@code OTHER}, moves no shares, and the holding stays in the
     * account forever. That is exactly how a Virgin Galactic sold in 2024 was still on the screen —
     * {@code DESLISTAMIENTO : Venta 12 …} was not on the list.
     */
    private static final Pattern LABEL = Pattern.compile("^([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ ]{2,28})\\s*:\\s*");

    private static final String DELISTING = "DESLISTAMIENTO";

    /** The cash sweep whose amount lives in the sentence instead of the amount column. */
    private static final Pattern TRANSFER = Pattern.compile(
            "^Transferir (a|desde) su Cuenta de Efectivo en flatexDEGIRO Bank:\\s*([\\d.,]+)\\s+([A-Z]{3})");

    public List<ParsedMovement> parse(InputStream in) throws IOException {
        List<List<String>> rows = CsvRows.read(in);
        List<ParsedMovement> movements = new ArrayList<>();
        for (int i = 1; i < rows.size(); i++) {
            ParsedMovement movement = movement(rows.get(i));
            if (movement != null) {
                movements.add(movement);
            }
        }
        return movements;
    }

    private ParsedMovement movement(List<String> row) {
        if (row.size() < MINIMUM_FIELDS) {
            return null;
        }
        String description = CsvRows.at(row, DESCRIPTION);
        String currency = CsvRows.at(row, CURRENCY);

        BigDecimal amount = CsvRows.decimal(CsvRows.at(row, AMOUNT));
        Transfer transfer = amount == null ? transferIn(description) : null;
        if (transfer != null) {
            amount = transfer.amount();
            currency = transfer.currency();
        }
        if (amount == null) {
            return null;                        // a line that genuinely moved nothing
        }
        OffsetDateTime when = instant(CsvRows.at(row, 0), CsvRows.at(row, 1));
        if (when == null) {
            return null;
        }

        Fill fill = fillIn(description);

        return new ParsedMovement(
                kindOf(description, fill),
                when,
                emptyToNull(CsvRows.at(row, ISIN)),
                emptyToNull(CsvRows.at(row, PRODUCT)),
                emptyToNull(description),
                fill == null ? null : fill.quantity,
                fill == null ? null : fill.price,
                fill == null ? null : fill.currency,
                amount,
                currency.isBlank() ? "EUR" : currency,
                // Nothing is folded into a cash row: a commission here is a line of its own, which
                // is exactly what makes this export reconcile. Charging it twice — once inside the
                // trade and once as its own row — is the mistake this zero prevents.
                BigDecimal.ZERO,
                CsvRows.decimal(CsvRows.at(row, FX_RATE)),
                emptyToNull(CsvRows.at(row, ORDER_ID)));
    }

    /**
     * What a line means, from the words DeGiro used. A lookup over the vocabulary of one broker
     * and not a general classifier: the list is twenty phrases long and it is better to leave an
     * unknown one as {@link TransactionKind#OTHER} — where it still moves the balance and still
     * shows its own description on screen — than to guess it into a category it will be summed in.
     */
    private TransactionKind kindOf(String description, Fill fill) {
        String text = description == null ? "" : description.trim();
        String label = label(text);

        if (label != null) {
            // A delisting really does move the shares — they leave the account, usually against
            // nothing, and whatever the company was finally worth arrives separately as a cash
            // settlement. So it is a sale, not a swap: nothing replaced it.
            if (label.startsWith(DELISTING) && fill != null) {
                return fill.buy ? TransactionKind.BUY : TransactionKind.SELL;
            }
            // Everything else DeGiro shouts about — a reincorporation, a split adjustment, or a
            // label not seen yet — is a corporate action. Unknown ones land here rather than in
            // OTHER on purpose: this way they are named on screen and counted, instead of moving
            // shares nobody notices.
            return TransactionKind.CORPORATE_ACTION;
        }
        String lower = text.toLowerCase(Locale.ROOT);
        // The cash settlement paid when a corporate action leaves a fraction, or when a delisted
        // holding is finally worth something. It names its instrument and moves money but no
        // shares, and the ledger credits it to that position rather than to the account at large.
        if (lower.startsWith("acciones corporativas")) {
            return TransactionKind.CORPORATE_ACTION;
        }
        // DeGiro parks idle cash in a money-market fund and reprices it, over and over: 161 of the
        // 1.429 lines of one real statement are this. It is the yield on cash, so it is interest —
        // it can be negative, which interest on a fund can be.
        if (lower.startsWith("fondos del mercado monetario")) {
            return TransactionKind.INTEREST;
        }
        // Moving cash into and out of that fund. Not a trade, whatever the words say: the units
        // are of the fund, not of anything this app tracks, and treating them as a fill would put
        // a phantom position on the screen.
        if (lower.startsWith("conversión fondos") || lower.startsWith("conversion fondos")) {
            return TransactionKind.OTHER;
        }
        if (fill != null) {
            return fill.buy ? TransactionKind.BUY : TransactionKind.SELL;
        }
        if (lower.startsWith("retención del dividendo") || lower.startsWith("retencion del dividendo")) {
            return TransactionKind.WITHHOLDING;      // before "dividendo", which it also contains
        }
        if (lower.startsWith("dividendo") || lower.startsWith("rendimiento de capital")) {
            return TransactionKind.DIVIDEND;
        }
        if (lower.startsWith("costes de transacción") || lower.startsWith("costes de transaccion")
                || lower.startsWith("comisión de conectividad") || lower.startsWith("comision de conectividad")
                || lower.contains("pass-through fee")) {
            return TransactionKind.FEE;
        }
        if (lower.contains("cambio de divisa")) {
            return TransactionKind.FX;
        }
        if (lower.contains("interest income")) {
            return TransactionKind.INTEREST;
        }
        if (lower.startsWith("flatex deposit") || lower.equals("ingreso")) {
            return TransactionKind.DEPOSIT;
        }
        if (lower.contains("withdrawal")) {
            return TransactionKind.WITHDRAWAL;
        }
        // The cash sweep between the investment account and the flatex bank account behind it.
        // Left as OTHER on purpose: it is neither a deposit nor a fee, it is the same money
        // sitting somewhere else, and folding it into either would misstate both.
        return TransactionKind.OTHER;
    }

    private record Fill(boolean buy, long quantity, BigDecimal price, String currency) {
    }

    private record Transfer(BigDecimal amount, String currency) {
    }

    /**
     * The sweep between the investment account and the flatexDEGIRO bank account behind it, whose
     * amount DeGiro writes <em>into the sentence</em> and leaves out of the amount column:
     * {@code Transferir a su Cuenta de Efectivo en flatexDEGIRO Bank: 0,04 EUR}.
     *
     * <p>These were read as lines that moved nothing, which was wrong and not slightly: 166 of
     * them in one real statement, netting 1.754,14 € — the balance came out that far from the
     * broker's own. The sign is the direction the tracked balance goes, which is what the running
     * balance in the file says it is: money sent <em>to</em> the cash account arrives in it.
     */
    private Transfer transferIn(String description) {
        if (description == null) {
            return null;
        }
        Matcher matcher = TRANSFER.matcher(description.trim());
        if (!matcher.find()) {
            return null;
        }
        BigDecimal amount = CsvRows.decimal(matcher.group(2));
        if (amount == null) {
            return null;
        }
        return new Transfer("desde".equals(matcher.group(1)) ? amount.negate() : amount,
                matcher.group(3));
    }

    /** The shouted label in front of a description, or null when there is none. */
    private String label(String text) {
        Matcher matcher = LABEL.matcher(text);
        return matcher.find() ? matcher.group(1).trim() : null;
    }

    /** The trade inside a description, or null when the line is not one. */
    private Fill fillIn(String description) {
        if (description == null) {
            return null;
        }
        String text = description.trim();
        Matcher label = LABEL.matcher(text);
        if (label.find()) {
            text = text.substring(label.end());
        }
        // Fund conversions borrow the words of a trade — "Venta 17 @ 1,0234 EUR" — without naming
        // an instrument. They are excluded by name rather than left to the pattern, which happens
        // to reject them today only because it insists on something between the units and the "@".
        if (text.toLowerCase(Locale.ROOT).startsWith("fondos")
                || description.toLowerCase(Locale.ROOT).startsWith("conversión fondos")
                || description.toLowerCase(Locale.ROOT).startsWith("conversion fondos")) {
            return null;
        }
        Matcher matcher = FILL.matcher(text);
        if (!matcher.find()) {
            return null;
        }
        boolean buy = "Compra".equals(matcher.group(1));
        long units = Long.parseLong(matcher.group(2));
        BigDecimal price = CsvRows.decimal(matcher.group(4));
        if (price == null) {
            return null;
        }
        // Signed the way the rest of the app signs it: positive bought, negative sold.
        return new Fill(buy, buy ? units : -units, price, matcher.group(5));
    }

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
