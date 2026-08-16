-- Structured notes and ETNs carry their whole description as the security name, and the
-- longest ones run past 200 characters. 500 covers the published files with room to spare.
ALTER TABLE symbol ALTER COLUMN name TYPE VARCHAR(500);
