---
"@supabase/pg-delta-next": patch
---

fix(pg-delta-next): treat an unstamped snapshot as redacted in the prove redaction guard

The `prove` redaction-mode guard only compared when the snapshot carried the
`redactSecrets` field, so a snapshot written before that metadata existed
(deserializing with `redactSecrets: undefined`) skipped the check. Paired with an
`--unsafe-show-secrets` plan, `prove` would proceed, mutate the clone, and then
fail the proof spuriously on placeholder-vs-real secrets. The snapshot mode now
coalesces to the default `true` (redacted) before comparing, so the mismatch is
rejected up front.
