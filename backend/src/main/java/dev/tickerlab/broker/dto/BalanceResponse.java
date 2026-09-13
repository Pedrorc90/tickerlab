package dev.tickerlab.broker.dto;

import java.math.BigDecimal;

/**
 * The cash left in one currency. A list of these and not a single total because one DeGiro
 * account really does hold two: a US fill settles in EUR while the dividend it later pays arrives
 * in USD, and the sweeps between them are movements of their own. Adding them would need a rate,
 * and a rate applied to a balance is a number nobody at the broker would recognise.
 */
public record BalanceResponse(String currency, BigDecimal amount) {
}
