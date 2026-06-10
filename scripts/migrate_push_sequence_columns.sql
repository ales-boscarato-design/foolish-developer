-- Run once on Railway PostgreSQL to add push sequence tracking columns.
-- Safe to re-run (IF NOT EXISTS / DO $$ BEGIN ... EXCEPTION pattern).

ALTER TABLE marketing.subscribers
  ADD COLUMN IF NOT EXISTS push_subscribed_at timestamptz,
  ADD COLUMN IF NOT EXISTS push_sequence_state jsonb DEFAULT '{}';
