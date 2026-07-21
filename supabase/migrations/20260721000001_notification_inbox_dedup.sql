-- Add dedup_key to notification_inbox for idempotent fan-out inserts.
-- NULL dedup_key rows are always inserted (Postgres UNIQUE treats NULLs as distinct).
-- Non-NULL dedup_key rows are deduplicated per user — same logical event never
-- inserts twice even if a webhook retries or a fan-out job runs more than once.

ALTER TABLE public.notification_inbox
ADD COLUMN IF NOT EXISTS dedup_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notification_inbox_user_dedup_key_unique'
      AND conrelid = 'public.notification_inbox'::regclass
  ) THEN
    ALTER TABLE public.notification_inbox
    ADD CONSTRAINT notification_inbox_user_dedup_key_unique
    UNIQUE (user_id, dedup_key);
  END IF;
END $$;
