package dev.tickerlab.portfolio;

import java.math.BigDecimal;

/** Refusing the order is the feature: a portfolio that goes negative is a spreadsheet. */
public class InsufficientCashException extends RuntimeException {

    public InsufficientCashException(BigDecimal cost, BigDecimal cash) {
        super("La orden cuesta " + cost.toPlainString() + " y en la cartera quedan "
                + cash.toPlainString());
    }
}
