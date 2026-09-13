package dev.tickerlab.broker;

import dev.tickerlab.broker.dto.BalanceResponse;
import dev.tickerlab.broker.dto.FlowResponse;
import dev.tickerlab.broker.dto.HoldingResponse;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Rebuilds what an account holds and what cash is left, by walking its imported rows in order.
 *
 * <p>Nothing here is stored. A real account has no position table for the same reason it has no
 * cash column: the statement already says, and a running total kept beside it is a second version
 * of the same fact that can quietly disagree with the broker's.
 *
 * <p>Cost is carried as a weighted average and not FIFO. Both are defensible and they disagree on
 * the realised figure of a partly sold position; the average is chosen because it is the one the
 * screens of this app already print, and having two definitions of "what it cost" inside one
 * product is worse than either.
 */
final class Ledger {

    /** Enough decimals that a per-share average of an odd lot does not lose cents on the way. */
    private static final int WORKING_SCALE = 8;
    private static final int PRICE_SCALE = 4;
    private static final int MONEY_SCALE = 2;

    private Ledger() {
    }

    record Snapshot(List<BalanceResponse> balances, List<FlowResponse> flows,
                    List<HoldingResponse> holdings, boolean incompleteHistory) {
    }

    /**
     * The kinds worth totalling on their own. Fills are left out on purpose: a purchase is not an
     * expense and a sale is not income, and summing them beside the dividends would produce a
     * figure that means nothing. What is left is exactly what the trades export cannot tell you.
     */
    private static final List<TransactionKind> FLOW_KINDS = List.of(
            TransactionKind.DIVIDEND, TransactionKind.WITHHOLDING, TransactionKind.FEE,
            TransactionKind.INTEREST, TransactionKind.DEPOSIT, TransactionKind.WITHDRAWAL);

    /**
     * @param ordered every transaction of one account, oldest first — the order matters, since a
     *                sell is priced against whatever the average was at that moment
     */
    static Snapshot of(List<BrokerTransaction> ordered) {
        Map<String, BigDecimal> cash = new LinkedHashMap<>();
        Map<String, BigDecimal> flows = new LinkedHashMap<>();
        Map<String, Lot> lots = new LinkedHashMap<>();
        Map<String, Swap> swaps = swapTargets(ordered);
        Map<String, BigDecimal> fx = settlementRates(ordered);
        String base = baseCurrency(ordered);

        for (BrokerTransaction row : ordered) {
            cash.merge(row.getCurrency(), row.getAmount(), BigDecimal::add);
            if (FLOW_KINDS.contains(row.getKind())) {
                flows.merge(row.getKind() + "|" + row.getCurrency(), row.getAmount(), BigDecimal::add);
            }
            // A commission charged on a fill rather than as its own row — which is how the trades
            // export prints it — still belongs in the total of what this account has cost.
            if (row.getFees() != null && row.getFees().signum() != 0) {
                flows.merge(TransactionKind.FEE + "|" + row.getCurrency(), row.getFees(),
                        BigDecimal::add);
            }

            if (row.getIsin() == null) {
                continue;                       // a cash movement touching no instrument
            }
            // A corporate action can also be pure cash: the settlement paid for a fraction the
            // swap could not deliver, or what a delisted holding turned out to be worth. It
            // belongs to that position and nowhere else — booked as account income it would leave
            // the line showing the full cost as a loss when part of it came back.
            if (row.getQuantity() == null) {
                if (row.getKind() == TransactionKind.CORPORATE_ACTION) {
                    lots.computeIfAbsent(row.getIsin(), isin -> new Lot(isin, row.getProduct(),
                                    row.getPriceCurrency(), row.getCurrency(), row.getExecutedAt(),
                                    base))
                            .settle(row.getAmount());
                }
                continue;                       // a dividend or a fee names its instrument only
            }
            Lot lot = lots.computeIfAbsent(row.getIsin(), isin -> new Lot(isin, row.getProduct(),
                    row.getPriceCurrency(), row.getCurrency(), row.getExecutedAt(), base));

            switch (row.getKind()) {
                case BUY -> lot.buy(row.getQuantity(), row.getPrice(), row.getAmount().abs(),
                        settled(row, fx, base));
                case SELL -> lot.sell(-row.getQuantity(), row.getAmount());
                case CORPORATE_ACTION -> {
                    // Driven from the outgoing leg: the incoming one is the same handover seen
                    // from the other side, and applying it too would double the position.
                    if (row.getQuantity() < 0) {
                        Swap swap = swaps.get(key(row));
                        long out = -row.getQuantity();
                        if (swap == null) {
                            // Shares left and nothing replaced them: a delisting, an expiry, a
                            // holding written off. Settled against whatever cash moved — usually
                            // none, which realises the cost that is left as the loss it was — and
                            // flagged, because an event this app cannot name deserves a second
                            // look rather than a figure presented as final.
                            lot.sell(out, row.getAmount());
                            lot.complete = false;
                        } else if (swap.isin().equals(row.getIsin())) {
                            lot.split(out, swap.quantity());
                        } else {
                            lots.computeIfAbsent(swap.isin(), isin -> new Lot(isin, null,
                                            row.getPriceCurrency(), row.getCurrency(), lot.openedAt,
                                            base))
                                    .absorb(lot, out, swap.quantity());
                        }
                    }
                }
                default -> {
                    // A dividend or a fee names its instrument but moves no shares. It has already
                    // been counted in cash above, which is the only place it belongs.
                }
            }
        }
        return snapshot(cash, flows, lots, ordered);
    }

