package dev.tickerlab.broker;

import java.util.UUID;

/**
 * The refusals this module has. Grouped in one file rather than one class per exception, unlike
 * {@code dev.tickerlab.portfolio}: there they are the vocabulary of an order being rejected and
 * get read on their own; here they are three ways an upload can be wrong.
 */
public final class BrokerExceptions {

    private BrokerExceptions() {
    }

    public static class AccountNotFoundException extends RuntimeException {
        public AccountNotFoundException(UUID id) {
            super("No account " + id);
        }
    }

    public static class DuplicateNameException extends RuntimeException {
        public DuplicateNameException(String name) {
            super("Ya tienes una cuenta llamada " + name);
        }
    }

    /**
     * The file is not the statement it was uploaded as. Carries the reason in the message because
     * the panel prints it verbatim: "no movements found" and "wrong broker" send the user to two
     * very different places.
     */
    public static class UnreadableStatementException extends RuntimeException {
        public UnreadableStatementException(String message) {
            super(message);
        }
    }
}
