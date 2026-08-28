package dev.tickerlab.portfolio;

public class DuplicatePortfolioNameException extends RuntimeException {

    public DuplicatePortfolioNameException(String name) {
        super("Ya existe una cartera llamada " + name);
    }
}
