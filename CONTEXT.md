# pg-toolbelt

PostgreSQL tooling for comparing schemas, planning migrations, and ordering DDL safely. This context captures the project language used when discussing pg-delta migration planning.

> **Scope note.** This glossary describes the clean-room engine. The legacy
> per-object-type engine's vocabulary — typed `Change` classes, structural
> normalization, cycle-breaking change injection and its per-cycle matchers —
> is **gone**: the new engine diffs content-addressed facts, has no per-object
> change classes, and forms no dependency cycles to break. Those terms survive
> only in historical documents (`docs/build-log.md`,
> `docs/architecture/target-architecture.md`), never as a description of
> current behavior.

## Language

**Migration plan**:
An ordered set of DDL changes that transforms a source database schema into a target database schema.
_Avoid_: Script, diff output

**Fact**:
A content-addressed record of one addressable thing in the catalog — a table, column, constraint, policy, grant, comment. Identity lives in `id`; semantic state lives in `payload`. Every state in the system is a set of facts.
_Avoid_: Object, model, catalog entry

**Fact base**:
The complete normalized set of facts plus their parent and dependency edges, extracted from one consistent PostgreSQL snapshot.
_Avoid_: Catalog, snapshot, when the in-memory diffable state is meant

**Delta**:
A single fact-level difference between two fact bases (add / remove / set / link). Produced by the generic diff, which has no per-object-type code.
_Avoid_: Change, diff entry

**Action**:
One atomic DDL operation emitted from a delta by the rule table, declaring the fact ids it produces, consumes, destroys, and releases.
_Avoid_: Statement, when the typed operation before serialization is meant

**Stable identifier**:
An environment-independent, name-based declarative address for a schema object. Not a PostgreSQL OID — `encodeId()` is the only string codec.
_Avoid_: OID

**Managed view**:
The policy-defined, applier-capability-restricted projection of the fact base that the engine actually diffs. Scope, ownership, and applier capability all enter here.
_Avoid_: Filter, scope, when the whole projection is meant

**Migration-plan topological ordering**:
The exact, trusted sort of the plan's **Actions**, computed from catalog dependency edges. This is the ordering that produces the apply. At fact grain there are no cycles to break.
_Avoid_: "Ordering" unqualified; topological sort, when the context is loading raw SQL into the shadow

**Shadow-load ordering**:
The best-effort, fail-safe sequencing of raw SQL **statements** into the shadow database. Advisory and approximate: it can only fail to build the shadow (a visible error before extraction), never corrupt the extracted desired state, because Postgres is the elaborator.
_Avoid_: Topological sort; "ordering" unqualified, when the migration-plan ordering is meant

**Statement reordering assist**:
The optional pg-topo pre-sort that produces a shadow-load ordering — it splits files into one-statement units and topologically pre-sorts them. Advisory and degradable: correctness comes from the split plus the shadow's retry rounds, never from trusting the assist's order.
_Avoid_: Topological sort, when the trusted migration-plan ordering is meant; "the sorter", when ambiguous with the plan sort

**Shadow-load cycle**:
A raw-SQL cycle (e.g. inline mutual foreign key) that stops the shadow from converging. It is a property of the input files, not of the plan graph.
_Avoid_: Dependency cycle, which in the new engine would be a rule bug rather than an expected condition

**Proof loop**:
Applying a plan to a throwaway clone, re-extracting, and checking both state convergence (zero drift deltas) and data preservation (seeded rows survive).
_Avoid_: Validation, verification, test

## Relationships

- A **Migration plan** contains ordered **Actions**.
- An **Action** names the **Stable identifiers** it produces, consumes, destroys, or releases.
- A **Delta** is produced by diffing two **Fact bases** through the **Managed view**; the rule table turns a delta into one or more **Actions**.
- **Migration-plan topological ordering** is trusted and operates on **Actions**; **Shadow-load ordering** is advisory and operates on raw SQL **statements**. They are different orderings at different stages.
- A **Statement reordering assist** produces a **Shadow-load ordering**; it never feeds the **Migration-plan topological ordering**.
- A **Shadow-load cycle** stops the shadow load and is surfaced as an advisory hint on top of the authoritative Postgres error.
- A cycle in the **Migration-plan topological ordering** is a rule-table bug caught in CI, not a runtime condition to repair.

## Example dialogue

> **Dev:** "The plan sort hit a cycle — which breaker handles it?"
> **Domain expert:** "None. There are no breakers. At fact grain a cycle means the rule table declared the wrong produces/consumes set — fix the rule."

## Flagged ambiguities

- "Ordering" / "topological sort" was used for both the trusted plan sort and the best-effort shadow load. Resolved: the trusted sort of **Actions** is **Migration-plan topological ordering**; the best-effort sequencing of raw SQL **statements** into the shadow is **Shadow-load ordering**, produced by the advisory **Statement reordering assist**. A cycle in raw SQL is a **Shadow-load cycle**.
- "Change" was used for both a fact-level difference and an emitted DDL operation. Resolved: a fact-level difference is a **Delta**; an emitted DDL operation is an **Action**. "Change" is legacy-engine vocabulary and is avoided.