    /**
     * What a fill actually took out of the account's own currency.
     *
     * <p>A DeGiro account does not settle a US fill in euros. It books the trade in dollars and
     * moves the euros across in a separate FX pair beside it, so the buy row of an Apple share
     * says -188,10 USD and the euro it really cost -- 175,63 -- is only on the FX leg. Reading the
     * dollar figure as the cost is how a position that made 54% comes to claim it made 67: the
     * difference is the exchange rate moving, which is a result the owner of a euro account
     * genuinely had, and the broker's own screen counts it.
     *
     * @return the amount in {@code base}, or null when nothing in the import can say -- a fill
     *         with no FX leg is left unconverted rather than converted at today's rate, which
     *         would silently erase exactly the currency move this exists to capture
     */
    private static BigDecimal settled(BrokerTransaction row, Map<String, BigDecimal> fx,
                                      String base) {
        BigDecimal paid = row.getAmount().abs();
        if (base.equals(row.getCurrency())) {
            return paid;
        }
        BigDecimal rate = fx.get(key(row));
        if (rate == null || rate.signum() == 0) {
            return null;
        }
        return paid.divide(rate, WORKING_SCALE, RoundingMode.HALF_UP);
    }

    /**
     * The rate each fill settled at, from the FX rows the statement prints beside it. Keyed on
     * instrument and instant, which is how DeGiro pairs them: the FX leg carries the same ISIN and
     * the same timestamp as the trade it funds.
     */
    private static Map<String, BigDecimal> settlementRates(List<BrokerTransaction> ordered) {
        Map<String, BigDecimal> rates = new HashMap<>();
        for (BrokerTransaction row : ordered) {
            if (row.getKind() == TransactionKind.FX && row.getFxRate() != null
                    && row.getIsin() != null) {
                rates.put(key(row), row.getFxRate());
            }
        }
        return rates;
    }

