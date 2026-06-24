# pg-delta: Current Architecture vs. North Star

> **Companion to** [PR #297](https://github.com/supabase/pg-toolbelt/pull/297) and
> [`docs/target-architecture.md`](./target-architecture.md) (on the
> `docs/target-architecture` branch).
>
> This document explains *why* the north star exists and *what* changes at a
> conceptual level. The RFC is the authoritative spec; this is the guided tour.

---

## What the tool does (unchanged)

Both the current engine and the north star solve the same problem:

```mermaid
flowchart LR
    A["Database A<br/>(source state)"]
    B["Database B<br/>(target state)"]
    E["Schema diff engine"]
    S["DDL migration script<br/>ALTER / CREATE / DROP"]

    A --> E
    B --> E
    E --> S
```

You have two PostgreSQL schema shapes. The tool produces a **minimal, correctly
ordered, reviewable, safety-classified** DDL script that transforms one into the
other — deterministically, and (in the north star) **provably**.

The RFC does not change the job. It redesigns **what is inside the engine**.

---

## The two principles everything hangs on

The north star is derived from two first-principles decisions. Every design
choice flows from these:

| Principle | In one sentence |
|---|---|
| **P1 — Postgres is the only elaborator** | Never reimplement PostgreSQL semantics in TypeScript. Feed inputs through a real Postgres instance and read the answer. |
| **P2 — Knowledge lives in exactly two forms** | (1) extraction queries that produce facts, and (2) a declarative rule table that turns fact-deltas into actions. Everything else is generic machinery. |

These two sentences replace roughly **31,000 lines** of per-object plumbing in
today's `objects/` tree.

---

## Side-by-side at a glance

```mermaid
flowchart TB
    subgraph OLD["Current engine (today)"]
        direction TB
        O1["Extract → nested documents<br/>(table = fat blob with columns inside)"]
        O2["21 hand-written diff functions"]
        O3["106 change classes<br/>(table.create, view.drop, …)"]
        O4["Two-phase sort + invalidates<br/>+ repair loop"]
        O5["Cycle breakers<br/>(hand-written per cycle class)"]
        O6["Serialize → SQL<br/>(hope the tests caught it)"]

        O1 --> O2 --> O3 --> O4 --> O5 --> O6
    end

    subgraph NEW["North star (target)"]
        direction TB
        N1["Extract → flat facts + Merkle hashes<br/>(column, constraint, comment = each a row)"]
        N2["One generic diff<br/>(hash compare, O(changed))"]
        N3["Rule table<br/>(data, not 106 classes)"]
        N4["One dependency graph → one sort<br/>(cycles structurally impossible)"]
        N5["Optional compaction<br/>(cosmetics only)"]
        N6["Proof loop on a clone<br/>(state + data preservation)"]

        N1 --> N2 --> N3 --> N4 --> N5 --> N6
    end
```

### One-line comparison

| Concern | Current | North star |
|---|---|---|
| **State shape** | Nested documents (big lumps) | Flat facts + content hashes |
| **Per-type logic** | ~31K LOC, 106 change classes, 21 diff functions | Extraction SQL + one rule table |
| **Who understands Postgres** | Three engines that must agree | One engine: Postgres itself |
| **Dependency cycles** | Happen → write a new cycle breaker | Structurally unconstructible |
| **Correctness claim** | Test suite coverage | Proof on a scratch clone |
| **Column renames** | Often guessed as drop+create → **data loss** | Same hash → detected as rename |
| **Vendor rules (Supabase)** | Baked into engine code | Policy layer (data package) |
| **SQL file inputs** | Static parser + retry loop | Shadow DB → extract what Postgres built |

---

## The root cause: three granularities that disagree

The deepest problem in the current design is not any single bug — it is a
**grain mismatch** between how state is stored, how Postgres records
dependencies, and how actions are emitted.

```mermaid
flowchart TB
    subgraph STATE["State (equality)"]
        S1["Document level"]
        S2["A 'table' is one object<br/>columns, constraints, ACLs nested inside"]
    end

    subgraph DEPS["Dependencies (pg_depend)"]
        D1["Sub-entity level"]
        D2["Edges point at columns,<br/>constraints, functions…"]
    end

    subgraph ACTS["Actions (plan output)"]
        A1["Statement level"]
        A2["CREATE TABLE with inline columns,<br/>ALTER COLUMN TYPE, DROP CONSTRAINT…"]
    end

    STATE ---|"translation glue"| DEPS
    DEPS ---|"translation glue"| ACTS
    STATE ---|"1,034 lines in table.diff.ts alone"| ACTS
```

**Postgres thinks in rows.** `pg_attribute`, `pg_constraint`, and `pg_attrdef`
are separate catalog entries referencing their parent. The current engine
re-imposes a document hierarchy on top — then spends most of its code
translating between the three grains:

- `table.create.ts` re-enumerates column IDs out of a nested array so the
  sort graph can see them
- The graph builder maintains reverse multimaps to map dependency IDs back
  onto change objects
- Each `*.diff.ts` re-walks nested documents to discover *which sub-part*
  actually changed

The north star removes the translation by **removing the disagreement**: state,
dependencies, deltas, and actions all live at **fact grain**.

---

## Current architecture (detailed)

### Pipeline

```mermaid
flowchart TD
    DB[("Live PostgreSQL")]
    SQL["SQL files"]
    CAT["Catalog extraction<br/>~28 parallel queries"]
    BLOB["Nested catalog models<br/>(Zod documents per object type)"]
    DIFF["21 per-type diff functions"]
    CHG["106 change classes"]
    NORM["Post-diff normalization<br/>expand-replace, invalidates"]
    SORT["Two-phase topological sort<br/>DROP phase → CREATE/ALTER phase"]
    CYCLE{"Cycle detected?"}
    BREAK["Cycle breakers<br/>tryBreakFkCycle, tryBreakPublicationColumnCycle, …"]
    SER["Per-class serializers"]
    OUT["Concatenated SQL script"]

    DB --> CAT
    SQL --> TOPO["pg-topo static parser<br/>(approximate)"]
    TOPO --> RETRY["Round-based retry apply<br/>(ask Postgres for forgiveness)"]
    RETRY --> CAT

    CAT --> BLOB --> DIFF --> CHG --> NORM --> SORT --> CYCLE
    CYCLE -->|yes| BREAK --> SORT
    CYCLE -->|no| SER --> OUT
    BREAK --> SER
```

### Three semantic engines (P1 violation)

Today the tool runs **three brains** that must agree on PostgreSQL semantics:

```mermaid
flowchart LR
    subgraph E1["Engine 1: Catalog extraction"]
        direction TB
        E1a["Exact — reads pg_catalog"]
        E1b["Uses pg_depend for edges ✓"]
    end

    subgraph E2["Engine 2: pg-topo"]
        direction TB
        E2a["Approximate — libpg-query AST"]
        E2b["Heuristic name resolution,<br/>signature inference, filtering"]
    end

    subgraph E3["Engine 3: Round apply"]
        direction TB
        E3a["Try statements, retry on error"]
        E3b["O(n²) worst case"]
    end

    E1 ---|"must agree"| E2
    E2 ---|"must agree"| E3
```

Half the codebase already made the right call — dependency edges come from
`pg_depend`, never from parsing. But SQL-file workflows and ordering still
depend on approximate static analysis and retry loops.

### Eight forms of PostgreSQL knowledge (P2 violation)

Every new PostgreSQL version or object type tends to touch most of these:

| # | Form | Example location |
|---|---|---|
| 1 | Extractor SQL | `*.model.ts` queries |
| 2 | Zod models | nested document schemas |
| 3 | Per-type diff functions | `table.diff.ts` (1,034 lines) |
| 4 | Change classes | 106 classes across 278 files |
| 5 | Serializers | per-class `serialize()` |
| 6 | Custom sort constraints | `custom-constraints.ts` |
| 7 | Cycle breakers | `cycle-breakers.ts` |
| 8 | Post-diff normalization | `expand-replace-dependencies.ts` |

### When sorting fails: cycle breakers

Dependency cycles (A needs B, B needs A) are a fact of schema migration. The
current engine handles them with **runtime repair**:

```mermaid
flowchart TD
    PLAN["Sorted plan"]
    SORT["Topological sort"]
    FAIL["UnorderableCycleError"]
    INJECT["Inject extra changes<br/>(drop FK early, rebuild ALTER, …)"]
    RETRY["Re-sort"]
    SHIP["Ship to production"]

    PLAN --> SORT
    SORT -->|cycle| FAIL --> INJECT --> RETRY
    RETRY -->|still broken| FAIL
    RETRY -->|works| SHIP
    SORT -->|ok| SHIP
```

Each new cycle class discovered in the field becomes a hand-written breaker.
The codebase even fights itself: post-diff normalization *prunes* constraint
drops for compactness, then the drop-phase breaker *re-injects* them.

**Failure mode:** wrong or unsortable plan in production → emergency patch.

---

## North star architecture (detailed)

### Pipeline

```mermaid
flowchart TD
    subgraph INPUTS["Three inputs, one elaborator"]
        LIVE[("Live DB")]
        FILES["SQL files"]
        SNAP["Snapshot JSON"]
    end

    SHADOW["Shadow PostgreSQL<br/>(ephemeral)"]
    EXTRACT["Parallel snapshot extraction<br/>pg_export_snapshot model"]
    FB["FACT BASE<br/>flat rows + parent edges + Merkle rollups"]

    LIVE --> EXTRACT
    FILES --> SHADOW --> EXTRACT
    SNAP --> FB
    EXTRACT --> FB

    DIFF["Generic diff<br/>rollup-guided hash descent"]
    DELTA["Fact-level deltas<br/>add / remove / set / link / unlink"]
    RULES["Rule table<br/>(only per-type knowledge)"]
    ACT["Atomic actions<br/>≈ 1:1 with deltas"]
    GRAPH["One mixed dependency graph"]
    SORT["One deterministic topological sort"]
    COMPACT["Optional compaction<br/>(idiomatic DDL, never wrongness)"]
    PLAN["Plan + safety report"]
    PROOF["Proof loop"]
    EXEC["Lock-aware segmented apply"]
    OUT["Verified DDL script"]

    FB --> DIFF --> DELTA --> RULES --> ACT --> GRAPH --> SORT
    SORT --> COMPACT --> PLAN
    PLAN --> PROOF
    PROOF -->|pass| EXEC --> OUT
    PROOF -->|fail| RULES
```

### The fact base: LEGO bricks, not lumps

Every addressable thing is its own **fact** — mirroring how `pg_catalog` already
works:

```mermaid
flowchart TB
    subgraph TABLE["Parent: table:public.users"]
        T["fact: table<br/>hash: abc…"]
        C1["fact: column id<br/>hash: def…"]
        C2["fact: column email<br/>hash: ghi…"]
        CON["fact: constraint users_pkey<br/>hash: jkl…"]
        DEF["fact: default on email<br/>hash: mno…"]
        CM["fact: comment on table<br/>hash: pqr…"]
        ACL["fact: ACL entry<br/>hash: stu…"]
    end

    T --> C1
    T --> C2
    T --> CON
    C2 --> DEF
    T --> CM
    T --> ACL
```

Each fact carries:

- **Typed identity** — structured parts (`{kind, schema, name, …}`), one codec
- **Normalized payload** — canonical `pg_get_*def()` output, logical names not attnums
- **Content hash** — identity-free (names live in the ID, not the hash)
- **Merkle rollup** — parent hash folds children + outgoing edges

Two states with identical rollups at the root → **nothing changed below**.
Diffing skips entire unchanged subtrees → **O(changed)**, zero per-type diff code.

### Generic diff: hash algebra, not hand-written logic

```mermaid
flowchart TD
    A["Source fact base"]
    B["Target fact base"]

    A --> CMP{"Root rollups<br/>equal?"}
    CMP -->|yes| SKIP["Skip entire subtree ✓"]
    CMP -->|no| DESC["Descend to children"]
    DESC --> FCMP{"Fact hashes<br/>equal?"}
    FCMP -->|yes| SKIP
    FCMP -->|no| ATTR["Compare payload attributes"]
    ATTR --> DELTA["Emit delta:<br/>add / remove / set / link / unlink"]

    B --> CMP
```

The differ never knows what a "table" is. It only knows hashes and attribute
paths. "The default on `column:public.users.email` changed" falls out
automatically — no `table.diff.ts` required.

### Rule table: the only place per-type knowledge lives

```mermaid
flowchart LR
    D["Delta:<br/>set column type<br/>integer → text"]
    R["Rule for kind=column,<br/>attr=type"]
    A["Action:<br/>ALTER COLUMN … TYPE<br/>+ teardown/rebuild edges"]
    META["Safety metadata:<br/>lock class, rewrite risk,<br/>data-loss class"]

    D --> R --> A --> META
```

Cross-cutting metadata gets **one global rule**, not 21 per-object-type copies:

| Metadata kind | Current | North star |
|---|---|---|
| Comments | 21 implementations | 1 rule: `comment(target) = text` |
| ACLs / privileges | per-type wrappers | 1 rule per ACL shape |
| Security labels | per-type wrappers | 1 rule |

A rule that misdeclares alterability or cascades is caught by the **proof loop
in CI the day it is written** — not as a field bug months later.

### Why cycles disappear: maximal decomposition

This is pg_dump's deep trick, adopted wholesale:

```mermaid
flowchart LR
    subgraph OLD_ACTION["Old: compound action"]
        O["DROP TABLE users<br/>(implicitly drops FKs, indexes, …)"]
    end

    subgraph NEW_ACTION["New: atomic actions"]
        D1["remove fact: FK users_account_fkey"]
        D2["remove fact: index users_email_idx"]
        D3["remove fact: table users"]
    end

    OLD_ACTION ---|"creates cycles<br/>between DROP and CREATE"| PROB["⚠️ needs cycle breaker"]
    NEW_ACTION ---|"each edge explicit,<br/>graph orders naturally"| OK["✓ no cycle possible"]
```

**Failure mode shift:**

| | Current | North star |
|---|---|---|
| Bad case | Wrong plan shipped | More verbose script |
| Recovery | Hotfix cycle breaker | Tune compaction rule |
| Severity | Data loss / failed migration | Cosmetic ugliness |

A cycle in the north star is always a **rule bug** — caught in CI, never patched
at runtime.

### The proof loop: the keystone

The north star can **certify its own output** because any state can be
materialized and re-extracted:

```mermaid
flowchart TD
    SRC[("Source DB")]
    CLONE["Scratch clone<br/>(seeded with test rows)"]
    PLAN["Generated plan"]
    APPLY["Apply plan to clone"]
    REEXT["Re-extract fact base"]
    TARGET["Target fact base"]

    SRC --> CLONE
    PLAN --> APPLY
    CLONE --> APPLY
    APPLY --> REEXT

    REEXT --> CHECK1{"State proof:<br/>rollup hashes match target?"}
    CHECK1 -->|no| FAIL1["❌ Plan is wrong"]
    CHECK1 -->|yes| CHECK2{"Data proof:<br/>seeded rows survived<br/>where dataLoss = none?"}
    CHECK2 -->|no| FAIL2["❌ Convergent but destructive<br/>(drop+create instead of alter)"]
    CHECK2 -->|yes| PASS["✅ Verified plan"]

    TARGET --> CHECK1
```

**Why two checks?** Schema convergence alone has a blind spot: drop+create and
alter-in-place can produce **identical catalog state** — but only one preserves
your rows. The data-preservation check closes that hole.

The safety report's `dataLoss` column stops being a guess and becomes a
**verified claim**.

---

## Feature unlocks (not just cleanup)

### Rename detection — including columns

```mermaid
flowchart LR
    subgraph SOURCE
        S["remove column: users.email_addr<br/>hash: X7f2…"]
    end

    subgraph TARGET
        T["add column: users.email<br/>hash: X7f2…"]
    end

    S ---|"same payload hash,<br/>different name"| T
    T --> REN["→ ALTER COLUMN … RENAME TO<br/>(data preserved)"]
```

Every comparable tool punts on renames. Here they fall out of content addressing.
The case that destroys data in practice — **column renames misclassified as
drop+create** — becomes detectable.

### Integrations as policy, not engine

```mermaid
flowchart TB
    ENGINE["Generic engine<br/>(sees everything)"]
    DELTAS["All fact deltas"]
    POLICY["Policy layer<br/>(Supabase = data package)"]
    FILTER["Filter predicates<br/>'hide extension-owned facts'"]
    PARAMS["Serialize parameters<br/>skipAuthorization, …"]
    BASELINE["Platform baseline<br/>(fact-base subtraction)"]
    USER["User-visible plan"]

    ENGINE --> DELTAS --> POLICY
    FILTER --> POLICY
    PARAMS --> POLICY
    BASELINE --> POLICY
    POLICY --> USER
```

A vendor integration becomes a **versionable data package** — predicates, rule
parameters, and a baseline snapshot — tested with the same proof harness as the
core engine.

### pg-topo's new role

```mermaid
flowchart TB
    subgraph TRUSTED["Trusted path (production)"]
        PG["PostgreSQL only"]
    end

    subgraph DEV["Developer experience (optional)"]
        TOPO["pg-topo: lint, file ordering,<br/>instant editor feedback"]
    end

    TRUSTED ---|"no dependency"| DEV
```

pg-topo exits the trusted path. WASM leaves the core install. Static analysis
survives where it is genuinely good — **fast feedback for humans** — without
needing to agree with the exact engine.

---

## What survives vs. what gets replaced

```mermaid
flowchart LR
    subgraph SURVIVES["Imported assets (knowledge, not mechanisms)"]
        S1["Extractor SQL corpus"]
        S2["pg_depend doctrine"]
        S3["Normalization knowledge<br/>(stableSnapshot → fact payload)"]
        S4["Integration scenario corpus<br/>(→ proof harness seed)"]
        S5["Risk classification tables"]
    end

    subgraph REPLACED["Replaced plumbing"]
        R1["Nested document models"]
        R2["106 change classes"]
        R3["21 diff functions"]
        R4["Cycle breakers"]
        R5["Three semantic engines"]
        R6["Byte-level SQL snapshots in tests"]
    end
```

The old engine is not thrown away immediately. During the build it serves as:

1. **Asset donor** — SQL, scenarios, normalization rules
2. **Differential oracle** — run both engines, assert state-equivalent plans

---

## The migration path: clean-room build beside the old engine

```mermaid
flowchart TB
    subgraph Foundation["Foundation"]
        S0["Stage 0<br/>Test corpus first"]
        S1["Stage 1<br/>Fact-base core"]
        S2["Stage 2<br/>Extractor port"]
        S3["Stage 3<br/>Proof harness"]
    end

    subgraph Engine["Engine"]
        S4["Stage 4<br/>Generic diff"]
        S5["Stage 5<br/>Planner + rule table"]
        S6["Stage 6<br/>Execution"]
    end

    subgraph Product["Product"]
        S7["Stage 7<br/>Frontends (shadow DB)"]
        S8["Stage 8<br/>Policy layer (Supabase)"]
        S9["Stage 9<br/>Renames + public API"]
    end

    subgraph Cutover["Cutover"]
        S10["Stage 10<br/>Parity bar → new major"]
    end

    S0 --> S1 --> S2 --> S3 --> S4 --> S5 --> S6 --> S7 --> S8 --> S9 --> S10
```

Key discipline:

- **Stage 0 builds the definition of done before any engine code exists**
- **No byte-compatibility gates** — only proof, differential, and fixture gates
- **Consumers migrate once** at cutover to a new major
- **RED→GREEN** regression discipline carries over; every field bug becomes a
  corpus entry pinned forever

---

## Honest tradeoffs (read this before overselling)

The north star is technically optimal for the problem space — not free.

| Tradeoff | Reality |
|---|---|
| **Extraction cost** | More work upfront. Flat facts + "read everything" means extraction does *more* I/O, not less. Pay once at extract; diff becomes O(changed). |
| **Postgres dependency** | Shadow DB elaboration and proof both need a real Postgres instance. Fully offline / no-Docker workflows need a lighter tier or degrade gracefully. |
| **Verbosity** | Atomic actions produce longer scripts before compaction. Ugliness is recoverable; wrongness is not — that is the explicit trade. |
| **Full rebuild** | This is a brand-new library built clean-room. No in-place migration path; cutover is a new major. |
| **Minimality** | Proof verifies correctness and data survival, not minimality. "Unnecessarily rebuilt a 2 TB index" converges fine — semantic plan assertions cover that in tests. |

---

## Summary diagram: the whole shift

```mermaid
flowchart TB
    subgraph PROBLEM["The problem (same forever)"]
        P["Two schema states → one correct DDL script"]
    end

    subgraph OLD_BOX["Old magic box"]
        direction TB
        O1["Documents"]
        O2["8 knowledge forms"]
        O3["3 semantic engines"]
        O4["Cycle repair at runtime"]
        O5["Trust the test matrix"]
    end

    subgraph NEW_BOX["New magic box"]
        direction TB
        N1["Facts + hashes"]
        N2["2 knowledge forms"]
        N3["Postgres only"]
        N4["Cycles impossible by design"]
        N5["Prove on a clone"]
    end

    PROBLEM --> OLD_BOX
    PROBLEM --> NEW_BOX

    OLD_BOX -->|"replaced at cutover"| NEW_BOX
```

---

## Further reading

| Document | What it covers |
|---|---|
| [`target-architecture.md`](./target-architecture.md) | Full north star spec (§1–§11), decision log, guardrails |
| [`stage-00-test-suite.md`](./stage-00-test-suite.md) … [`stage-10-cutover.md`](./stage-10-cutover.md) | Per-stage implementation guides with gates |
| [PR #297](https://github.com/supabase/pg-toolbelt/pull/297) | Review thread, Codex findings, maintainer decisions |
| [`packages/pg-delta/docs/sorting.md`](../packages/pg-delta/docs/sorting.md) | How the *current* sort layer works today |

---

*Generated as a companion explainer for PR #297. When the RFC and this document
conflict, the RFC wins.*
