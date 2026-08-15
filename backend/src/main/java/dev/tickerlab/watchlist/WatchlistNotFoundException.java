package dev.tickerlab.watchlist;

import java.util.UUID;

public class WatchlistNotFoundException extends RuntimeException {

    public WatchlistNotFoundException(UUID id) {
        super("No existe la lista " + id);
    }
}
