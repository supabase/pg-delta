# @supabase/pg-squash

Compress an ordered chain of PostgreSQL migration files into the minimum
number of transactions, with a machine-checked proof that the squashed output
is equivalent to the original chain.

> **Status:** frontend pipeline and shadow/replay substrate are in place; the
> public `squash()` orchestrator lands in Wave 4. See
> [`docs/roadmap/pg-squash-design.md`](../../docs/roadmap/pg-squash-design.md).

## Install

```bash
npm install @supabase/pg-squash
```

Requires Node.js >= 20. Also runs on Bun and Deno.

## Design

pg-delta must not depend on a SQL parser. pg-topo must not depend on a
database. pg-squash sits above both: it splits statements with pg-topo, replays
them on a shadow cluster, and proves equivalence with pg-delta's `extract()`
and `collectTableStats()`.
