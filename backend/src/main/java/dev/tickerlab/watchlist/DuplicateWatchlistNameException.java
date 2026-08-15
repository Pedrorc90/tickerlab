package dev.tickerlab.watchlist;

public class DuplicateWatchlistNameException extends RuntimeException {

    public DuplicateWatchlistNameException(String name) {
        super("Ya existe una lista llamada " + name);
    }
}
