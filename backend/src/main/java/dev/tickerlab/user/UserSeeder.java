package dev.tickerlab.user;

import dev.tickerlab.watchlist.WatchlistRepository;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Accounts are created by hand and live in the environment, not in a sign-up screen: for two
 * people a registration flow is more code than the feature it serves. Every boot re-applies the
 * configured passwords, so a forgotten one is changed by restarting with a new value.
 */
@Component
public class UserSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(UserSeeder.class);

    private final AppUserRepository users;
    private final WatchlistRepository watchlists;
    private final PasswordEncoder passwordEncoder;
    private final AuthProperties properties;

    UserSeeder(
            AppUserRepository users,
            WatchlistRepository watchlists,
            PasswordEncoder passwordEncoder,
            AuthProperties properties) {
        this.users = users;
        this.watchlists = watchlists;
        this.passwordEncoder = passwordEncoder;
        this.properties = properties;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        AppUser first = null;
        for (AuthProperties.SeedUser seed : properties.users()) {
            AppUser user = upsert(seed);
            if (first == null) {
                first = user;
            }
        }
        if (first != null) {
            adoptOrphanWatchlists(first);
        }
    }

    private AppUser upsert(AuthProperties.SeedUser seed) {
        AppUser user = users.findByUsernameIgnoreCase(seed.username()).orElse(null);
        if (user == null) {
            user = new AppUser();
            user.setId(UUID.randomUUID());
            user.setUsername(seed.username());
            user.setPasswordHash(passwordEncoder.encode(seed.password()));
            users.save(user);
            log.info("Seeded user {}", seed.username());
            return user;
        }
        // BCrypt is salted, so the stored hash cannot be compared: it has to be matched.
        if (!passwordEncoder.matches(seed.password(), user.getPasswordHash())) {
            user.setPasswordHash(passwordEncoder.encode(seed.password()));
            log.info("Updated the password of {}", seed.username());
        }
        return user;
    }

    /**
     * The lists that predate V10 have no owner and no way to grow one: the column was added
     * before any account existed. They go to the first configured user, once.
     */
    private void adoptOrphanWatchlists(AppUser owner) {
        int adopted = watchlists.adoptOrphans(owner);
        if (adopted > 0) {
            log.info("Adopted {} owner-less watchlists into {}", adopted, owner.getUsername());
        }
    }
}
