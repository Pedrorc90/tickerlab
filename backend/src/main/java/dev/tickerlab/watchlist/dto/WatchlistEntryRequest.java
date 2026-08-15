package dev.tickerlab.watchlist.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** The name is the label shown next to the ticker; the search box already has it. */
public record WatchlistEntryRequest(
        @NotBlank @Size(max = 20) String symbol,
        @Size(max = 120) String name) {
}
