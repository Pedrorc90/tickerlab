package dev.tickerlab.portfolio;

/** Long only: selling what is not held would be opening a short, which this does not do. */
public class InsufficientSharesException extends RuntimeException {

    public InsufficientSharesException(String symbol, long requested, long held) {
        super("No se pueden vender " + requested + " de " + symbol + ": la cartera tiene " + held);
    }
}
