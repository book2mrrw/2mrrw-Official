-- Allow phone-only gifts: make recipient_email nullable and enforce
-- that at least one contact method (email or phone) is always present.

ALTER TABLE gifts ALTER COLUMN recipient_email DROP NOT NULL;

ALTER TABLE gifts
  ADD CONSTRAINT gifts_recipient_contact_required
  CHECK (recipient_email IS NOT NULL OR recipient_phone IS NOT NULL);
