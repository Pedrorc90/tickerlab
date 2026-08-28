package dev.tickerlab.portfolio;

/**
 * Neither the sweep nor the daily close could price the symbol. Refusing beats filling at a
 * made-up number: an order is the one place where a wrong price never stops being wrong.
 */
public class PriceUnavailableException extends RuntimeException {

    public PriceUnavailableException(String symbol) {
        super("No hay precio para " + symbol + " ahora mismo");
    }
}
