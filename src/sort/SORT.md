# Change Sorting Algorithm

This document explains how the `sortChanges` function orders an array of `Change` objects to produce a valid migration script that respects PostgreSQL's dependency system.

## Table of Contents

1. [Overview](#overview)
2. [High-Level Architecture](#high-level-architecture)
3. [Phase Partitioning](#phase-partitioning)
4. [Dependency Graph Construction](#dependency-graph-construction)
5. [Edge Sources](#edge-sources)
6. [Topological Sorting](#topological-sorting)
7. [Key Concepts](#key-concepts)
8. [Examples](#examples)
9. [Algorithm Flow](#algorithm-flow)

## Overview

The sorting algorithm ensures that schema changes are executed in the correct order by:

1. **Respecting PostgreSQL's dependency system** - Uses `pg_depend` catalog data to understand object dependencies
2. **Handling explicit requirements** - Changes declare what they require via the `requires` getter
3. **Applying custom constraints** - Domain-specific ordering rules (e.g., ALTER DEFAULT PRIVILEGES before CREATE)
4. **Maintaining stability** - Preserves input order when dependencies don't dictate a stricter ordering

## High-Level Architecture

The algorithm operates in **two phases** that mirror how PostgreSQL applies DDL:

```
┌─────────────────────────────────────────────────────────────┐
│                    Input: Changes Array                      │
│  [Change1, Change2, Change3, Change4, Change5, ...]         │
└────────────────────┬────────────────────────────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │   Phase Partitioning    │
         └────────┬─────────────────┘
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼                   ▼
┌──────────────┐    ┌──────────────────────┐
│  DROP Phase  │    │ CREATE/ALTER Phase   │
│  (inverted)  │    │   (forward)          │
└──────┬───────┘    └──────────┬───────────┘
       │                       │
       │  ┌─────────────────┐ │
       └─▶│ Graph Building   │◀┘
          │ & Topological    │
          │    Sort          │
          └────────┬──────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │  Sorted Changes Array │
        │  [Drop1, Drop2, ...   │
        │   Create1, Create2...] │
        └───────────────────────┘
```

### Why Two Phases?

- **DROP Phase**: Destructive operations must run in **reverse dependency order**. If table A depends on table B, we must drop A before B.
- **CREATE/ALTER Phase**: Constructive operations run in **forward dependency order**. If table A depends on table B, we must create B before A.

## Phase Partitioning

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

## Dependency Graph Construction

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

Note: `dependenciesByReferencedId` is only built for debug visualization, not part of the main `GraphData` structure.

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

```typescript
interface Constraint {
  sourceChangeIndex: number;  // Change that must come first
  targetChangeIndex: number;  // Change that must come after
  source: "catalog" | "explicit" | "custom";
  reason?: {
    dependentStableId: string;
    referencedStableId: string;
  };
}
```

## Constraint Sources

The dependency graph is built from **three sources**, all converted to Constraints:

### 1. Catalog Dependencies (pg_depend)

PostgreSQL's `pg_depend` catalog tracks object dependencies. These are converted to Constraints:

```
pg_depend row: {
  dependent_stable_id: "table:public.posts",
  referenced_stable_id: "table:public.users"
}

Algorithm:
  1. Filter catalog dependencies (unknown IDs, cycle-breaking filters)
  2. Find changes that create "table:public.users" → [Change A]
  3. Find changes that create/require "table:public.posts" → [Change B]
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

Domain-specific ordering rules that supplement the dependency graph:

```typescript
// Example: ALTER DEFAULT PRIVILEGES must come before CREATE statements
const customConstraintGenerators: CustomConstraintGenerator[] = [
  (changes: Change[], changeIndexByChange: Map<Change, number>) => {
    const constraints: Constraint[] = [];
    for (let i = 0; i < changes.length; i++) {
      for (let j = 0; j < changes.length; j++) {
        if (i === j) continue;
        const a = changes[i];
        const b = changes[j];
        if (a is ALTER DEFAULT PRIVILEGES && b is CREATE && !b is CREATE ROLE/SCHEMA) {
          constraints.push({
            sourceChangeIndex: changeIndexByChange.get(a)!,
            targetChangeIndex: changeIndexByChange.get(b)!,
            source: "custom",
          });
        }
      }
    }
    return constraints;
  }
];
```

These are converted to Constraints via `generateCustomConstraints()`.

**Visualization:**

```
Changes:
  [0] AlterDefaultPrivileges(...)
  [1] CreateTable(posts)

Constraint:
  { sourceChangeIndex: 0, targetChangeIndex: 1, source: "custom" }
```

### Edge Inversion for DROP Phase

In the DROP phase, edges are **inverted** when converting Constraints to edges:

```
CREATE Phase (forward):
  Constraint: { sourceChangeIndex: 0, targetChangeIndex: 1 }
  Edge: [0, 1]  (users must exist before posts)

DROP Phase (inverted):
  Constraint: { sourceChangeIndex: 0, targetChangeIndex: 1 }
  Edge: [1, 0]  (posts must be dropped before users)
```

This is handled by the `invert` option in `registerEdge`:

```typescript
const registerEdge = (sourceIndex: number, targetIndex: number) => {
  graphEdges.push(
    options.invert 
      ? [targetIndex, sourceIndex]  // DROP phase: invert
      : [sourceIndex, targetIndex]   // CREATE phase: forward
  );
};
```

## Topological Sorting

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

If a cycle is encountered that we've seen before, it means our filtering didn't break it:

```
Cycle detected: A → B → C → A
Error: This cycle was detected before but filtering didn't break it.
Error message includes:
  - Which changes are in the cycle
  - Their class names and created IDs
  - Helpful debugging information
```

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

**Custom Constraint Generator:**
```typescript
const customConstraintGenerators: CustomConstraintGenerator[] = [
  (changes: Change[], changeIndexByChange: Map<Change, number>) => {
    const constraints: Constraint[] = [];
    for (let i = 0; i < changes.length; i++) {
      for (let j = 0; j < changes.length; j++) {
        if (i === j) continue;
        const a = changes[i];
        const b = changes[j];
        if (a is AlterDefaultPrivileges && b is Create && !b is CreateRole) {
          constraints.push({
            sourceChangeIndex: changeIndexByChange.get(a)!,
            targetChangeIndex: changeIndexByChange.get(b)!,
            source: "custom",
          });
        }
      }
    }
    return constraints;
  }
];
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

## Algorithm Flow

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ sortChanges(changes, catalogs)                              │
└────────────────────┬────────────────────────────────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │ Partition into Phases   │
         │ - DROP (getExecutionPhase)│
         │ - CREATE/ALTER (else)   │
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
         │ - Detect cycles      │
         │ - Track seen cycles  │
         │ - Filter cycle edges │
         │ - Repeat until done  │
         └──────────┬────────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │ Step 5: dedupeEdges   │
         │ performStableTopoSort │
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
    # 1. Partition using getExecutionPhase()
    drop_changes = [c for c in changes if getExecutionPhase(c) == "drop"]
    create_changes = [c for c in changes if getExecutionPhase(c) == "create_alter_object"]
    
    # 2. Sort each phase
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
    
    # 3. Combine
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
        # Deduplicate edges
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
            throw CycleError(cycle_node_indexes, changes)
        
        # Track this cycle
        seen_cycles.add(cycle_signature)
        
        # Filter only edges involved in the cycle to break it
        edges = filterEdgesForCycleBreaking(
            unique_edges,
            cycle_node_indexes,
            changes,
            graph_data
        )
    
    # Step 5: Deduplicate and sort (no cycles remain)
    edge_pairs = edgesToPairs(edges)
    sorted_indices = performStableTopologicalSort(changes.length, edge_pairs)
    
    # Step 6: Validate and map
    if sorted_indices.length != changes.length:
        throw CycleError  # Should never happen
    
    # Map indices to changes
    return [changes[i] for i in sorted_indices]
```

## Summary

The sorting algorithm:

1. **Partitions** changes into DROP and CREATE/ALTER phases using `getExecutionPhase()`
2. **Builds** graph data structures (change sets and reverse indexes)
3. **Converts** all dependency sources to Constraints:
   - PostgreSQL's `pg_depend` catalog → Constraints (only basic validation for unknown IDs)
   - Explicit `requires` declarations → Constraints (no filtering during conversion)
   - Custom constraints → Constraints
4. **Converts** Constraints to graph edges (inverting in DROP phase)
5. **Iteratively detects and breaks cycles**:
   - Detects cycles in the graph
   - Tracks seen cycles to detect when filtering fails
   - Filters only edges involved in cycles (applies cycle-breaking filters)
   - Continues until no cycles remain or a cycle can't be broken
6. **Deduplicates** edges and performs stable topological sort
7. **Maps** indices back to changes

**Key Design Principles:**

- **No premature filtering**: Cycle-breaking filters are applied only when cycles are detected, not during constraint conversion
- **Targeted filtering**: Only edges involved in detected cycles are filtered, preserving the rest of the graph
- **Cycle tracking**: Tracks seen cycles to detect when filtering fails to break a cycle, preventing infinite loops
- **Iterative resolution**: Handles multiple cycles by breaking them one at a time until all are resolved

This constraint-based approach unifies all dependency sources into a single abstraction, making the algorithm easier to understand and maintain while ensuring migrations execute in the correct order.

