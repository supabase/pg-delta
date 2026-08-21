---
"@supabase/pg-topo": patch
---

Recognize additional built-in PostgreSQL opclass catalog support objects, including date/time `in_range` overloads, cross-type btree support operators, xid/cid hash support, external enum/range/multirange subtype providers, and opclass datatype validation for support routines, while preserving dependencies on explicitly public types that shadow built-ins.
