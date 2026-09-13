package dev.tickerlab.broker.dto;

import dev.tickerlab.broker.TransactionKind;
import java.math.BigDecimal;

/**
 * Everything of one kind that moved, in one currency: the dividends collected, the tax withheld,
 * the commissions paid, the money put in.
 *
 * <p>This is the half of real accounting the trades export cannot give at all — it has no
 * dividend, no deposit and no interest in it — and the reason the cash book is the one worth
 * importing. Split by currency for the same reason the balances are: one account collects a
 * dividend in dollars and pays its custody fee in euros, and a single figure adding them would be
 * a number nobody at the broker would recognise.
 */
public record FlowResponse(TransactionKind kind, String currency, BigDecimal amount) {
}
