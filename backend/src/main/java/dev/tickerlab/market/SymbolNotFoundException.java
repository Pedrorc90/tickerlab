package dev.tickerlab.market;

/** Thrown when the requested ticker does not exist upstream. */
public class SymbolNotFoundException extends RuntimeException {

    public SymbolNotFoundException(String symbol) {
        super("Unknown symbol: " + symbol);
    }
}
