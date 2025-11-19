# Change Sorting Algorithm

This document explains how the `sortChanges` function orders an array of `Change` objects to produce a valid migration script that respects PostgreSQL's dependency system.

## Table of Contents

1. [Overview](#overview)
2. [High-Level Architecture](#high-level-architecture)
3. [Pass 1: Logical Pre-Sorting](#pass-1-logical-pre-sorting)
4. [Pass 2: Dependency-Based Topological Sorting](#pass-2-dependency-based-topological-sorting)
   - [Phase Partitioning](#phase-partitioning)
   - [Dependency Graph Construction](#dependency-graph-construction)
   - [Constraint Sources](#constraint-sources)
   - [Topological Sorting](#topological-sorting)
5. [Key Concepts](#key-concepts)
6. [Examples](#examples)
7. [Complete Algorithm Flow](#complete-algorithm-flow)
8. [Logical Organization](#logical-organization)

## Overview

The sorting algorithm uses a **two-pass approach** to order schema changes:

1. **Logical Pre-Sorting** - Groups related changes together by schema, object type, stable ID, and scope to create readable, logically organized migration scripts
2. **Dependency-Based Topological Sorting** - Ensures correct execution order by respecting:
   - PostgreSQL's dependency system (`pg_depend` catalog data)
   - Explicit requirements (changes declare what they require via the `requires` getter)
   - Custom constraints (domain-specific ordering rules, e.g., ALTER DEFAULT PRIVILEGES before CREATE)

The algorithm maintains **stability** by preserving input order when dependencies don't dictate a stricter ordering.

## High-Level Architecture

The algorithm uses a **two-pass sorting strategy**:

```
┌─────────────────────────────────────────────────────────────┐
│                    Input: Changes Array                      │
│  [Change1, Change2, Change3, Change4, Change5, ...]         │
└────────────────────┬────────────────────────────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │  Pass 1: Logical        │
         │  Pre-Sorting            │
         │  Groups by:              │
         │  - Schema               │
         │  - Object type          │
         │  - Stable ID            │
         │  - Scope                │
         └────────┬─────────────────┘
                  │
                  ▼
         ┌────────────────────────┐
         │  Logically Grouped      │
         │  Changes Array          │
         └────────┬─────────────────┘
                  │
                  ▼
         ┌────────────────────────┐
         │  Pass 2: Dependency-    │
         │  Based Sorting          │
         │  (applied per phase)   │
         └────────┬─────────────────┘
                  │
                  ▼
         ┌────────────────────────┐
         │   Phase Partitioning    │
         │   (DROP vs CREATE/ALTER)│
         └────────┬─────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼                   ▼
┌──────────────┐    ┌──────────────────────┐
│  DROP Phase  │    │ CREATE/ALTER Phase  │
│  (inverted)  │    │   (forward)         │
└──────┬───────┘    └──────────┬───────────┘
       │                       │
       │  ┌─────────────────┐ │
       └─▶│ Build Graph &    │◀┘
          │ Topological Sort │
          │ (from Constraints)│
          └────────┬──────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │  Sorted Changes Array │
        │  [Drop1, Drop2, ...   │
        │   Create1, Create2...] │
        └───────────────────────┘
```

### Two-Pass Strategy

**Pass 1: Logical Pre-Sorting**
- Groups related changes together (e.g., all changes for `table:public.users` together)
- Sub-entities (indexes, triggers, RLS policies, rules) are grouped with their parent objects
- Creates a readable, logically organized structure
- Preserves relative order within groups (stability)

**Pass 2: Dependency-Based Topological Sorting**
- Ensures correct execution order by respecting dependencies
- Applied separately to DROP and CREATE/ALTER phases
- Uses constraints derived from catalog dependencies, explicit requirements, and custom rules
- Reorders changes only when necessary to satisfy dependencies

### Why Two Phases (DROP vs CREATE/ALTER)?

- **DROP Phase**: Destructive operations must run in **reverse dependency order**. If table A depends on table B, we must drop A before B.
- **CREATE/ALTER Phase**: Constructive operations run in **forward dependency order**. If table A depends on table B, we must create B before A.

## Pass 1: Logical Pre-Sorting

Before applying dependency-based sorting, changes are logically pre-sorted to group related operations together. This makes migration scripts more readable and maintainable.

The logical pre-sorting groups changes by:
1. **Phase** (DROP vs CREATE/ALTER) - Separated first
2. **Schema** - Objects within the same schema are grouped together
3. **Effective object type** - Parent type for sub-entities (only when schemas differ)
4. **Main stable ID** - All changes for a specific object (e.g., `table:public.users`) are grouped together
5. **Actual object type** - Orders sub-entities within their parent group
6. **Scope** - Orders by operation scope (object, comment, privilege, etc.)
7. **Operation** - Orders by operation type (create, alter, drop)
8. **Original order** - Preserves stability within groups

**Key Features:**
- Sub-entities (indexes, triggers, RLS policies, rules) are grouped with their parent objects
- All changes for a specific table/view are kept together
- Comments and privileges are grouped with their target objects
- Non-schema objects (roles, languages, etc.) are sorted first

For detailed implementation notes, see the [Logical Organization](#logical-organization) section.

## Pass 2: Dependency-Based Topological Sorting

After logical pre-sorting, dependency-based topological sorting ensures changes execute in the correct order. This pass operates separately on DROP and CREATE/ALTER phases.

### Phase Partitioning

Changes are partitioned using `getExecutionPhase()` which inspects change properties:

```typescript
function getExecutionPhase(change: Change): Phase {
  // DROP operations → drop phase
  if (change.operation === "drop") return "drop";
  
  // CREATE operations → create_alter_object phase
  if (change.operation === "create") return "create_alter_object";
  
  // ALTER operations:
  // - scope="privilege" → create_alter_object phase (metadata)
  // - drops actual objects (not metadata) → drop phase (destructive)
  // - doesn't drop objects → create_alter_object phase (non-destructive)
  if (change.operation === "alter") {
    if (change.scope === "privilege") return "create_alter_object";
    const dropsObjects = change.drops?.some(id => !isMetadataStableId(id));
    return dropsObjects ? "drop" : "create_alter_object";
  }
  
  return "create_alter_object"; // default
}
```

### Example Partitioning

```
Input Changes:
  [DropTable(users), CreateTable(posts), AlterTableDropColumn(users), 
   CreateRole(admin), AlterTableAddColumn(users)]

Partitioned:
  DROP Phase:     [DropTable(users), AlterTableDropColumn(users)]
  CREATE/ALTER:   [CreateTable(posts), CreateRole(admin), AlterTableAddColumn(users)]
```

### Dependency Graph Construction

For each phase, we build a **directed acyclic graph (DAG)** where:
- **Nodes** = Change indices (0, 1, 2, ...)
- **Edges** = "must run before" relationships

### Graph Data Structures

The algorithm builds data structures to efficiently map between changes and stable IDs:

```typescript
GraphData {
  // For each change index, what stable IDs does it create?
  createdStableIdSets: [
    [0] → Set{"table:public.users", "column:public.users.id"},
    [1] → Set{"table:public.posts"},
    ...
  ]
  
  // For each change index, what stable IDs does it explicitly require?
  explicitRequirementSets: [
    [0] → Set{},  // DropTable doesn't require anything
    [1] → Set{"role:admin"},  // CreateTable requires role
    ...
  ]
  
  // Reverse index: which changes create a given stable ID?
  changeIndexesByCreatedId: {
    "table:public.users" → Set{0},
    "role:admin" → Set{2},
    ...
  }
  
  // Reverse index: which changes explicitly require a given stable ID?
  changeIndexesByExplicitRequirementId: {
    "role:admin" → Set{1, 3},
    ...
  }
}
```

### Stable IDs

**Stable IDs** are unique identifiers for database objects that remain constant across dumps/restores. Examples:

- `table:public.users` - a table
- `column:public.users.id` - a column
- `role:admin` - a role
- `schema:public` - a schema

Changes declare what they create and require via getters:

```typescript
class CreateTable extends Change {
  get creates(): string[] {
    return [
      this.table.stableId,  // "table:public.users"
      ...this.table.columns.map(col => col.stableId)  // column IDs
    ];
  }
  
  get requires(): string[] {
    return [stableId.role(this.table.owner)];  // "role:admin"
  }
}
```

## Constraint-Based Architecture

The algorithm uses a unified **Constraint** abstraction to represent all ordering requirements. All dependency sources are converted to Constraints, then Constraints are converted to graph edges.

### Constraint Interface

Constraints use a **discriminated union** type to represent different sources of ordering requirements:

```typescript
type Constraint = CatalogConstraint | ExplicitConstraint | CustomConstraint;

// Base properties shared by all constraints
interface BaseConstraint {
  sourceChangeIndex: number;  // Change that must come first
  targetChangeIndex: number;  // Change that must come after
}

// Constraint from catalog dependencies (pg_depend)
interface CatalogConstraint extends BaseConstraint {
  source: "catalog";
  reason: {
    dependentStableId: string;    // The stable ID that depends on referencedStableId
    referencedStableId: string;   // The stable ID being depended upon
  };
}

// Constraint from explicit requirements (Change.requires)
interface ExplicitConstraint extends BaseConstraint {
  source: "explicit";
  reason: {
    dependentStableId?: string;  // Optional: undefined if change doesn't create anything
    referencedStableId: string;   // The stable ID being required
  };
}

// Constraint from custom constraint functions
interface CustomConstraint extends BaseConstraint {
  source: "custom";
  description?: string;  // Optional description for debugging
}
```

**Key Points:**
- `CatalogConstraint` always has both `dependentStableId` and `referencedStableId`
- `ExplicitConstraint` may have `dependentStableId` undefined if the change doesn't create anything
- `CustomConstraint` has no `reason` field since these are direct change-to-change rules

### Constraint Sources

The dependency graph is built from **three sources**, all converted to Constraints:

### 1. Catalog Dependencies (pg_depend)

PostgreSQL's `pg_depend` catalog tracks object dependencies. These are converted to Constraints:

```
pg_depend row: {
  dependent_stable_id: "table:public.posts",
  referenced_stable_id: "table:public.users"
}

Algorithm:
  1. Filter catalog dependencies (unknown IDs only - cycle-breaking filters applied later)
  2. Find changes that create "table:public.users" → [Change A]
  3. Find changes that create or explicitly require "table:public.posts" → [Change B]
     (Uses `findConsumerIndexes` which finds both explicit requirements and changes that create the ID)
  4. Create Constraint: A → B
```

**Filtering:**

Basic validation happens inside `convertCatalogDependenciesToConstraints()`:
- Unknown stable IDs (with "unknown:" prefix) are filtered out

Cycle-breaking filters are **not** applied during constraint conversion. They are applied later when cycles are detected (see [Cycle Detection and Breaking](#cycle-detection-and-breaking)).

**Cycle-Breaking Filters:**

When a sequence is owned by a table column that also uses the sequence (via DEFAULT), `pg_depend` creates a cycle:
- `sequence → table/column` (ownership)
- `table/column → sequence` (column default)

We filter out the ownership dependency using `shouldFilterStableIdDependencyForCycleBreaking()`:
- **CREATE phase**: Sequences should be created before tables (ownership set via `ALTER SEQUENCE OWNED BY` after both exist)
- **DROP phase**: Prevents cycles when dropping sequences owned by tables that aren't being dropped

These filters are applied only to edges involved in detected cycles, not during initial constraint conversion.

**Visualization:**

```
pg_depend says: posts depends on users

Changes:
  [0] CreateTable(users)  creates: "table:public.users"
  [1] CreateTable(posts)  creates: "table:public.posts"

Constraint:
  { sourceChangeIndex: 0, targetChangeIndex: 1, source: "catalog",
    reason: { dependentStableId: "table:public.posts",
              referencedStableId: "table:public.users" } }
```

### 2. Explicit Requirements

Changes declare requirements via the `requires` getter. These are converted to Constraints:

```
Change A creates:  ["table:public.posts"]
Change A requires: ["role:admin"]
Change B creates:  ["role:admin"]

Algorithm:
  1. For each required ID in Change A
  2. Find changes that create that ID → [Change B]
  3. If Change A creates IDs:
     - For each created ID in Change A
     - Apply cycle-breaking filters
     - Create Constraint: B → A (with reason from created ID to required ID)
  4. If Change A doesn't create anything:
     - Create Constraint: B → A (with empty dependentStableId)
```

**Filtering:**

Cycle-breaking filters are **not** applied during constraint conversion. They are applied later when cycles are detected (see [Cycle Detection and Breaking](#cycle-detection-and-breaking)).

**Visualization:**

```
Changes:
  [0] CreateRole(admin)     creates: "role:admin"
  [1] CreateTable(posts)     creates: "table:public.posts"
                            requires: "role:admin"

Constraint:
  { sourceChangeIndex: 0, targetChangeIndex: 1, source: "explicit",
    reason: { dependentStableId: "table:public.posts",
              referencedStableId: "role:admin" } }
```

### 3. Custom Constraints

Domain-specific ordering rules that supplement the dependency graph. Custom constraints are implemented as functions that decide pairwise ordering between changes:

```typescript
// Custom constraint function type
type CustomConstraintFunction = (
  a: Change,
  b: Change,
) => "a_before_b" | "b_before_a" | undefined;

// Example: ALTER DEFAULT PRIVILEGES must come before CREATE statements
// (simplified - actual implementation includes schema and objtype matching)
function defaultPrivilegesBeforeCreate(
  a: Change,
  b: Change,
): "a_before_b" | undefined {
  const aIsDefaultPriv =
    a instanceof GrantRoleDefaultPrivileges ||
    a instanceof RevokeRoleDefaultPrivileges;
  const bIsCreate = b.operation === "create" && b.scope === "object";
  
  // Exclude CREATE ROLE and CREATE SCHEMA since they are dependencies
  const bIsRoleOrSchema =
    bIsCreate && (b.objectType === "role" || b.objectType === "schema");
  
  if (aIsDefaultPriv && bIsCreate && !bIsRoleOrSchema) {
    // Actual implementation also checks:
    // - Schema matching (default privilege schema matches CREATE schema, or default privilege is global)
    // - Object type matching (default privilege objtype matches CREATE object type)
    return "a_before_b";
  }
  
  return undefined;  // No constraint between these changes
}

// All custom constraints
export const customConstraints: CustomConstraintFunction[] = [
  defaultPrivilegesBeforeCreate,
];
```

**How it works:**

1. `generateCustomConstraints()` iterates through all pairs of changes
2. For each pair, applies all custom constraint functions
3. If a function returns `"a_before_b"` or `"b_before_a"`, creates a `CustomConstraint`
4. Returns all generated constraints

**Key Properties:**

- Custom constraints are **never filtered** during cycle breaking (they represent hard ordering requirements)
- They operate on change instances, not stable IDs
- They can inspect any property of the changes to make decisions

**Visualization:**

```
Changes:
  [0] AlterDefaultPrivileges(...)
  [1] CreateTable(posts)

Constraint:
  { sourceChangeIndex: 0, targetChangeIndex: 1, source: "custom" }
```

### Edge Structure

Edges carry their originating constraint for filtering purposes:

```typescript
interface Edge {
  sourceIndex: number;      // Change index that must come first
  targetIndex: number;      // Change index that must come after
  constraint: Constraint;    // The constraint that created this edge
}
```

### Edge Inversion for DROP Phase

In the DROP phase, edges are **inverted** when converting Constraints to edges:

```
CREATE Phase (forward):
  Constraint: { sourceChangeIndex: 0, targetChangeIndex: 1 }
  Edge: { sourceIndex: 0, targetIndex: 1, constraint: ... }
  → Edge pair: [0, 1]  (users must exist before posts)

DROP Phase (inverted):
  Constraint: { sourceChangeIndex: 0, targetChangeIndex: 1 }
  Edge: { sourceIndex: 1, targetIndex: 0, constraint: ... }
  → Edge pair: [1, 0]  (posts must be dropped before users)
```

This is handled by the `invert` option in `convertConstraintsToEdges()`:

```typescript
export function convertConstraintsToEdges(
  constraints: Constraint[],
  options: PhaseSortOptions,
): Edge[] {
  const edges: Edge[] = [];
  for (const constraint of constraints) {
    const sourceIndex = options.invert
      ? constraint.targetChangeIndex  // DROP phase: invert
      : constraint.sourceChangeIndex;  // CREATE phase: forward
    const targetIndex = options.invert
      ? constraint.sourceChangeIndex   // DROP phase: invert
      : constraint.targetChangeIndex;  // CREATE phase: forward
    edges.push({ sourceIndex, targetIndex, constraint });
  }
  return edges;
}
```

### Topological Sorting

Once the graph is built, we perform a **stable topological sort**:

### Algorithm (Kahn's Algorithm)

1. **Build adjacency list and in-degree counts**
   ```
   Adjacency: {
     0 → [1, 2],
     1 → [3],
     2 → [3],
     3 → []
   }
   
   In-degrees: [0: 0, 1: 1, 2: 1, 3: 2]
   ```

2. **Initialize queue with zero in-degree nodes**
   ```
   Queue: [0]  (only node 0 has in-degree 0)
   ```

3. **Process nodes**
   ```
   While queue not empty:
     - Remove node with smallest index (stability)
     - Add to result
     - Decrement in-degrees of neighbors
     - Add neighbors with zero in-degree to queue (maintaining sorted order)
   ```

4. **Result**: Topologically sorted indices

### Stability

The sort is **stable**, meaning:
- When multiple nodes have zero in-degree, we pick the **smallest index first**
- This preserves the input order when dependencies don't dictate otherwise

**Example:**

```
Input order: [Change A, Change B, Change C]
Dependencies: A → C

Without stability: Could be [A, C, B] or [A, B, C]
With stability:    Always [A, B, C] (B comes before C if no dependency)
```

### Cycle Detection and Breaking

The algorithm iteratively detects and breaks cycles:

1. **Detect cycles** - Find any cycle in the graph
2. **Track seen cycles** - Normalize and track cycles we've encountered
3. **Filter cycle edges** - Apply cycle-breaking filters only to edges involved in the detected cycle
4. **Repeat** - Continue until no cycles remain

**Termination Conditions:**

- **Success**: No cycles found → proceed to topological sort
- **Failure**: Encounter a cycle we've seen before → filtering didn't break it, throw error

**Key Properties:**

- Only edges involved in cycles are filtered (non-cycle edges are preserved)
- Cycles are normalized (rotated to start with smallest node index) for comparison
- No arbitrary iteration limit - continues until all cycles are broken or a cycle can't be broken
- Multiple cycles are handled iteratively (one at a time until all are resolved)

**Cycle-Breaking Filter Application:**

When a cycle is detected:
1. Identify edges that form the cycle
2. For each cycle edge:
   - If it's a custom constraint → never filtered
   - If it has a stable ID dependency → apply cycle-breaking filters
   - If filtering criteria match → remove the edge to break the cycle

**Example:**

```
Initial graph has cycle: A → B → C → A

Iteration 1:
  - Detect cycle [A, B, C]
  - Track cycle signature "A,B,C"
  - Filter edges in cycle (e.g., remove B → C if it matches filter criteria)
  - Result: Cycle broken, graph becomes A → B, C → A

Iteration 2:
  - Detect cycle [A, C] (new cycle)
  - Track cycle signature "A,C"
  - Filter edges in cycle
  - Result: Cycle broken

Iteration 3:
  - No cycles found → success
```

**Error Handling:**

If a cycle is encountered that we've seen before, it means our filtering didn't break it. The error message includes detailed information:

```
CycleError: dependency graph contains a cycle involving 2 changes:
  1. [0] CreateTable (creates: table:test_schema.events, column:test_schema.events.id...)
  2. [3] CreateSequence (creates: sequence:test_schema.events_id_seq)

Cycle path (edges forming the cycle):
  [0] → [3] (source: catalog)
    Dependency: sequence:test_schema.events_id_seq → column:test_schema.events.id
    Reason: Cycle-breaking filter did not match (edge preserved)
  [3] → [0] (source: catalog)
    Dependency: column:test_schema.events.id → sequence:test_schema.events_id_seq
    Reason: Cycle-breaking filter did not match (edge preserved)

This usually indicates a circular dependency in the schema changes that cannot be resolved.
The cycle-breaking filters were unable to break this cycle.
```

The error message shows:
- Which changes are in the cycle (with indices and class names)
- The cycle path (edges forming the cycle)
- For each edge: the constraint source, dependency details, and why it wasn't filtered
- This helps identify which dependencies are causing unresolvable cycles

## Key Concepts

### Multiple Created IDs

Some changes create multiple stable IDs (e.g., `CreateTable` creates the table + all columns). When converting explicit requirements to Constraints, if a change creates IDs, Constraints are created from each created ID to each required ID. Cycle-breaking filters are applied later when cycles are detected, not during constraint conversion.

### Unknown Dependencies

Dependencies with `"unknown:"` prefix are filtered out:

```typescript
// These cannot be reliably used for ordering
"unknown:some_object"  → filtered out
```

These typically occur when objects don't exist in the catalog or cannot be uniquely identified.

## Examples

### Example 1: Simple Table Dependency

**Input:**
```typescript
[
  CreateTable(posts),      // creates: ["table:public.posts"], requires: ["role:admin"]
  CreateRole(admin),       // creates: ["role:admin"]
  CreateTable(users)        // creates: ["table:public.users"], no requirements
]
```

**Graph Construction:**
```
Step 1: Build graph data
  createdStableIdSets:
    [0] → {"table:public.posts"}
    [1] → {"role:admin"}
    [2] → {"table:public.users"}
  
  explicitRequirementSets:
    [0] → {"role:admin"}
    [1] → {}
    [2] → {}
  
  changeIndexesByCreatedId:
    "table:public.posts" → {0}
    "role:admin" → {1}
    "table:public.users" → {2}

Step 2: Convert to Constraints
  Explicit requirements:
    Change[0] creates "table:public.posts", requires "role:admin"
    Change[1] creates "role:admin"
    → Constraint: { sourceChangeIndex: 1, targetChangeIndex: 0,
                    source: "explicit",
                    reason: { dependentStableId: "table:public.posts",
                              referencedStableId: "role:admin" } }

Step 3: Convert Constraints to edges
  Edge: [1, 0]

Step 4: Cycle detection and breaking
  Detect cycles: No cycles found
  Continue to topological sort

Step 5: Topological sort
  In-degrees: [0: 1, 1: 0, 2: 0]
  Queue: [1, 2] → sorted: [1, 2]
  Process 1: decrement 0 → [0: 0], add 0 to queue → [2, 0]
  Process 2: no changes
  Process 0: no changes
  Result: [1, 2, 0]
```

**Result:**
```typescript
[
  CreateRole(admin),      // First (no dependencies)
  CreateTable(users),     // Second (no dependencies, stable order)
  CreateTable(posts)      // Third (depends on role)
]
```

### Example 2: DROP Phase with Inversion

**Input:**
```typescript
[
  DropTable(users),       // drops: ["table:public.users"]
  DropTable(posts)        // drops: ["table:public.posts"]
]
```

**pg_depend (from main catalog):**
```
posts depends on users
```

**Graph Construction:**
```
Step 1: Build graph data (with invert=true)
  createdStableIdSets:
    [0] → {"table:public.users"}  // includes drops in invert mode
    [1] → {"table:public.posts"}
  
  changeIndexesByCreatedId:
    "table:public.users" → {0}
    "table:public.posts" → {1}

Step 2: Convert to Constraints
  Catalog dependencies (basic validation only):
    posts depends on users
    → Constraint: { sourceChangeIndex: 0, targetChangeIndex: 1,
                    source: "catalog",
                    reason: { dependentStableId: "table:public.posts",
                              referencedStableId: "table:public.users" } }

Step 3: Convert Constraints to edges (with invert=true)
  Constraint: { sourceChangeIndex: 0, targetChangeIndex: 1 }
  → Inverted edge: [1, 0]  (posts before users)

Step 4: Cycle detection and breaking
  Detect cycles: No cycles found
  Continue to topological sort

Step 5: Topological sort
  Result: [1, 0]
```

**Result:**
```typescript
[
  DropTable(posts),   // First (drop dependent before dependency)
  DropTable(users)    // Second
]
```

### Example 3: Custom Constraint

**Input:**
```typescript
[
  CreateTable(posts),
  AlterDefaultPrivileges(...),
  CreateRole(admin)
]
```

**Custom Constraint Function:**
```typescript
function defaultPrivilegesBeforeCreate(
  a: Change,
  b: Change,
): "a_before_b" | undefined {
  const aIsDefaultPriv =
    a instanceof GrantRoleDefaultPrivileges ||
    a instanceof RevokeRoleDefaultPrivileges;
  const bIsCreate = b.operation === "create" && b.scope === "object";
  const bIsRoleOrSchema =
    bIsCreate && (b.objectType === "role" || b.objectType === "schema");
  
  if (aIsDefaultPriv && bIsCreate && !bIsRoleOrSchema) {
    return "a_before_b";
  }
  return undefined;
}
```

**Graph Construction:**
```
Step 1: Build graph data
  (no dependencies in this example)

Step 2: Convert to Constraints
  Custom constraints:
    AlterDefaultPrivileges vs CreateTable(posts)
    → Constraint: { sourceChangeIndex: 1, targetChangeIndex: 0,
                    source: "custom" }
    
    AlterDefaultPrivileges vs CreateRole(admin)
    → No constraint (CreateRole excluded)

Step 3: Convert Constraints to edges
  Edge: [1, 0]

Step 4: Cycle detection and breaking
  Detect cycles: No cycles found
  Continue to topological sort

Step 5: Topological sort
  Result: [1, 2, 0]
```

**Result:**
```typescript
[
  AlterDefaultPrivileges(...),  // First (constraint)
  CreateRole(admin),            // Second (no dependencies)
  CreateTable(posts)            // Third (after default privileges)
]
```

## Complete Algorithm Flow

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ sortChanges(changes, catalogs)                              │
└────────────────────┬────────────────────────────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │  PASS 1: Logical        │
         │  Pre-Sorting            │
         │  Groups by schema,      │
         │  object type, stable ID │
         └────────┬─────────────────┘
                  │
                  ▼
         ┌────────────────────────┐
         │  Logically Grouped      │
         │  Changes                │
         └────────┬─────────────────┘
                  │
                  ▼
         ┌────────────────────────┐
         │  PASS 2: Dependency-    │
         │  Based Sorting          │
         └────────┬─────────────────┘
                  │
                  ▼
         ┌────────────────────────┐
         │ Partition into Phases  │
         │ - DROP                │
         │ - CREATE/ALTER        │
         └────────┬─────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼                   ▼
┌──────────────┐    ┌──────────────────────┐
│ DROP Phase   │    │ CREATE/ALTER Phase  │
│ (invert=true)│    │ (invert=false)      │
└──────┬───────┘    └──────────┬───────────┘
       │                       │
       │  ┌─────────────────┐ │
       └─▶│ sortPhaseChanges │◀┘
          └────────┬──────────┘
                   │
                   ▼
         ┌──────────────────────┐
         │ Step 1: buildGraphData │
         │ - createdStableIdSets  │
         │ - explicitRequirementSets│
         │ - reverse indexes      │
         └──────────┬────────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │ Step 2: Convert to     │
         │        Constraints    │
         │ - Catalog deps        │
         │   (basic validation)  │
         │ - Explicit requires   │
         │ - Custom constraints  │
         └──────────┬────────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │ Step 3: Convert       │
         │        Constraints   │
         │        to Edges      │
         │ (apply inversion)    │
         └──────────┬────────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │ Step 4: Cycle         │
         │        Detection &   │
         │        Breaking      │
         │ - Deduplicate edges  │
         │ - Detect cycles      │
         │ - Track seen cycles  │
         │ - Filter cycle edges │
         │ - Repeat until done  │
         └──────────┬────────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │ Step 5: performStable│
         │        TopoSort      │
         │ (edges already       │
         │  deduplicated)       │
         └──────────┬────────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │ Step 6: Map           │
         │        indices→changes│
         └──────────────────────┘
```

### Step-by-Step Pseudocode

```python
function sortChanges(changes, catalogs):
    # PASS 1: Logical pre-sorting
    logically_sorted = logicalSort(changes)
    
    # PASS 2: Dependency-based topological sorting
    return sortChangesByPhasedGraph(catalogs, logically_sorted)

function sortChangesByPhasedGraph(catalogs, changes):
    # Partition into phases
    drop_changes = [c for c in changes if getExecutionPhase(c) == "drop"]
    create_changes = [c for c in changes if getExecutionPhase(c) == "create_alter_object"]
    
    # Sort each phase using dependency information
    sorted_drops = sortPhaseChanges(
        drop_changes,
        catalogs.mainCatalog.depends,
        invert=True
    )
    
    sorted_creates = sortPhaseChanges(
        create_changes,
        catalogs.branchCatalog.depends,
        invert=False
    )
    
    # Combine phases
    return sorted_drops + sorted_creates

function sortPhaseChanges(changes, dependency_rows, invert=False):
    if changes.length <= 1:
        return changes
    
    # Step 1: Build graph data structures
    graph_data = buildGraphData(changes, invert)
    
    # Step 2: Convert all sources to Constraints
    catalog_constraints = convertCatalogDependenciesToConstraints(
        dependency_rows, graph_data
    )  # Only basic validation (unknown IDs)
    
    explicit_constraints = convertExplicitRequirementsToConstraints(
        changes, graph_data
    )  # No filtering during conversion
    
    custom_constraints = generateCustomConstraints(changes)
    
    all_constraints = catalog_constraints + explicit_constraints + custom_constraints
    
    # Step 3: Convert Constraints to edges
    edges = convertConstraintsToEdges(all_constraints, invert)
    
    # Step 4: Iteratively detect and break cycles
    seen_cycles = Set()
    
    while True:
        # Deduplicate edges (happens inside loop, before each cycle check)
        unique_edges = dedupeEdges(edges)
        edge_pairs = edgesToPairs(unique_edges)
        
        # Detect cycles
        cycle_node_indexes = findCycle(changes.length, edge_pairs)
        
        if not cycle_node_indexes:
            # No cycles found, we're done
            edges = unique_edges
            break
        
        # Normalize cycle to check if we've seen it before
        cycle_signature = normalizeCycle(cycle_node_indexes)
        if cycle_signature in seen_cycles:
            # We've seen this cycle before - filtering didn't break it
            cycle_edges = getEdgesInCycle(cycle_node_indexes, unique_edges)
            throw CycleError(cycle_node_indexes, changes, cycle_edges)
        
        # Track this cycle
        seen_cycles.add(cycle_signature)
        
        # Filter only edges involved in the cycle to break it
        edges = filterEdgesForCycleBreaking(
            unique_edges,
            cycle_node_indexes,
            changes,
            graph_data
        )
    
    # Step 5: Sort (edges already deduplicated, no cycles remain)
    edge_pairs = edgesToPairs(edges)
    sorted_indices = performStableTopologicalSort(changes.length, edge_pairs)
    
    # Step 6: Validate and map
    if sorted_indices.length != changes.length:
        throw CycleError  # Should never happen
    
    # Map indices to changes
    return [changes[i] for i in sorted_indices]
```

## Logical Organization

This section provides detailed implementation notes for **Pass 1: Logical Pre-Sorting**.

The logical pre-sorting step groups related changes together to create readable, logically organized migration scripts. While dependency resolution (Pass 2) ensures that changes execute in a valid order, logical organization makes migration scripts more maintainable.

### Benefits of Two-Pass Approach

This approach combines the benefits of:
- **Human readability** - Related changes are grouped together (e.g., all changes for `table:public.users`)
- **Correctness** - Dependencies are still respected within and across groups
- **Maintainability** - Developers can easily see all changes related to a specific object in one place

### Object Type Ordering

The logical order follows PostgreSQL's natural dependency hierarchy, from foundational objects to dependent ones. **Sub-entities are grouped immediately after their parent objects** to keep related changes together.

#### Parent-Child Relationships

Some object types are sub-entities that cannot exist without their parent objects:

- **Indexes** (`index`) → belong to **Tables** or **Materialized Views**
- **Triggers** (`trigger`) → belong to **Tables**
- **RLS Policies** (`rls_policy`) → belong to **Tables**
- **Rules** (`rule`) → belong to **Tables** or **Views**

These sub-entities should be grouped immediately after their parent objects in the logical ordering, making it easier to see all changes related to a table or view together.

#### DROP Phase Order (Reverse Dependency)

When dropping objects, we must drop dependents before dependencies. Sub-entities are grouped with their parents:

1. **Subscriptions** - Logical replication subscriptions (depend on publications)
2. **Publications** - Logical replication publications (depend on tables/objects)
3. **Event Triggers** - System-level event triggers
4. **Materialized Views** - Materialized views (depend on tables/views)
   - **Indexes** (on materialized views) - grouped with materialized views
5. **Views** - Regular views (depend on tables/other views)
   - **Rules** (on views) - grouped with views
6. **Tables** - Core table objects (depend on types, sequences, etc.)
   - **Rules** (on tables) - grouped with tables
   - **RLS Policies** (on tables) - grouped with tables
   - **Triggers** (on tables) - grouped with tables
   - **Indexes** (on tables) - grouped with tables
7. **Aggregates** - User-defined aggregates (depend on types/functions)
8. **Procedures** - Functions/procedures (depend on types, languages)
9. **Sequences** - Sequence objects (can be owned by tables)
10. **Types** - Custom types (enum, composite, range) - used by tables/columns
11. **Domains** - Domain types (used by tables/columns)
12. **Collations** - Collation objects (used by types/columns)
13. **Languages** - Procedural languages (used by functions)
14. **Extensions** - PostgreSQL extensions (provide types/functions)
15. **Roles** - Database roles/users (foundation for ownership)
16. **Schemas** - Schema containers (foundation for all objects)

#### CREATE/ALTER Phase Order (Forward Dependency)

When creating objects, we must create dependencies before dependents. Sub-entities are grouped with their parents:

1. **Schemas** - Schema containers (foundation for all objects)
2. **Extensions** - PostgreSQL extensions (provide types/functions early)
3. **Roles** - Database roles/users (needed for ownership and privileges)
4. **Languages** - Procedural languages (needed for functions)
5. **Collations** - Collation objects (used by types/columns)
6. **Domains** - Domain types (used by tables/columns)
7. **Types** - Custom types (enum, composite, range) - used by tables/columns
8. **Sequences** - Sequence objects (often used by tables)
9. **Procedures** - Functions/procedures (can be used by tables/triggers)
10. **Aggregates** - User-defined aggregates (depend on types/functions)
11. **Tables** - Core table objects (depend on types, sequences, etc.)
    - **Indexes** (on tables) - grouped with tables
    - **Triggers** (on tables) - grouped with tables
    - **RLS Policies** (on tables) - grouped with tables
    - **Rules** (on tables) - grouped with tables
12. **Views** - Regular views (depend on tables/other views)
    - **Rules** (on views) - grouped with views
13. **Materialized Views** - Materialized views (depend on tables/views)
    - **Indexes** (on materialized views) - grouped with materialized views
14. **Event Triggers** - System-level event triggers
15. **Publications** - Logical replication publications (depend on tables/objects)
16. **Subscriptions** - Logical replication subscriptions (depend on publications)

### Metadata Operation Ordering

Within each object type, metadata operations follow a specific order:

#### For CREATE/ALTER Phase:

1. **Default Privileges** (`scope="default_privilege"`)
   - `ALTER DEFAULT PRIVILEGES` statements
   - Must come **before** all `CREATE` statements (enforced by custom constraint)
   - Ensures newly created objects inherit the correct default privileges

2. **Object Operations** (`scope="object"`)
   - `CREATE`, `ALTER`, and `DROP` operations that modify object structure
   - Grouped by object type according to the ordering above

3. **Comments** (`scope="comment"`)
   - `COMMENT ON` statements
   - Applied after objects are created
   - Grouped by object type

4. **Privileges** (`scope="privilege"`)
   - `GRANT` and `REVOKE` statements
   - Applied after objects are created
   - Grouped by object type

5. **Role Membership** (`scope="membership"`)
   - `GRANT ROLE` and `REVOKE ROLE` statements
   - Applied after roles are created
   - Grouped with role operations

#### For DROP Phase:

1. **Privileges** (`scope="privilege"`)
   - `REVOKE` statements (if any)
   - Applied before dropping objects

2. **Comments** (`scope="comment"`)
   - `COMMENT ON ... IS NULL` statements (if any)
   - Applied before dropping objects

3. **Object Operations** (`scope="object"`)
   - `DROP` and destructive `ALTER` operations
   - Grouped by object type according to reverse dependency order

### Implementation Notes

The logical pre-sorting function:

1. **Partitions by phase** - Separates DROP and CREATE/ALTER phases first
2. **Groups by schema** - Within each phase, groups objects by their schema first
   - For most objects: Uses the object's schema property
   - For event triggers: Uses the function's schema (`change.eventTrigger.function_schema`)
   - For default_privilege changes: Uses the `inSchema` property
   - For non-schema objects (roles, languages, publications, subscriptions): These come first (sorted before schema objects using special prefix)
3. **Groups by effective object type** - When schemas differ, orders by effective object type (parent type for sub-entities)
   - **Parent-child grouping**: Sub-entities (indexes, triggers, rls_policies, rules) use their parent's object type for grouping
   - For indexes: Determines parent from `change.requires` (looks for `table:` or `materializedView:` prefix)
   - For triggers, rls_policies, rules: Determines parent from `change.requires` (looks for `table:`, `view:`, or `materializedView:` prefix)
   - **Event triggers**: Grouped by their function's schema (event triggers don't have their own schema but always reference a function)
   - Within the same schema, this comparison is skipped (all objects in same schema grouped together)
4. **Groups by main stable ID** - Within each schema/object type group, further groups by the main stable ID being touched:
   - **For CREATE operations**: Use the primary stable ID from `creates` (e.g., `table:public.users` for CreateTable)
   - **For DROP operations**: Use the stable ID from `drops` (e.g., `table:public.users` for DropTable)
   - **For ALTER operations**: Use the stable ID being altered (from `creates` if creating, or `requires` if modifying)
   - **For metadata operations** (comment, privilege): Use the stable ID from `requires` (the object being commented/granted)
   - **For sub-entities**: Group by their **parent's stable ID** instead of their own:
     - Index on `table:public.users` → group by `table:public.users` (not `index:public.users.email_idx`)
     - Trigger on `table:public.users` → group by `table:public.users` (not `trigger:public.users.updated`)
     - RLS Policy on `table:public.users` → group by `table:public.users` (not `rlsPolicy:public.users.policy_name`)
     - Rule on `table:public.users` → group by `table:public.users` (not `rule:public.users.rule_name`)
5. **Orders by actual object type** - Within each stable ID group, orders sub-entities by their actual object type (index, trigger, rls_policy, rule)
6. **Orders by scope** - Within each stable ID/object type group, orders by scope:
   - CREATE/ALTER: `default_privilege` → `object` → `comment` → `privilege` → `membership`
   - DROP: `privilege` → `comment` → `object`
   - Special cases: Comments come after CREATE object but before ALTER object; table comments before column comments
7. **Orders by operation** - Within same stable ID, scope, and object type: `create` → `alter` → `drop`
8. **Preserves relative order** - Within each group, preserves the original order (stability)
9. **Passes to dependency resolver** - After logical pre-sorting, passes the array to `sortChanges()` for dependency resolution

**Schema Extraction Details:**

- **Extracting schema for grouping**:
  - For most objects: Use `getSchema(change)` which accesses the object's schema property
  - For event triggers: Use `change.eventTrigger.function_schema` (event triggers are grouped by their function's schema to ensure they appear after the functions they reference)
  - For default_privilege changes: Use `change.inSchema` property
  - For non-schema objects (roles, languages, publications, subscriptions): These are sorted first (before schema objects)

**Stable ID Grouping Details:**

- **Extracting the main stable ID**:
  - For CREATE: Iterate through `change.creates` to find the first non-metadata stable ID (skips `comment:...`, `acl:...`, etc.)
  - For DROP: Iterate through `change.drops` to find the first non-metadata stable ID
  - For ALTER: Iterate through `change.creates` first (if creating), then `change.drops` (if dropping), then `change.requires` (the object being modified)
  - For metadata (comments/privileges): For CREATE operations, iterate through `change.requires` to find the object stable ID (skips comment/privilege stable IDs). For DROP/ALTER operations, also iterate through `change.requires` to find the object stable ID. This ensures comments/privileges group with their target objects
  
- **Parent stable ID resolution** (for sub-entities):
  - For indexes: Extract table stable ID from `change.requires` (look for `table:` or `materializedView:` prefix)
  - For triggers: Extract table stable ID from `change.requires` (look for `table:` prefix)
  - For RLS policies: Extract table stable ID from `change.requires` (look for `table:` prefix)
  - For rules: Extract relation stable ID from `change.requires` (look for `table:`, `view:`, or `materializedView:` prefix)
  - For event triggers: Group by their function's schema (ensures they appear after procedures in the same schema)

- **Grouping hierarchy** (comparator order):
  ```
  Phase (DROP vs CREATE/ALTER)
    └─ Schema (public, auth, extensions, etc., or null for non-schema objects)
        └─ Effective Object Type (parent type for sub-entities, only when schemas differ)
            └─ Main Stable ID (table:public.users, table:public.posts, etc.)
                └─ Actual Object Type (index, trigger, rls_policy, rule for sub-entities)
                    └─ Scope (object, comment, privilege, with special cases)
                        └─ Operation (create, alter, drop)
                            └─ Original order (stability)
  ```
  
  **Special cases:**
  - Non-schema objects (roles, languages, publications, subscriptions) are sorted first (before schema objects)
  - Event triggers are grouped by their function's schema (e.g., event triggers referencing `extensions.*` functions are grouped in the `extensions` schema)
  - Default privileges are grouped by their `inSchema` property

- The dependency resolver will still ensure correct execution order (e.g., tables must exist before their indexes), but the logical grouping keeps all changes for a specific object together, making migration scripts much more readable.

### Example

**Input (unsorted):**
```typescript
[
  CreateTable(posts),                    // object
  CreateIndex(posts_id_idx, posts),      // object (index on posts table)
  AlterDefaultPrivileges(...),           // default_privilege
  CreateRole(admin),                     // object
  CreateTrigger(posts_updated, posts),   // object (trigger on posts table)
  CommentOnTable(posts, "Posts table"),  // comment
  GrantTablePrivileges(posts, admin),    // privilege
  CreateSchema(public),                  // object
  CreateTable(users),                    // object
  CreateIndex(users_email_idx, users),  // object (index on users table)
  CommentOnTable(users, "Users table"),  // comment
  GrantTablePrivileges(users, admin),    // privilege
]
```

**After Logical Pre-Sorting:**
```typescript
[
  // Non-schema objects first (roles, languages, publications, subscriptions)
  CreateRole(admin),                     // object (stableId: role:admin, schema: null)
  
  // Schema: public - all objects in this schema grouped together
  CreateSchema(public),                  // object (stableId: schema:public)
  
  // Default privileges in schema:public (grouped by inSchema property)
  AlterDefaultPrivileges(...),           // default_privilege (inSchema: public)
  
  // Tables in schema:public - grouped by stable ID
  // All changes for table:public.users grouped together
  CreateTable(users),                    // object (creates: table:public.users, schema: public)
  CreateIndex(users_email_idx, users),    // object (parent: table:public.users, schema: public)
  CommentOnTable(users, "Users table"),  // comment (requires: table:public.users, schema: public)
  GrantTablePrivileges(users, admin),    // privilege (requires: table:public.users, schema: public)
  
  // All changes for table:public.posts grouped together
  CreateTable(posts),                    // object (creates: table:public.posts, schema: public)
  CreateIndex(posts_id_idx, posts),      // object (parent: table:public.posts, schema: public)
  CreateTrigger(posts_updated, posts),   // object (parent: table:public.posts, schema: public)
  CommentOnTable(posts, "Posts table"),  // comment (requires: table:public.posts, schema: public)
  GrantTablePrivileges(posts, admin),    // privilege (requires: table:public.posts, schema: public)
]
```

**After Dependency Resolution:**
```typescript
[
  // Non-schema objects first
  CreateRole(admin),                     // No dependencies (non-schema object)
  
  // Schema: public - all objects grouped together
  CreateSchema(public),                  // No dependencies
  AlterDefaultPrivileges(...),           // Custom constraint: before CREATE (grouped by schema:public)
  
  // Tables in schema:public - grouped by stable ID
  // All changes for table:public.users grouped together
  CreateTable(users),                    // Depends on schema, role (grouped by schema:public, stableId: table:public.users)
  CreateIndex(users_email_idx, users),   // Depends on table (grouped by schema:public, stableId: table:public.users)
  CommentOnTable(users, "Users table"),  // Depends on table (grouped by schema:public, stableId: table:public.users)
  GrantTablePrivileges(users, admin),    // Depends on table, role (grouped by schema:public, stableId: table:public.users)
  
  // All changes for table:public.posts grouped together
  CreateTable(posts),                    // Depends on schema, role, users (if FK) (grouped by schema:public, stableId: table:public.posts)
  CreateIndex(posts_id_idx, posts),      // Depends on table (grouped by schema:public, stableId: table:public.posts)
  CreateTrigger(posts_updated, posts),   // Depends on table, function (grouped by schema:public, stableId: table:public.posts)
  CommentOnTable(posts, "Posts table"),  // Depends on table (grouped by schema:public, stableId: table:public.posts)
  GrantTablePrivileges(posts, admin),    // Depends on table, role (grouped by schema:public, stableId: table:public.posts)
]
```

**Key Benefits:**

1. **All changes for `table:public.users` are grouped together**: CREATE TABLE, CREATE INDEX, COMMENT, and GRANT statements are all in one logical block
2. **All changes for `table:public.posts` are grouped together**: Similarly, all related changes are co-located
3. **Sub-entities grouped by parent**: Indexes and triggers are grouped with their parent table's stable ID, not their own
4. **Scope ordering preserved**: Within each stable ID group, operations are ordered by scope (object → comment → privilege)
5. **Dependency resolution maintained**: The dependency resolver ensures correct execution order (e.g., `users` table created before `posts` if there's a foreign key), but the logical grouping structure is preserved

This makes migration scripts much more readable - developers can see all changes related to a specific database object in one place, making it easier to understand what's happening to each table, view, or other object.

## Summary

The sorting algorithm operates in **two passes**:

### Pass 1: Logical Pre-Sorting
1. **Partitions** changes into DROP and CREATE/ALTER phases
2. **Groups** changes by schema, effective object type, stable ID, actual object type, scope, and operation
3. **Preserves** relative order within groups (stability)

### Pass 2: Dependency-Based Topological Sorting
1. **Partitions** logically sorted changes into DROP and CREATE/ALTER phases using `getExecutionPhase()`
2. **Builds** graph data structures (change sets and reverse indexes)
3. **Converts** all dependency sources to Constraints:
   - PostgreSQL's `pg_depend` catalog → Constraints (only basic validation for unknown IDs)
   - Explicit `requires` declarations → Constraints (no filtering during conversion)
   - Custom constraints → Constraints
4. **Converts** Constraints to graph edges (inverting in DROP phase)
5. **Iteratively detects and breaks cycles**:
   - Deduplicates edges before each cycle check
   - Detects cycles in the graph
   - Tracks seen cycles to detect when filtering fails
   - Filters only edges involved in cycles (applies cycle-breaking filters)
   - Continues until no cycles remain or a cycle can't be broken
6. **Performs stable topological sort** (edges already deduplicated)
7. **Maps** indices back to changes

**Key Design Principles:**

- **No premature filtering**: Cycle-breaking filters are applied only when cycles are detected, not during constraint conversion
- **Targeted filtering**: Only edges involved in detected cycles are filtered, preserving the rest of the graph
- **Cycle tracking**: Tracks seen cycles to detect when filtering fails to break a cycle, preventing infinite loops
- **Iterative resolution**: Handles multiple cycles by breaking them one at a time until all are resolved
- **Edge deduplication**: Edges are deduplicated inside the cycle detection loop (before each cycle check), ensuring we work with unique edges throughout

This constraint-based approach unifies all dependency sources into a single abstraction, making the algorithm easier to understand and maintain while ensuring migrations execute in the correct order.

