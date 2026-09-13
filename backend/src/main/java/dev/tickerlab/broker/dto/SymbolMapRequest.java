package dev.tickerlab.broker.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Naming the ticker an ISIN stands for. A blank symbol is not a rejected request but the way to
 * take the answer back: the user mistyped it, the line is now valued wrong, and there has to be a
 * road out that is not "type something else that is also wrong".
 */
public record SymbolMapRequest(
        @NotBlank @Size(max = 12) String isin,
        @Size(max = 20) String symbol
) {
}
