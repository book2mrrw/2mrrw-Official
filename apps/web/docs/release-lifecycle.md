# Release lifecycle authority

`releases.id` is the canonical identity from draft through live publication. A
`products` row is only its commerce/storefront projection and references it via
`products.release_id`.

## Time contract

The admin enters a wall-clock date/time and an IANA timezone. The browser
converts that instant to UTC before publication. The API validates the timezone
and ordering, and PostgreSQL stores the normalized `timestamptz`. The original
IANA zone remains in `release_timezone` for accurate display across CST/CDT and
other daylight-saving transitions. Availability is always evaluated against
server/database time; browser time never authorizes access.

## Authority contract

`releaseAvailability()` is the shared lifecycle decision. Catalog visibility,
checkout, progressive streams, HLS manifests, prerelease previews, and signed
purchase access links all consume it. A due timestamp makes a scheduled release
live even if the housekeeping cron has not materialized `status = published`.

`products.active` means listed as a catalog projection; it does not grant audio
access. Ownership also remains distinct from current playback permission.

Initial early access supports the complete release for durable preorder
purchasers. `early_access_scope` and `early_access_audiences` are structured for
selected-track and additional-tier support without changing release identity or
creating a second entitlement system.
