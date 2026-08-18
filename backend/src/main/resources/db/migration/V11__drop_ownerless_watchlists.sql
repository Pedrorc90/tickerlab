-- V1 seeds a "Favoritos" list so a fresh database is never empty, and it predates the idea of
-- an owner by ten migrations. On an existing database UserSeeder adopts it; on a new one there
-- is no account to adopt it into and nobody ever sees it, because every query filters by owner.
-- V1 cannot be edited — Flyway validates its checksum — so the row is removed here instead.
DELETE FROM watchlist WHERE owner_id IS NULL;
