---
"@supabase/pg-delta": patch
---

fix(pg-delta): allow catalog extraction as a non-superuser role

Extraction previously SELECTed from `pg_catalog.pg_user_mapping` (superuser-only), so any non-superuser connection — e.g. the `postgres` role on Supabase hosted projects — failed with `permission denied for table pg_user_mapping` (42501). User mappings are now read from the world-readable `pg_user_mappings` view; option values hidden from unprivileged readers degrade to an empty option list instead of erroring. The subscription extractor similarly stops selecting the superuser-only `pg_subscription.subconninfo` column unless the reader has privilege, degrading to the existing redacted-conninfo placeholder. Fixes supabase/cli#5826.
