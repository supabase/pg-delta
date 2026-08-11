---
"@supabase/pg-delta": patch
---

perf: batch the extraction session preamble into 2 round trips instead of 4-5.

Every extraction — not just the opt-in parallel one — used to spend a separate
round trip on each of `BEGIN`, `SET LOCAL search_path`, the optional
`SET LOCAL statement_timeout`, the server-version probe, and the JIT-disable
before touching a single catalog. These now travel as one multi-statement batch
(plus a second round trip for JIT-off, whose form depends on the major version
that same batch discovers), so the fixed cost before extraction starts drops from
4-5 RTT to 2. On a remote database at ~85ms RTT that is roughly a quarter of a
second per extraction, and a diff extracts twice.

Session state after setup is unchanged and asserted to be identical
(`search_path`, `statement_timeout`, `jit`, isolation level, read-only).
