package dev.tickerlab.watchlist.dto;

import dev.tickerlab.watchlist.Watchlist;
import java.util.List;
import java.util.UUID;

public record WatchlistResponse(UUID id, String name, List<Entry> entries) {

    public record Entry(String symbol, String name) {
    }

    public static WatchlistResponse from(Watchlist watchlist) {
        List<Entry> entries = watchlist.getEntries().stream()
                .map(entry -> new Entry(entry.getSymbol(), entry.getName()))
                .toList();
        return new WatchlistResponse(watchlist.getId(), watchlist.getName(), entries);
    }
}
