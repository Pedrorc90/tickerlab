-- V14 declared the fingerprint as CHAR(64) because it is always exactly 64 hex characters, and
-- that was the wrong kind of tidy: Postgres stores CHAR as bpchar, Hibernate maps a String with a
-- length to varchar, and `ddl-auto: validate` refuses to start on the difference.
--
-- varchar is also the right type on its own merits. bpchar pads every value it is compared
-- against to the declared width, so a lookup against a trimmed key can silently miss — on a column
-- whose entire job is deciding whether a movement has been imported before.
ALTER TABLE broker_transaction ALTER COLUMN fingerprint TYPE VARCHAR(64);
