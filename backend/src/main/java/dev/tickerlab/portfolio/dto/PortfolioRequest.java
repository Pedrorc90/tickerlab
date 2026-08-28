package dev.tickerlab.portfolio.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

/**
 * Creating and renaming share a shape, as watchlists do. On a rename the cash is ignored: the
 * starting capital is frozen at creation, because every percentage already read off the
 * portfolio was measured against it.
 *
 * @param initialCash null falls back to the default, so the panel can create with one field
 */
public record PortfolioRequest(
        @NotBlank @Size(max = 60) String name,
        @DecimalMin("1") @DecimalMax("1000000000") BigDecimal initialCash
) {
}
