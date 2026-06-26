# pg-toolbelt

PostgreSQL tooling for comparing schemas, planning migrations, and ordering DDL safely. This context captures the project language used when discussing pg-delta migration planning and dependency-cycle handling.

## Language

**Migration plan**:
An ordered set of DDL changes that transforms a source database schema into a target database schema.
_Avoid_: Script, diff output

**Change**:
A single schema operation emitted by a diff, carrying the stable identifiers it creates, drops, or requires.
_Avoid_: Statement, when referring to the typed operation before serialization

**Stable identifier**:
An environment-independent name for a schema object used to connect changes to catalog dependencies.
_Avoid_: OID

**Dependency cycle**:
A cycle in the migration-plan dependency graph that prevents topological ordering.
_Avoid_: Circular diff

**Structural normalization**:
A deterministic rewrite of the final change list before dependency sorting.
_Avoid_: Cycle breaker

**Cycle-breaking change injection**:
A sort-phase rewrite that injects or rebuilds changes after an unbreakable dependency cycle is detected.
_Avoid_: Post-diff normalization, when the fix is specific to a detected graph cycle

**Publication FK-chain constraint-drop cycle**:
A dependency cycle where publication membership is being removed for dropped tables, those dropped tables carry a foreign-key chain, and the chain ends at a separately dropped referenced constraint.
_Avoid_: Publication drop cycle, dropped-table publication membership cycle

**FK constraint-drop injection**:
Cycle-breaking change injection that creates explicit foreign-key constraint drops and makes table drops stop claiming those constraint stable identifiers.
_Avoid_: Relaxed publication requirement, when resolving dropped-table publication membership cycles

**Migration-plan topological ordering**:
The exact, trusted sort of the diff's typed **Changes**, computed from catalog dependency edges. This is the ordering that produces the apply.
_Avoid_: "Ordering" unqualified; topological sort, when the context is loading raw SQL into the shadow

**Shadow-load ordering**:
The best-effort, fail-safe sequencing of raw SQL **statements** into the shadow database. Advisory and approximate: it can only fail to build the shadow (a visible error before extraction), never corrupt the extracted desired state, because Postgres is the elaborator.
_Avoid_: Topological sort; "ordering" unqualified, when the migration-plan ordering is meant

**Statement reordering assist**:
The optional pg-topo pre-sort that produces a shadow-load ordering — it splits files into one-statement units and topologically pre-sorts them. Advisory and degradable: correctness comes from the split plus the shadow's retry rounds, never from trusting the assist's order.
_Avoid_: Topological sort, when the trusted migration-plan ordering is meant; "the sorter", when ambiguous with the plan sort

**Shadow-load cycle**:
A raw-SQL cycle (e.g. inline mutual foreign key) that stops the shadow from converging. Distinct from a **Dependency cycle**, which is a cycle in the migration-plan graph of **Changes**.
_Avoid_: Dependency cycle, when the cycle is in raw SQL rather than the plan graph

## Relationships

- A **Migration plan** contains one or more **Changes**.
- A **Change** names the **Stable identifiers** it creates, drops, or requires.
- **Structural normalization** happens before dependency sorting and does not inspect a specific cycle path.
- **Cycle-breaking change injection** happens during dependency sorting and responds to a concrete **Dependency cycle**.
- A **Publication FK-chain constraint-drop cycle** is resolved by **Cycle-breaking change injection**, not by structural normalization.
- A **Publication FK-chain constraint-drop cycle** is resolved with **FK constraint-drop injection** while leaving publication membership and referenced-constraint drop changes unchanged.
- In a **Publication FK-chain constraint-drop cycle**, the terminal referenced-constraint drop table must be part of the publication membership being removed.
- **FK constraint-drop injection** for a **Publication FK-chain constraint-drop cycle** is cycle-local: inject only FK drops that point to a dropped table in the cycle or to the terminal referenced constraint being dropped.
- **FK constraint-drop injection** can be shared by multiple cycle breakers; each breaker still owns its own matcher and safety checks.
- **Migration-plan topological ordering** is trusted and operates on **Changes**; **Shadow-load ordering** is advisory and operates on raw SQL **statements**. They are different orderings at different stages.
- A **Statement reordering assist** produces a **Shadow-load ordering**; it never feeds the **Migration-plan topological ordering**.
- A **Shadow-load cycle** stops the shadow load and is surfaced as an advisory hint on the (authoritative) Postgres error; a **Dependency cycle** is resolved by **Cycle-breaking change injection** in the plan.

## Example dialogue

> **Dev:** "Should this publication/table drop issue be handled by structural normalization?"
> **Domain expert:** "No. The final change list is valid; the problem appears only after dependency sorting detects the specific cycle, so it belongs in cycle-breaking change injection."

## Flagged ambiguities

- "Whole-plan interaction" was used for both **Structural normalization** and **Cycle-breaking change injection**. Resolved: deterministic rewrites of the final change list are structural normalization; rewrites triggered by a concrete unbreakable dependency cycle are cycle-breaking change injection.
- `AlterTableDropConstraint` was first described as optional in the publication/table drop cycle. Resolved: the observed production cycle is a **Publication FK-chain constraint-drop cycle**, so a separately emitted referenced-constraint drop is part of that specific matcher.
- Rebuilding `AlterPublicationDropTables` with relaxed requirements was considered for **Publication FK-chain constraint-drop cycles**. Resolved: keep publication membership changes unchanged and break the foreign-key chain with **FK constraint-drop injection**.
- "Ordering" / "topological sort" was used for both the trusted plan sort and the best-effort shadow load. Resolved: the trusted sort of typed **Changes** is **Migration-plan topological ordering**; the best-effort sequencing of raw SQL **statements** into the shadow is **Shadow-load ordering**, produced by the advisory **Statement reordering assist**. A cycle in raw SQL is a **Shadow-load cycle**, not a **Dependency cycle**.
