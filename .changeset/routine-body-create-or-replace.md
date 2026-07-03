---
"@supabase/pg-delta-next": minor
---

Route function / procedure body changes through `CREATE OR REPLACE` instead of demolition.

A routine was previously modeled as one opaque `def`, so any change — including a one-line body edit — took the drop + recreate path: `DROP FUNCTION`, re-`CREATE`, re-establish owner, re-`GRANT`, default-ACL hygiene `REVOKE`s, and a forced rebuild of every dependent (event triggers included). A change that keeps the same stable id and the same return type, argument signature, language, and window-kind now alters in place with a single `CREATE OR REPLACE FUNCTION`, matching PostgreSQL / pg_dump semantics: dependents, owner, and grants are preserved.

Only changes `CREATE OR REPLACE` refuses or cannot express still demolish (drop + recreate with the forced dependent rebuild):

- **return type** — `cannot change return type of existing function`
- **argument signature** — a parameter rename or default removal (`cannot change name of input parameter` / `cannot remove parameter defaults`)
- **language** and **window-kind** — demolished for unconditional drop-and-recreate safety

Argument *types* remain identity (a different stable id → natural drop + create). Window functions (`prokind = 'w'`) are now extracted and modeled as functions. A `BEGIN ATOMIC` body that references a newly-created object orders its `CREATE OR REPLACE` after that object's create.

The plan shape for routine changes is user-visible (a common body edit becomes one statement instead of a demolition sequence), hence a minor bump.