    /**
     * The currency the account itself is in, read off the money put into it.
     *
     * <p>Deposits and withdrawals are the one kind that cannot be in anything else: the user funds
     * the account from a bank, and the bank is in one currency. Everything else lies about it --
     * two thirds of the fills here are in dollars, so counting rows would call this a dollar
     * account.
     */
    private static String baseCurrency(List<BrokerTransaction> ordered) {
        Map<String, Integer> funding = new LinkedHashMap<>();
        for (BrokerTransaction row : ordered) {
            if (row.getKind() == TransactionKind.DEPOSIT
                    || row.getKind() == TransactionKind.WITHDRAWAL) {
                funding.merge(row.getCurrency(), 1, Integer::sum);
            }
        }
        return funding.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey)
                // An account with nothing paid in yet -- a statement that starts mid-life -- falls
                // back to whatever most rows are in. It is a guess, and it only decides which
                // currency the totals are labelled with, never what they add up to.
                .orElseGet(() -> ordered.stream()
                        .collect(java.util.stream.Collectors.groupingBy(
                                BrokerTransaction::getCurrency,
                                java.util.stream.Collectors.counting()))
                        .entrySet().stream()
                        .max(Map.Entry.comparingByValue())
                        .map(Map.Entry::getKey)
                        .orElse("EUR"));
    }

    /** Where an outgoing leg of a corporate action sent its shares, and how many arrived. */
    private record Swap(String isin, long quantity) {
    }

    private static String key(BrokerTransaction row) {
        return row.getIsin() + "@" + row.getExecutedAt();
    }

    /**
     * For each outgoing leg of a corporate action, what replaced it. Built up front because the
     * legs share an instant and nothing orders them: reading them as they come would work whenever
     * the export happened to print the outgoing one first, and lose the cost basis when it did not.
     *
     * <p>Paired on the instant and the opposite sign, and on nothing else. An earlier version also
     * demanded a different ISIN and an equal number of shares, which describes exactly one event —
     * a one-for-one reincorporation — and fails on every other. A reverse split keeps the ISIN and
     * changes the count, so neither of its legs paired; and an unpaired leg did nothing at all, so
     * the shares stayed in the account forever. That is how a holding sold long ago goes on being
     * shown as held.
     */
    private static Map<String, Swap> swapTargets(List<BrokerTransaction> ordered) {
        Map<String, List<BrokerTransaction>> byInstant = new LinkedHashMap<>();
        for (BrokerTransaction row : ordered) {
            if (row.getKind() == TransactionKind.CORPORATE_ACTION && row.getQuantity() != null
                    && row.getQuantity() != 0 && row.getIsin() != null) {
                byInstant.computeIfAbsent(row.getExecutedAt().toString(), at -> new ArrayList<>())
                        .add(row);
            }
        }
        Map<String, Swap> targets = new HashMap<>();
        for (List<BrokerTransaction> group : byInstant.values()) {
            List<BrokerTransaction> incoming = new ArrayList<>(
                    group.stream().filter(row -> row.getQuantity() > 0).toList());
            for (BrokerTransaction out : group) {
                if (out.getQuantity() >= 0 || incoming.isEmpty()) {
                    continue;
                }
                // The leg of the same instrument wins when there is one: that is a split, and it
                // must not be read as a swap into whatever else happened to move in the same
                // second. Each incoming leg is claimed once, so two events at one instant do not
                // both consume the same arrival.
                BrokerTransaction in = incoming.stream()
                        .filter(candidate -> candidate.getIsin().equals(out.getIsin()))
                        .findFirst()
                        .orElse(incoming.getFirst());
                incoming.remove(in);
                targets.put(key(out), new Swap(in.getIsin(), in.getQuantity()));
            }
        }
        return targets;
    }

    private static Snapshot snapshot(Map<String, BigDecimal> cash, Map<String, BigDecimal> flows,
                                     Map<String, Lot> lots, List<BrokerTransaction> ordered) {
        List<BalanceResponse> balances = cash.entrySet().stream()
                .map(entry -> new BalanceResponse(entry.getKey(),
                        entry.getValue().setScale(MONEY_SCALE, RoundingMode.HALF_UP)))
                .sorted(Comparator.comparing(BalanceResponse::currency))
                .toList();

        List<FlowResponse> totals = flows.entrySet().stream()
                .map(entry -> {
                    // Split on the first bar rather than by regex: a currency code never contains
                    // one, and a kind name never contains one, so the first is always the seam.
                    int seam = entry.getKey().indexOf('|');
                    return new FlowResponse(
                            TransactionKind.valueOf(entry.getKey().substring(0, seam)),
                            entry.getKey().substring(seam + 1),
                            entry.getValue().setScale(MONEY_SCALE, RoundingMode.HALF_UP));
                })
                .filter(flow -> flow.amount().signum() != 0)
                .sorted(Comparator.comparing((FlowResponse flow) -> flow.kind().ordinal())
                        .thenComparing(FlowResponse::currency))
                .toList();

        // Products named by the statement, so a line that closed can still be labelled. Taken from
        // the newest mention: a reincorporated company is known by the name it has now.
        Map<String, String> names = new HashMap<>();
        for (BrokerTransaction row : ordered) {
            if (row.getIsin() != null && row.getProduct() != null) {
                names.put(row.getIsin(), row.getProduct());
            }
        }

        boolean incomplete = false;
        List<HoldingResponse> holdings = new ArrayList<>();
        for (Lot lot : lots.values()) {
            incomplete |= !lot.complete;
            // A closed position stays on the list as long as it realised something: that profit is
            // the point of keeping real accounts, and dropping the line because the shares are
            // gone would hide every trade that actually worked. What does get dropped is a lot
            // that ended flat and explained — an instrument that only ever passed through, such as
            // the side of a reincorporation that handed its shares on.
            if (lot.quantity == 0 && lot.realized.signum() == 0 && lot.complete) {
                continue;
            }
            holdings.add(lot.toResponse(names.getOrDefault(lot.isin, lot.product)));
        }
        holdings.sort(Comparator.comparing(holding ->
                holding.product() == null ? holding.isin() : holding.product()));
        return new Snapshot(balances, totals, holdings, incomplete);
    }

    /** What is held of one instrument while the walk is in progress. */
    private static final class Lot {

        private final String isin;
        private String product;
        private final String priceCurrency;
        private final String currency;
        private final String baseCurrency;
        private OffsetDateTime openedAt;

        private long quantity;
        /** Sum of price × units still held, in the price currency. Divided out for the average. */
        private BigDecimal gross = BigDecimal.ZERO;
        /** What the held units cost in the currency the fills were booked in. */
        private BigDecimal cost = BigDecimal.ZERO;
        /**
         * The same, in the currency the account is actually funded in -- what the euros really
         * left. Drawn down by sells exactly as {@code cost} is, so it always describes the shares
         * still held. Null once any fill could not be converted, because a base cost missing one
         * of its buys is not a smaller number, it is a wrong one.
         */
        private BigDecimal costBase = BigDecimal.ZERO;
        private BigDecimal realized = BigDecimal.ZERO;

        /**
         * Everything ever put in and everything ever taken out, and neither is ever reduced.
         * {@code cost} cannot answer this: it is drawn down as the shares are sold, so a position
         * that closed shows zero, and "I made 128 $" without "on how much" is not a result — it is
         * a number that reads the same on a 200 $ bet and a 20.000 $ one.
         */
        private BigDecimal invested = BigDecimal.ZERO;
        private BigDecimal proceeds = BigDecimal.ZERO;

        /**
         * False once something happened that the imports cannot explain — shares sold that no
         * import ever bought. Every figure on the line is then an understatement.
         */
        private boolean complete = true;

        Lot(String isin, String product, String priceCurrency, String currency,
            OffsetDateTime openedAt, String baseCurrency) {
            this.isin = isin;
            this.product = product;
            this.priceCurrency = priceCurrency;
            this.currency = currency;
            this.openedAt = openedAt;
            this.baseCurrency = baseCurrency;
        }

        /** @param paidBase what the fill took out of the base currency, null when unknowable */
        void buy(long units, BigDecimal price, BigDecimal paid, BigDecimal paidBase) {
            if (quantity == 0) {
                openedAt = openedAt == null ? null : openedAt;
            }
            if (price != null) {
                gross = gross.add(price.multiply(BigDecimal.valueOf(units)));
            }
            cost = cost.add(paid);
            invested = invested.add(paid);
            costBase = paidBase == null || costBase == null ? null : costBase.add(paidBase);
            quantity += units;
        }

        /**
         * Sells at whatever came in. The average is not touched: selling realises a profit, it
         * does not change what the remaining shares cost.
         */
        void sell(long units, BigDecimal received) {
            if (units > quantity) {
                // The history does not reach back far enough. The units that cannot be explained
                // are sold against a cost of zero, which overstates the profit — so the line is
                // marked and the screen refuses to present it as finished.
                complete = false;
                realized = realized.add(received);
                proceeds = proceeds.add(received);
                gross = BigDecimal.ZERO;
                cost = BigDecimal.ZERO;
                costBase = BigDecimal.ZERO;
                quantity = 0;
                return;
            }
            BigDecimal share = BigDecimal.valueOf(units)
                    .divide(BigDecimal.valueOf(quantity), WORKING_SCALE, RoundingMode.HALF_UP);
            BigDecimal costOut = cost.multiply(share);
            realized = realized.add(received.subtract(costOut));
            proceeds = proceeds.add(received);
            cost = cost.subtract(costOut);
            costBase = costBase == null ? null : costBase.subtract(costBase.multiply(share));
            gross = gross.subtract(gross.multiply(share));
            quantity -= units;
        }

        /**
         * Takes over the cost of {@code units} shares from the instrument this one replaced. The
         * price printed on the swap is deliberately ignored: it is what the shares were worth the
         * day the paperwork moved, not what they were bought for, and letting it in is exactly how
         * a position that cost 29,99 $ starts claiming it cost 25,42 $.
         */
        void absorb(Lot previous, long unitsOut, long unitsIn) {
            if (unitsOut > previous.quantity) {
                complete = false;
                unitsOut = Math.max(previous.quantity, 0);
            }
            if (previous.quantity > 0) {
                BigDecimal share = BigDecimal.valueOf(unitsOut)
                        .divide(BigDecimal.valueOf(previous.quantity), WORKING_SCALE, RoundingMode.HALF_UP);
                BigDecimal costIn = previous.cost.multiply(share);
                cost = cost.add(costIn);
                // The euros followed the shares, whatever the instrument was called when they left.
                BigDecimal baseIn = previous.costBase == null ? null
                        : previous.costBase.multiply(share);
                costBase = baseIn == null || costBase == null ? null : costBase.add(baseIn);
                previous.costBase = baseIn == null ? null : previous.costBase.subtract(baseIn);
                // The money followed the shares: it was spent on this position, whatever the
                // instrument was called when it was spent.
                invested = invested.add(costIn);
                previous.invested = previous.invested.subtract(costIn);
                previous.cost = previous.cost.subtract(costIn);
                previous.gross = previous.gross.subtract(previous.gross.multiply(share));
            }
            complete = complete && previous.complete;
            quantity += unitsIn;
            previous.quantity -= unitsOut;
            // Restated from the cost the shares brought with them rather than carried over: the
            // two instruments need not have the same number of shares for the same money.
            reprice();
            if (openedAt == null || (previous.openedAt != null && previous.openedAt.isBefore(openedAt))) {
                openedAt = previous.openedAt;   // the position was replaced, not reopened
            }
        }

        /**
         * A split or a reverse split: same instrument, same money, a different number of shares.
         * The cost is untouched — twenty shares becoming one did not make the position cheaper —
         * so only the count moves, and the average with it.
         */
        void split(long unitsOut, long unitsIn) {
            if (unitsOut > quantity) {
                complete = false;
            }
            quantity = quantity - Math.min(unitsOut, quantity) + unitsIn;
            reprice();
        }

        /**
         * Cash that belongs to this position without any shares moving: what a delisted holding
         * was finally worth, or the settlement for a fraction a swap could not deliver. It is a
         * realised result, not income of the account.
         */
        void settle(BigDecimal received) {
            realized = realized.add(received);
            proceeds = proceeds.add(received);
        }

        /** Restates the per-share average from the cost the lot actually carries. */
        private void reprice() {
            gross = quantity > 0 ? cost : BigDecimal.ZERO;
        }

        HoldingResponse toResponse(String name) {
            BigDecimal average = quantity > 0
                    ? gross.divide(BigDecimal.valueOf(quantity), PRICE_SCALE, RoundingMode.HALF_UP)
                    : null;
            // Against what went in, not against what came out: a position that cost 100 and
            // returned 150 made 50%, and dividing by the 150 would call it 33%.
            BigDecimal percent = invested.signum() > 0
                    ? realized.multiply(BigDecimal.valueOf(100))
                            .divide(invested, 2, RoundingMode.HALF_UP)
                    : null;
            return new HoldingResponse(isin, name, null, quantity, average, priceCurrency,
                    cost.setScale(MONEY_SCALE, RoundingMode.HALF_UP),
                    invested.setScale(MONEY_SCALE, RoundingMode.HALF_UP),
                    proceeds.setScale(MONEY_SCALE, RoundingMode.HALF_UP),
                    realized.setScale(MONEY_SCALE, RoundingMode.HALF_UP),
                    percent,
                    currency, openedAt, complete,
                    baseCurrency,
                    costBase == null ? null : costBase.setScale(MONEY_SCALE, RoundingMode.HALF_UP),
                    // Unpriced on purpose: this walk knows the statement and nothing else. What
                    // the position is worth today is added afterwards, by whoever can quote it.
                    null, null, null, null);
        }
    }
}
