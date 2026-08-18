package dev.tickerlab.user;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * One environment variable holds every account, as {@code name:password} pairs: on the host
 * this ships to, a list is one secret to set instead of one per person.
 */
@ConfigurationProperties(prefix = "tickerlab.auth")
public record AuthProperties(List<String> seedUsers) {

    public record SeedUser(String username, String password) {}

    public List<SeedUser> users() {
        return seedUsers == null ? List.of() : seedUsers.stream()
                .map(String::trim)
                .filter(entry -> !entry.isEmpty())
                .map(AuthProperties::parse)
                .toList();
    }

    /** Split on the first colon only: a password is allowed to contain one. */
    private static SeedUser parse(String entry) {
        int separator = entry.indexOf(':');
        if (separator <= 0 || separator == entry.length() - 1) {
            throw new IllegalStateException("tickerlab.auth.seed-users wants name:password, got " + entry);
        }
        return new SeedUser(entry.substring(0, separator), entry.substring(separator + 1));
    }
}
