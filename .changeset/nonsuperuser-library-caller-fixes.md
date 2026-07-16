---
"@supabase/pg-delta": patch
---

Fix five non-superuser / library-caller correctness gaps (issue #333, items 13-17):

- Role security-label extraction joined `pg_authid` (superuser-only); it now joins `pg_roles`, so a non-superuser caller no longer hits `permission denied for table pg_authid` when a role security label exists.
- Subscription extraction selected `pg_subscription.subconninfo` unconditionally; that column is revoked from non-superusers by default (unlike every other column on the table), so the whole query failed for such a caller. The column is now probed with `has_column_privilege` and conditionally included in the query text (a runtime `CASE WHEN` guard does not work — Postgres's column permission check is static and fires on any reference to the column, not on which branch runs); when unreadable, the fact falls back to the existing `SUBSCRIPTION_CONNINFO_PLACEHOLDER`.
- A user mapping whose foreign server was added to an extension (`ALTER EXTENSION … ADD SERVER …`) orphaned `buildFactBase` with a missing-parent error, because the user-mapping query lacked the extension-member anti-join the server query already has. It is now excluded consistently with its server.
- `apply()`'s and `provePlan()`'s fingerprint/proof re-extraction ignored `Plan.redactSecrets`, always re-extracting the target with the default (redacted) mode. A plan built from `extract({ redactSecrets: false })` was therefore spuriously rejected (or reported as drifted) even with zero actual delta. Both now honor the plan's stamped redaction mode when no custom `reextract` is supplied.
- `ALTER DEFAULT PRIVILEGES ... ON LARGE OBJECTS` (PG18+) was rendered as `ON TABLES` (the `DEFACL_OBJTYPE` map had no `L` entry and silently fell back); an unmapped `defaclobjtype` now also fails loudly instead of guessing.
