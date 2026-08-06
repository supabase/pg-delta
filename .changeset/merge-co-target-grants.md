---
"@supabase/pg-delta": minor
---

Compaction now merges consecutive same-privilege co-create GRANTs into one grantee-list statement (`GRANT … ON TABLE t TO a, b, c`), matching idiomatic hand-written SQL. Cosmetic by contract: the corpus proves compacted and uncompacted plans converge identically; groups with a surviving REVOKE leader, grant options, column qualifiers, or differing privilege sets are left untouched.
