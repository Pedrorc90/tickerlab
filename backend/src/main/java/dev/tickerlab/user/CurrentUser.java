package dev.tickerlab.user;

import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/**
 * The signed-in user, read from the security context. Ownership is filtered in the service and
 * not in the repository, so this is what the service asks instead of taking an id parameter
 * every controller would have to fill in.
 */
@Component
public class CurrentUser {

    public UUID id() {
        return principal().id();
    }

    public String username() {
        return principal().username();
    }

    private AppUserPrincipal principal() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof AppUserPrincipal principal)) {
            throw new IllegalStateException("No authenticated user in the security context");
        }
        return principal;
    }
}
