package dev.tickerlab.broker.dto;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.OffsetDateTime;

/**
 * What is still held of one instrument, rebuilt by walking its fills in order. Nothing about it
 * is stored: unlike the paper portfolio, which keeps a position row because it is the thing the
 * user is acting on, here the statement is the only truth and a cached average would be a second
 * version of it that can drift.
 *
 * @param avgCost the weighted average paid, in {@code priceCurrency}, untouched by sells — selling
 *                realises a profit, it does not change what the remaining shares cost
 * @param cost    what the <em>held</em> shares cost in the account currency, commissions included.
 *                Zero once the position closes, because the sells drew it down — which is why
 *                {@code invested} exists beside it
 * @param invested everything ever put into this position, never reduced by a sale
 * @param proceeds everything ever taken out of it: the sales, and any cash a corporate action
 *                 settled against it
 * @param realizedPercent the result against what went in, not against what came out — a position
 *                        that cost 100 and returned 150 made 50%, and dividing by the 150 would
 *                        call it 33%. Null when nothing was ever invested
 * @param complete false when the history does not reach back far enough to explain the position:
 *                 a sell arrived for shares no import ever bought. Every figure on the line is
 *                 then an understatement, and the screen has to say so rather than print a number
 *                 that looks finished
 * @param lastPrice what the ticker is worth now, in {@code priceCurrency} and unconverted: it is
 *                  the quote as the market prints it. Null when the ISIN has no ticker mapped yet,
 *                  or when nothing could quote the one it has
 * @param baseCurrency what the account is funded in, read off its deposits. Not the same as
 *                     {@code currency}: a euro account books its US fills in dollars
 * @param costBase what the held shares took out of {@code baseCurrency}, at the rate the statement
 *                 settled each fill at -- not at today's rate, which would erase the currency move
 *                 entirely. Null when any fill of the position had no currency leg to read
 * @param marketValue what the held shares are worth now, in {@code baseCurrency} -- the quote times
 *                    the units, converted at today's rate. Null whenever the price or the rate is
 * @param unrealizedPnl the open result in {@code baseCurrency}: that value against {@code costBase}.
 *                      In the account's own currency on purpose, so it is the figure the broker
 *                      prints rather than the one the position would have made at a frozen rate
 * @param unrealizedPercent the same against what the held shares cost
 */
public record HoldingResponse(
        String isin,
        String product,
        String symbol,
        long quantity,
        BigDecimal avgCost,
        String priceCurrency,
        BigDecimal cost,
        BigDecimal invested,
        BigDecimal proceeds,
        BigDecimal realizedPnl,
        BigDecimal realizedPercent,
        String currency,
        OffsetDateTime openedAt,
        boolean complete,
        String baseCurrency,
        BigDecimal costBase,
        BigDecimal lastPrice,
        BigDecimal marketValue,
        BigDecimal unrealizedPnl,
        BigDecimal unrealizedPercent
) {

    /**
     * The same line marked to market, in the currency the account is funded in.
     *
     * <p>Which is not the currency the fills were booked in, and that distinction is the whole
     * point. A DeGiro account buys Apple in dollars and books the trade in dollars, so comparing
     * the dollar quote against the dollar cost gives the return the position would have made had
     * the exchange rate stood still -- 67% on a holding the broker was printing at 54,5%. The gap
     * is the dollar falling against the euro, which is a result the owner of a euro account
     * actually had. Valued against {@code costBase}, the figure is the broker's.
     *
     * <p>{@code lastPrice} stays in {@code priceCurrency}: it is the quote as the market prints
     * it, and converting it would leave a number that matches no screen anywhere.
     *
     * @param price null when nothing could quote the ticker
     * @param fx    what one unit of {@code priceCurrency} buys in {@code baseCurrency}. Null when
     *              nothing could price the pair -- and, like a null price or a null
     *              {@code costBase}, it leaves the line with its dashes rather than valuing it at
     *              what it cost, which would print a position quietly pretending nothing moved
     */
    public HoldingResponse quoted(String ticker, BigDecimal price, BigDecimal fx) {
        if (quantity <= 0 || price == null || fx == null || costBase == null) {
            return new HoldingResponse(isin, product, ticker, quantity, avgCost, priceCurrency,
                    cost, invested, proceeds, realizedPnl, realizedPercent, currency, openedAt,
                    complete, baseCurrency, costBase, price, null, null, null);
        }
        BigDecimal value = price.multiply(BigDecimal.valueOf(quantity)).multiply(fx)
                .setScale(2, RoundingMode.HALF_UP);
        // Against what the euros actually paid for the shares still held. Commissions stay out of
        // it, because they are out of the broker's own percentage too: DeGiro divides by the
        // 175,63 of the currency leg, not by the 177,63 that includes the 2 it charged.
        BigDecimal open = value.subtract(costBase);
        BigDecimal percent = costBase.signum() <= 0 ? null
                : open.multiply(BigDecimal.valueOf(100)).divide(costBase, 2, RoundingMode.HALF_UP);
        return new HoldingResponse(isin, product, ticker, quantity, avgCost, priceCurrency, cost,
                invested, proceeds, realizedPnl, realizedPercent, currency, openedAt, complete,
                baseCurrency, costBase, price, value, open, percent);
    }
}
