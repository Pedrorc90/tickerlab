package dev.tickerlab.broker.parse;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * A CSV reader that is enough for a broker statement and no more.
 *
 * <p>Hand-rolled rather than {@code split(",")} because a DeGiro statement cannot survive that:
 * its description column contains commas inside quotes ({@code "Transferir a su Cuenta de
 * Efectivo en flatexDEGIRO Bank: 0,04 EUR"}), and so does every amount, since the export uses the
 * Spanish decimal comma. Splitting on the separator turns one movement into four columns of
 * nonsense that still parses, which is the worst failure available.
 *
 * <p>Hand-rolled rather than a library because the two things needed on top — a decimal comma and
 * a row whose column count varies with whether the broker printed a trailing empty field — are
 * exactly the things a general CSV library will not do for you anyway.
 */
public final class CsvRows {

    private CsvRows() {
    }

    /** Every row including the header, fields unquoted and trimmed. */
    public static List<List<String>> read(InputStream in) throws IOException {
        List<List<String>> rows = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.isBlank()) {
                    rows.add(split(line));
                }
            }
        }
        return rows;
    }

    /**
     * One line into its fields. A quote inside a quoted field is doubled, which is the only
     * escaping the format has.
     */
    static List<String> split(String line) {
        List<String> fields = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (quoted) {
                if (c == '"') {
                    if (i + 1 < line.length() && line.charAt(i + 1) == '"') {
                        current.append('"');
                        i++;
                    } else {
                        quoted = false;
                    }
                } else {
                    current.append(c);
                }
            } else if (c == '"') {
                quoted = true;
            } else if (c == ',') {
                fields.add(current.toString().trim());
                current.setLength(0);
            } else {
                current.append(c);
            }
        }
        fields.add(current.toString().trim());
        return fields;
    }

    /** The field at {@code index}, or empty when the row is shorter than that. */
    public static String at(List<String> row, int index) {
        return index < row.size() ? row.get(index) : "";
    }

    /**
     * A Spanish-formatted number, or null when the cell is empty — which is not the same as zero
     * and must not become it: an empty transaction-cost cell is a fee that was never charged, and
     * a zero would read as one that was charged at nothing.
     */
    public static BigDecimal decimal(String cell) {
        if (cell == null || cell.isBlank()) {
            return null;
        }
        // Thousands separators are dots in this locale; strip them before flipping the comma.
        String normalised = cell.replace(".", "").replace(',', '.');
        try {
            return new BigDecimal(normalised);
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    /** The same, but an absent cell counts as nothing moved. For sums, where null is not useful. */
    public static BigDecimal decimalOrZero(String cell) {
        BigDecimal value = decimal(cell);
        return value == null ? BigDecimal.ZERO : value;
    }

    /**
     * The last non-empty field of a row. DeGiro prints the order id last, but whether it lands in
     * column 16 or 17 depends on whether that row carried a trailing empty field — reading it by
     * a fixed index returns the empty string for half the statement.
     */
    public static String lastNonBlank(List<String> row, int fromIndex) {
        for (int i = row.size() - 1; i >= fromIndex; i--) {
            if (!row.get(i).isBlank()) {
                return row.get(i);
            }
        }
        return "";
    }
}
