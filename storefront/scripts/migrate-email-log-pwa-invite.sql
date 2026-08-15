-- One-time, idempotent production fix for the pwa-invite cron.
-- Run against the Railway Postgres database.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'marketing'
          AND t.relname = 'email_log'
          AND c.conname = 'email_log_type_check'
          AND c.contype = 'c'
    ) AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'marketing'
          AND t.relname = 'email_log'
          AND c.conname = 'email_log_type_check'
          AND pg_get_constraintdef(c.oid) ILIKE '%pwa_invite%'
    ) THEN
        ALTER TABLE marketing.email_log DROP CONSTRAINT email_log_type_check;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'marketing'
          AND t.relname = 'email_log'
          AND c.conname = 'email_log_type_check'
    ) THEN
        ALTER TABLE marketing.email_log
            ADD CONSTRAINT email_log_type_check
            CHECK (type IN ('welcome', 'abandoned_cart', 'review_request', 'reengagement', 'magic_link', 'push_offer', 'pwa_invite'));
    END IF;
END $$;

-- Verify the effective constraint after the migration.
SELECT pg_get_constraintdef(c.oid) AS constraint_definition
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'marketing'
  AND t.relname = 'email_log'
  AND c.conname = 'email_log_type_check';
