---
"@supabase/pg-delta": minor
---

`schema export` now pretty-prints its SQL by default (lowercase keywords, max width 100, aligned columns) — the export is a human-facing artifact, so it reads like hand-written SQL out of the box. `--format-options` still overrides any knob (e.g. `'{"keywordCase":"upper"}'`), and the new `--no-format` flag restores the raw renderer output. Formatting remains purely cosmetic: the round-trip fidelity gate (`load(export(db)) ≡ db`) covers the formatter.
