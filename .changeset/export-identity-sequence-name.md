---
"@supabase/pg-delta": patch
---

`schema export` now emits `SEQUENCE NAME` for identity columns whose implicit
backing sequence name differs from the `<table>_<column>_seq` default (renamed
sequences, or ones created via `SEQUENCE NAME`). Previously the export rendered
a bare `GENERATED … AS IDENTITY`, so reload let PostgreSQL re-derive the default
name and the next diff produced a spurious `ALTER SEQUENCE … RENAME`. Renamed
identity sequences now round-trip cleanly; default-named identity columns stay
bare so ordinary exports remain minimal.
