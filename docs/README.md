# pg-delta-next docs

`pg-delta-next` compares two PostgreSQL schemas and emits a migration to turn one
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
- **[architecture/flows.md](architecture/flows.md)** — the debugger's map: every
  command flow (`diff`, `plan`, `apply`, `prove`, `schema export/apply`, …) drawn
  old-engine vs new-engine and mapped to the functions that actually run, with
  the invariant each upholds, the safety-gate catalogue, and a symptom →
  function playbook.
- **[architecture/target-architecture.md](architecture/target-architecture.md)** —
  the north star: the full design, principles, and guardrails.
- **[architecture/managed-view-architecture.md](architecture/managed-view-architecture.md)**
  — how scope, ownership, and applier capability enter the engine.
- **[architecture/extension-intent.md](architecture/extension-intent.md)** — how
  stateful extensions (pgmq, pg_cron, pg_partman) are diffed without losing data.

## 📋 What's done and what's next

- **[pr-299-summary.md](pr-299-summary.md)** — the plain-language TL;DR of the
  rewrite PR (ELI5 + schematics) plus an ownership overview of who built what.
- **[build-log.md](build-log.md)** — a light record of how the engine was built,
  hardened, and reviewed (the decision trail).
- **[roadmap/](roadmap/)** — the path to v1 ([v1.md](roadmap/v1.md)) and the
  post-v1 backlog ([post-v1.md](roadmap/post-v1.md)).

---

## Map

```
docs/
  getting-started.md   ← use it (CLI + API)
  overview.md          ← why we rebuilt the engine
  architecture/        ← how it works
    README.md          ←   concept-first intro (start here)
    target-architecture.md / managed-view-architecture.md / extension-intent.md
    flows.md           ←   per-command flows, old-vs-new (debugging map)
    onboarding.md      ←   contributor map
  pr-299-summary.md    ← the rewrite PR: TL;DR + ownership overview
  build-log.md         ← how it was built (history)
  roadmap/             ← what's left (v1, then post-v1)
```

`architecture/` is authoritative and current. `build-log.md` and `roadmap/` are,
respectively, the past and the future — trust the code and `architecture/` where
anything disagrees.
