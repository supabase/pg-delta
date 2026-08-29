---
"@supabase/pg-delta": minor
---

Keep customer GRANTs on managed-schema objects managed in the supabase profile (CLI-1385 Phase 5, Unit B). An ACL entry on a managed-schema object (or the managed schema itself) whose grantee is a customer-created role — outside the system roles, `postgres`, PUBLIC, and `pg_*` — is customer intent by construction, since the platform can only grant to roles it knows. Previously Rule 10 dropped all such ACL satellites, so a `GRANT SELECT ON auth.users TO app_reader` was silently lost on diffs, exports, and DB forks. Grants TO the API roles or `postgres` on managed objects stay platform-managed (they collide with platform-seeded entries at the (target, grantee) grain; recorded follow-up). Replay runs as the non-superuser `postgres`, whose grant/revoke rights on auth tables come from the platform's 2024 `enable_rls_update_grants` migration.
