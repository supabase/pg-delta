---
"@supabase/pg-delta-next": patch
---

Two `schema apply` robustness fixes:

- **Optional `@supabase/pg-topo` peer absent.** The reorder assist is on by default, but its peer is optional. When it isn't installed, `analyzeForShadow` threw `ReorderUnavailableError` and failed the whole apply; `schema apply` now catches it and falls back to raw, file-granular loading (with a warning), so existing declarative-apply workflows keep working without `--no-reorder`.
- **`--unsafe-show-secrets` fingerprint gate.** The fingerprint gate re-extracts the target and compares it to the plan source, but the re-extract still redacted secrets even when the plan source was extracted unredacted. Against a target that already held unredacted FDW/server/user-mapping credentials or subscription conninfo, the gate then aborted the apply unless `--force` was used. The apply re-extract now honors the same `redactSecrets` setting as the plan source.
