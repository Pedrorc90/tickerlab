-- Two people, added by hand: there is no sign-up screen and no password recovery.
CREATE TABLE app_user (
    id            UUID PRIMARY KEY,
    username      VARCHAR(60) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_app_user_username ON app_user (lower(username));

-- Nullable on purpose: the lists that predate this migration have no owner to point at yet,
-- and the seed user only exists once the application boots. UserSeeder adopts them there.
ALTER TABLE watchlist
    ADD COLUMN owner_id UUID REFERENCES app_user (id) ON DELETE CASCADE;

-- The name is unique per owner now, not across the whole table: two people are allowed to
-- both keep a list called "Watching".
DROP INDEX uq_watchlist_name;
CREATE UNIQUE INDEX uq_watchlist_owner_name ON watchlist (owner_id, lower(name));
