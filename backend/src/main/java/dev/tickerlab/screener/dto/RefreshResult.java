package dev.tickerlab.screener.dto;

import java.time.OffsetDateTime;

/** What a universe refresh did, so the UI can report it without a second call. */
public record RefreshResult(int added, int updated, int removed, long total, OffsetDateTime refreshedAt) {
}
