package dev.tickerlab.broker.dto;

import dev.tickerlab.broker.Broker;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Creating or renaming a real account. The broker is fixed at creation and ignored on a rename:
 * changing it would leave every imported row parsed by a reader that no longer applies.
 */
public record BrokerAccountRequest(
        @NotBlank @Size(max = 60) String name,
        @NotNull Broker broker
) {
}
