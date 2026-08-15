package dev.tickerlab.config;

import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Duration;
import org.springframework.cache.CacheManager;
import org.springframework.cache.caffeine.CaffeineCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * In-memory caching only: this version stores nothing on disk, so a restart simply
 * refetches. The two caches expire on different clocks because the data does.
 */
@Configuration
public class CacheConfig {

    /** Today's bar keeps moving while the market is open, so candles go stale fast. */
    private static final Duration CANDLES_TTL = Duration.ofMinutes(15);

    /** A company's name and sector barely change. */
    private static final Duration SEARCH_TTL = Duration.ofHours(24);

    @Bean
    CacheManager cacheManager() {
        CaffeineCacheManager manager = new CaffeineCacheManager();
        manager.setCacheNames(java.util.List.of());
        manager.registerCustomCache("candles",
                Caffeine.newBuilder().expireAfterWrite(CANDLES_TTL).maximumSize(500).build());
        manager.registerCustomCache("symbolSearch",
                Caffeine.newBuilder().expireAfterWrite(SEARCH_TTL).maximumSize(1_000).build());
        return manager;
    }
}
