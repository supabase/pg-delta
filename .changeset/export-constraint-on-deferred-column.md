---
"@supabase/pg-delta": patch
---

Fix `schema export` folding a table constraint inline into `CREATE TABLE` when the column it references was deferred to a later `ALTER TABLE … ADD COLUMN` (a domain-typed column whose fold crosses the domain-create edge, or a generated column that never hints). The constraint fold pass bypassed the crossing guard for all constraints (to keep validated FKs to later-created tables foldable), which produced `CREATE TABLE … CONSTRAINT … UNIQUE (slug)` where `slug` was not yet a column, so the export failed to reload with `column "slug" named in key does not exist`. The guard now vetoes a constraint fold only when a same-table column of the fold target is deferred, while still tolerating crossings to other relations (an FK's referenced table, backing indexes/types elsewhere). Such constraints now render as standalone `ALTER TABLE … ADD CONSTRAINT`.
