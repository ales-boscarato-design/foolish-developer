-- Nuove colonne su marketing.subscribers
ALTER TABLE marketing.subscribers
  ADD COLUMN IF NOT EXISTS level TEXT
    CHECK (level IN ('tatuatore','pmu','studente','professionista')),
  ADD COLUMN IF NOT EXISTS styles TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS magic_link_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS push_subscription JSONB,
  ADD COLUMN IF NOT EXISTS notify_orders BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_new_batches BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_offers BOOLEAN DEFAULT false;

-- Aggiungi magic_link al tipo email_log
-- (il CHECK constraint su type non esiste nella migration corrente — solo nel codice TS)

-- Schema e tabella wishlist
CREATE SCHEMA IF NOT EXISTS account;

CREATE TABLE IF NOT EXISTS account.wishlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_email TEXT NOT NULL,
  product_slug TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_price NUMERIC(10,2),
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at TIMESTAMPTZ,
  CONSTRAINT fk_wishlist_subscriber
    FOREIGN KEY (subscriber_email)
    REFERENCES marketing.subscribers(email)
    ON DELETE CASCADE,
  CONSTRAINT uq_wishlist_item
    UNIQUE (subscriber_email, product_slug)
);

CREATE INDEX IF NOT EXISTS idx_wishlist_email ON account.wishlist(subscriber_email);
