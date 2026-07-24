---
"@supabase/pg-delta": minor
---

Surface the plan's attributed projection audit through every verdict produced by `provePlan` and through the `prove` CLI. Proof output includes complete summary counts and a deterministic, suspicious-first human view capped at 50 entries while preserving baseline and non-baseline acknowledged samples; `--audit-all` prints every entry, and the complete machine audit remains in the `--plan` artifact's `projectionAudit`. The opt-in `--strict-audit` flag evaluates the full audit, fails on suspicious entries, and fails closed when a legacy plan has no audit; every produced verdict exposes whether its audit was available, and artifact summaries are validated and normalized from their entries.
