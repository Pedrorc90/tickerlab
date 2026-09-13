package dev.tickerlab.broker;

/**
 * Which broker a statement came from. Stored on the account and not guessed per upload: the same
 * CSV shape can be exported by more than one product, and a wrong guess would silently file
 * somebody's fills under the wrong parser.
 */
public enum Broker {

    /** flatexDEGIRO. Fills in the local currency of the venue, settled in the account currency. */
    DEGIRO,

    /** Interactive Brokers, imported from a Flex Query export. */
    IBKR
}
