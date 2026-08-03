# pg-delta docs

`pg-delta` compares two PostgreSQL schemas and emits a migration to turn one
into the other — then **proves** that migration converges, with your data intact,
before you trust it. It's a clean-room rebuild of `pg-delta` on one idea: *let
PostgreSQL be the only thing that understands PostgreSQL.*

**Pick the path that fits you:**

## 🚀 I want to use it

- **[getting-started.md](getting-started.md)** — the CLI and the programmatic API,
  with copy-pasteable examples for the two workflows (diff two databases, or keep
  your schema as `.sql` files).
- **[../packages/pg-delta/COVERAGE.md](../packages/pg-delta/COVERAGE.md)**
  — exactly what the engine models and what it deliberately excludes.

## 🧭 I want to understand it

- **[overview.md](overview.md)** — *why* the engine was rebuilt: the old engine's
  problems, the two principles, old-vs-new with verified numbers.
- **[architecture/README.md](architecture/README.md)** — *how* it works,
  concept-first, for a newcomer. Links out to the deep designs below.

## 🔧 I want to work on it

- **[architecture/onboarding.md](architecture/onboarding.md)** — the contributor
  map: where each pipeline stage lives, and how to add a new object kind.
- **[architecture/target-architecture.md](architecture/target-architecture.md)** —
  the north star: the full design, principles, and guardrails.
- **[architecture/managed-view-architecture.md](architecture/managed-view-architecture.md)**
  — how scope, ownership, and applier capability enter the engine.
- **[architecture/extension-intent.md](architecture/extension-intent.md)** — how
  stateful extensions (pgmq, pg_cron, pg_partman) are diffed without losing data.

## 📋 What's done and what's next

- **[build-log.md](build-log.md)** — a light record of how the engine was built,
  hardened, and reviewed (the decision trail).
- **[roadmap/](roadmap/)** — the consolidated
  [backlog](roadmap/backlog.md) (validation gates, performance, DX, deferrals)
  and the live [follow-ups ledger](roadmap/pg-delta-next-follow-ups.md).

---

## Map

```
docs/
  getting-started.md   ← use it (CLI + API)
  overview.md          ← why we rebuilt the engine
  architecture/        ← how it works
    README.md          ←   concept-first intro (start here)
    target-architecture.md / managed-view-architecture.md / extension-intent.md
    onboarding.md      ←   contributor map
  build-log.md         ← how it was built (history)
  roadmap/             ← what's left (backlog + follow-ups ledger)
```

`architecture/` is authoritative and current. `build-log.md` and `roadmap/` are,
respectively, the past and the future — trust the code and `architecture/` where
anything disagrees.
