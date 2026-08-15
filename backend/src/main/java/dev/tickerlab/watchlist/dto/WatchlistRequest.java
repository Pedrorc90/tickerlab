package dev.tickerlab.watchlist.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Create and rename both carry just a name. */
public record WatchlistRequest(@NotBlank @Size(max = 60) String name) {
}
