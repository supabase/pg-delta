---
"@supabase/pg-delta": minor
---

Capture and replay pgmq queues as extension intent (CLI-2054).

A pgmq queue is not schema DDL — `pgmq.create('jobs')` registers a row in
pgmq's own `pgmq.meta` registry and creates two operational tables. The new
`pgmqHandler` captures each queue from `pgmq.meta` as an `extensionIntent` fact
keyed by `queue_name` (its unique registry key, so a queue is never unkeyable)
and replays it through pgmq's own API: `select pgmq.create(…)` /
`select pgmq.create_unlogged(…)`, and `select pgmq.drop_queue(…)` marked
`destructive` because dropping a queue destroys its messages. The handler also
tags each queue's `pgmq.q_*` / `pgmq.a_*` tables `managedBy` the extension, so
any profile composing it — the `supabase` profile, or a custom profile
referencing `"pgmq"` — never plans `DROP TABLE` against them. The default `raw`
profile composes no handlers and does not get this protection.

This closes the loop that was previously unprovable: a database containing a
queue now round-trips through `schema export` → load into a fresh shadow →
re-extract with an empty diff, because pgmq — unlike pg_cron — has no
single-database constraint and needs no `shadowPrecheck`.

The handler is composed into the `supabase` profile and is referenceable as
`"pgmq"` from a custom `--profile <file>`. It takes no configuration: unlike
pg_cron, `pgmq.meta` records no owner or role, so there is nothing to normalize
and no superuser-only argument to elide.

Partitioned queues are deliberately left unmanaged: `pgmq.meta` records only the
`is_partitioned` flag, while `create_partitioned`'s partition and retention
intervals live in pg_partman's `part_config`, so a faithful replay is not
derivable from pgmq's catalog. Such a queue emits a new `intent-unsupported`
warning instead of a fact that could never converge — its operational tables are
still tagged, so nothing plans to drop them.

That warning is non-blocking on its own: a diff whose desired state merely
contains a partitioned queue — including the steady state where both sides have
the same one — still plans, and the queue is simply left alone. `plan()`
escalates to an error only on a same-key COLLISION, where the opposite side
manages a regular queue of the same name and acting on the diff would be wrong
either way: a partitioned queue declared over a source's regular one would
otherwise plan a bare destructive `pgmq.drop_queue(...)` whose proof falsely
converges, and the reverse (regular declared over a source's partitioned one)
would emit a `pgmq.create(...)` that no-ops against the live registration and
fail the proof much later. Both directions are now refused up front, naming the
queue and the side that holds the unreplayable form.
