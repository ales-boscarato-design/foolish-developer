CREATE TABLE IF NOT EXISTS marketing.reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        INTEGER NOT NULL REFERENCES public.orders(id),
  product_id      INTEGER NOT NULL,
  product_slug    TEXT NOT NULL,
  subscriber_id   UUID REFERENCES marketing.subscribers(id),
  rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body            TEXT,
  photo_urls      TEXT[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'published', 'removed')),
  reviewer_name   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reviews_product_published
  ON marketing.reviews(product_slug, status);
CREATE INDEX IF NOT EXISTS idx_reviews_status
  ON marketing.reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_order
  ON marketing.reviews(order_id);
