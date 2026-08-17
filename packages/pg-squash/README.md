# @supabase/pg-squash

Compress an ordered chain of PostgreSQL migration files into the minimum
number of transactions, with a machine-checked proof that the squashed output
is equivalent to the original chain.

> **Status:** v1 library + `pgsquash` CLI. Repair loop, volatility mask, and
> a PG 17 corpus are included. See
> [`docs/roadmap/pg-squash-design.md`](../../docs/roadmap/pg-squash-design.md).

## Install

```bash
npm install @supabase/pg-squash
```

Requires Node.js >= 20. Also runs on Bun and Deno.

## Library

```ts
import { readChain, squash } from "@supabase/pg-squash";

const chain = await readChain("./supabase/migrations");
const result = await squash(chain, {
  cluster, // injected ClusterHandle (CREATEDB-capable admin pool)
  baselineDatabase: "template0",
});
// result.files, result.manifest, result.proof, result.diagnostics
```

The library never boots Docker. Pass a `ClusterHandle` from `openClusterHandle`.

## CLI

```bash
pgsquash squash ./supabase/migrations --out ./squashed
pgsquash squash ./supabase/migrations --out ./squashed --cluster postgres://user:pass@host:5432/postgres
```

Without `--cluster`, the CLI starts a throwaway Postgres container (Docker +
testcontainers). Output is one `NNNN_squashed.sql` file per transaction,
plus `manifest.json`, `proof.json`, and `README.md`.

## Design

pg-delta must not depend on a SQL parser. pg-topo must not depend on a
database. pg-squash sits above both: it splits statements with pg-topo, replays
them on a shadow cluster, and proves equivalence with pg-delta's `extract()`
and `collectTableStats()`.
