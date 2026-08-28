package dev.tickerlab.portfolio.dto;

import dev.tickerlab.portfolio.OrderSide;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

/**
 * There is no price here on purpose. The client asks for units of a symbol; the server decides
 * what they cost. A price sent from the browser is a price chosen after seeing the chart, which
 * is exactly the self-deception this whole screen exists to avoid.
 *
 * @param name the company label to cache on the order, optional
 */
public record OrderRequest(
        @NotBlank @Size(max = 20) String symbol,
        @Size(max = 120) String name,
        @NotNull OrderSide side,
        @Positive @Max(10_000_000) long quantity
) {
}
