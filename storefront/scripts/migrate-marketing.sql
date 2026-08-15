-- Marketing schema — run once via Railway Postgres shell
-- Connect: railway connect postgres (or via Railway dashboard → Data → Query)

CREATE SCHEMA IF NOT EXISTS marketing;

CREATE TABLE IF NOT EXISTS marketing.subscribers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,
    name            TEXT,
    locale          TEXT NOT NULL DEFAULT 'it',
    source          TEXT NOT NULL DEFAULT 'purchase',
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'unsubscribed', 'bounced', 'inactive')),
    purchase_count  INTEGER NOT NULL DEFAULT 0,
    total_spent     NUMERIC(10,2) NOT NULL DEFAULT 0,
    last_purchase_at TIMESTAMPTZ,
    categories      TEXT[] NOT NULL DEFAULT '{}',
    unsubscribed_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscribers_status ON marketing.subscribers(status);
CREATE INDEX IF NOT EXISTS idx_subscribers_last_purchase ON marketing.subscribers(last_purchase_at);
CREATE INDEX IF NOT EXISTS idx_subscribers_email ON marketing.subscribers(email);

CREATE TABLE IF NOT EXISTS marketing.cart_sessions (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                TEXT,
    cart_data            JSONB NOT NULL,
    checkout_started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    email_sent_at        TIMESTAMPTZ,
    recovered_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cart_sessions_email ON marketing.cart_sessions(email);
CREATE INDEX IF NOT EXISTS idx_cart_sessions_pending ON marketing.cart_sessions(checkout_started_at)
    WHERE email_sent_at IS NULL AND recovered_at IS NULL;

CREATE TABLE IF NOT EXISTS marketing.email_log (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriber_id  UUID REFERENCES marketing.subscribers(id),
    email          TEXT NOT NULL,
    type           TEXT NOT NULL
                   CHECK (type IN ('welcome', 'abandoned_cart', 'review_request', 'reengagement', 'magic_link', 'push_offer', 'pwa_invite')),
    resend_id      TEXT,
    sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CREATE TABLE IF NOT EXISTS does not update an existing constraint. Keep this
-- migration idempotent so installations created before pwa_invite are fixed.
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

CREATE INDEX IF NOT EXISTS idx_email_log_subscriber ON marketing.email_log(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_email_log_type ON marketing.email_log(type);
CREATE INDEX IF NOT EXISTS idx_email_log_sent_at ON marketing.email_log(sent_at);

-- Add delivered_at and review_email_sent_at to Payload CMS orders table
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS review_email_sent_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_review_email ON public.orders(delivered_at)
    WHERE review_email_sent_at IS NULL;
