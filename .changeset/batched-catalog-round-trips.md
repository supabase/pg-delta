---
"@supabase/pg-delta": patch
---

perf: batch the cheap catalog families into a few multi-statement round trips —
a full extraction now costs 23 round trips instead of 38.

Extraction issued one round trip per catalog family, and most of those families
(roles, schemas, tables, sequences, views, domains, types, collations, event
triggers, rules, publications, inheritance edges) are cheap enough that their
entire cost is network latency. Their statements now travel as three
multi-statement batches, while the measured server/transfer-heavy families
(columns, constraints, indexes, routines, aggregates, triggers, policies) and the
pg_depend resolver keep a round trip each — both so the parallel scheduler can
spread the expensive work and so a `statement_timeout` still names the exact query
that blew the budget. On a remote database at ~85ms RTT that is roughly 1.3s per
serial extraction, and a diff extracts twice; at concurrency 5 the longest stream
drops from 12 round trips to 8.

Extraction output is unchanged, and provably so: no query text changed (only where
it is sent), every family still gets its own collector, and the collectors are
merged in the same fixed family order as before — so facts, edges, diagnostics
order and the fact-base fingerprint are byte-identical for both the serial and the
bounded-parallel path. `statement_timeout` remains per-statement inside a
multi-statement batch, so the budget is not weakened. The serial path is now
literally the one-stream case of the parallel plan rather than a second
implementation.

Three families are deliberately left unbatched — foreign-data objects,
subscriptions and security labels each branch on the result of their own
permission/existence probe, so their statement list is not knowable up front.
