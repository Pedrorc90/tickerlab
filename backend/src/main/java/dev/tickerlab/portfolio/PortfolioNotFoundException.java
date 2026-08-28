package dev.tickerlab.portfolio;

import java.util.UUID;

public class PortfolioNotFoundException extends RuntimeException {

    public PortfolioNotFoundException(UUID id) {
        super("No existe la cartera " + id);
    }
}
