---
"@supabase/pg-delta-next": patch
---

Two `ALTER DEFAULT PRIVILEGES` (ADP) correctness fixes:

- **Reorder barrier.** `schema apply`'s default statement-reorder assist could move an `ALTER DEFAULT PRIVILEGES` past the `CREATE` statements it scopes (pg-topo classifies it in the `privileges` phase), so the shadow missed the implicit grants PostgreSQL applies in authored order. A directory containing `ALTER DEFAULT PRIVILEGES` now falls back to raw, file-granular loading.
- **Default-ACL elision is ADP-aware.** The compaction that drops a co-created object's redundant `REVOKE`/`GRANT` group compared the desired ACL to the *built-in* default. When an ADP changed the effective create-time default — e.g. revoked the built-in PUBLIC `EXECUTE` on new functions — the group was load-bearing but got elided, leaving the object without the desired grant. Elision now compares against the *effective* default (built-in unless an ADP changed it, keyed by the applier's creating role), for both the PUBLIC and owner branches.
