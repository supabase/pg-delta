---
"@supabase/pg-delta": patch
---

Fix the guardrail-3 plan failure (`rule table: kind 'extension' has no rule for attribute 'relocatable'`) when the two sides of a diff hold the same extension at versions whose control files disagree on `relocatable` (e.g. `wrappers`, which flipped relocatability across its release history). `relocatable` is a control-file property of the installed extension version — not settable by any DDL — so it now rides on the extension fact as non-hashed metadata (`_relocatable`), excluded from the diff/hash surface for the same reason `version` is, while staying readable at plan time for the schema rule's replace-vs-alter decision. Note: extension fact content hashes change with this release, so snapshots captured with earlier versions should be re-captured before being diffed against fresh extracts.
