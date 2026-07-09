---
"@supabase/pg-delta": minor
---

`schema export` now pretty-prints its SQL by default (lowercase keywords, max width 180, aligned columns) — the export is a human-facing artifact, so it reads like hand-written SQL out of the box. `--format-options` still overrides any knob (e.g. `'{"keywordCase":"upper"}'`), and the new `--no-format` flag restores the raw renderer output. Formatting remains purely cosmetic: the round-trip fidelity gate (`load(export(db)) ≡ db`) covers the formatter. The keyword-casing vocabulary also learned `MAINTAIN`, `TRUNCATE`, `DESC`/`ASC`, `NULLS FIRST/LAST`, `INCLUDE`, and `CONCURRENTLY`, and a quoted object name (`ALTER TABLE "s"."t" ENABLE …`, `CREATE POLICY "p" ON …`) no longer shields the following keyword from casing.
