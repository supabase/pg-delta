# Change Sorting Algorithm

This document explains how the `sortChanges` function orders an array of `Change` objects to produce a valid migration script that respects PostgreSQL's dependency system.

## Table of Contents

1. [Overview](#overview)
2. [High-Level Architecture](#high-level-architecture)
3. [Examples](#examples)
4. [Pass 1: Logical Pre-Sorting](#pass-1-logical-pre-sorting)
5. [Pass 2: Dependency-Based Topological Sorting](#pass-2-dependency-based-topological-sorting)
   - [Phase Partitioning](#phase-partitioning)
   - [Dependency Graph Construction](#dependency-graph-construction)
   - [Constraint Sources](#constraint-sources)
   - [Topological Sorting](#topological-sorting)
6. [Key Concepts](#key-concepts)
7. [Complete Algorithm Flow](#complete-algorithm-flow)
8. [Logical Organization](#logical-organization)

## Overview

The sorting algorithm uses a **two-pass approach** to order schema changes:

1. **Logical Pre-Sorting** - Groups related changes together by schema, object type, stable ID, and scope to create readable, logically organized migration scripts.
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
                  ▼
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

## Examples

To make the algorithm concrete, here are three common scenarios showing how inputs are transformed into sorted outputs.

### Example 1: Simple Table Dependency

**Input:**
```typescript
[
  CreateTable(posts),      // creates: ["table:public.posts"], requires: ["role:admin"]
  CreateRole(admin),       // creates: ["role:admin"]
  CreateTable(users)        // creates: ["table:public.users"], no requirements
]
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
*Dependency: posts depends on users*

**Result:**
```typescript
[
  DropTable(posts),   // First (drop dependent before dependency)
  DropTable(users)    // Second
]
```

### Example 3: Custom Constraint (Default Privileges)

**Input:**
```typescript
[
  CreateTable(posts),
  AlterDefaultPrivileges(...),
  CreateRole(admin)
]
```

**Result:**
```typescript
[
  AlterDefaultPrivileges(...),  // First (Custom Constraint: before CREATEs)
  CreateRole(admin),            // Second (no dependencies, stable order)
  CreateTable(posts)            // Third (after default privileges)
]
```

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

Changes are partitioned using `getExecutionPhase()` (shared logic in `src/sort/utils.ts`) which inspects change properties:

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

PostgreSQL's `pg_depend` catalog tracks object dependencies. These are converted to Constraints.

**Filtering:**
Basic validation happens inside `convertCatalogDependenciesToConstraints()`:
- Unknown stable IDs (with "unknown:" prefix) are filtered out

Cycle-breaking filters are **not** applied during constraint conversion. They are applied later when cycles are detected (see [Cycle Detection and Breaking](#cycle-detection-and-breaking)).

### 2. Explicit Requirements

Changes declare requirements via the `requires` getter. These are converted to Constraints.

**Filtering:**
Cycle-breaking filters are **not** applied during constraint conversion. They are applied later when cycles are detected.

### 3. Custom Constraints

Domain-specific ordering rules that supplement the dependency graph. Custom constraints are implemented as **Generator Functions** that produce a list of constraints for the entire change set at once. This approach allows for high-performance optimizations (e.g., O(N) lookups) instead of expensive pairwise comparisons (O(N²)).

```typescript
// Custom constraint generator type
type ConstraintGenerator = (changes: Change[]) => Constraint[];

// Example: ALTER DEFAULT PRIVILEGES must come before CREATE statements
function generateDefaultPrivilegeConstraints(changes: Change[]): Constraint[] {
  const constraints: Constraint[] = [];
  
  // 1. Efficiently index relevant changes (O(N))
  const createChangesBySchema = new Map<string, number[]>();
  // ... populate index ...

  // 2. Iterate default privilege changes and lookup matches (O(N))
  for (const change of changes) {
    if (isDefaultPrivilege(change)) {
        // Look up matching create changes from the index
        // Add constraints
    }
  }
  
  return constraints;
}
```

**Key Properties:**
- Custom constraints are **never filtered** during cycle breaking (they represent hard ordering requirements)
- They operate on change instances, not stable IDs
- They are optimized for large migrations using efficient indexing strategies

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

This is handled by the `invert` option in `convertConstraintsToEdges()`.

### Topological Sorting

Once the graph is built, we perform a **stable topological sort** using Kahn's Algorithm.

### Cycle Detection and Breaking

The algorithm iteratively detects and breaks cycles:

1. **Detect cycles** - Find any cycle in the graph
2. **Track seen cycles** - Normalize and track cycles we've encountered
3. **Filter cycle edges** - Apply cycle-breaking filters only to edges involved in the detected cycle
4. **Repeat** - Continue until no cycles remain

**Termination Conditions:**

- **Success**: No cycles found → proceed to topological sort
- **Failure**: Encounter a cycle we've seen before → filtering didn't break it, throw error

**Cycle-Breaking Filter Application:**

When a cycle is detected:
1. Identify edges that form the cycle
2. For each cycle edge:
   - If it's a custom constraint → never filtered
   - If it has a stable ID dependency → apply cycle-breaking filters
   - If filtering criteria match → remove the edge to break the cycle

## Key Concepts

### Multiple Created IDs

Some changes create multiple stable IDs (e.g., `CreateTable` creates the table + all columns). When converting explicit requirements to Constraints, if a change creates IDs, Constraints are created from each created ID to each required ID.

### Unknown Dependencies

Dependencies with `"unknown:"` prefix are filtered out as they cannot be reliably used for ordering.

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
                  ▼
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
         │ - Explicit requires   │
         │ - Custom constraints  │
         └──────────┬────────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │ Step 3: Convert       │
         │        Constraints   │
         │        to Edges      │
         │        & Deduplicate │
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
         │ Step 5: performStable│
         │        TopoSort      │
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
    # Partition into phases using shared utility
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
    )
    
    explicit_constraints = convertExplicitRequirementsToConstraints(
        changes, graph_data
    )
    
    # Batch generate custom constraints (O(N) complexity)
    custom_constraints = generateCustomConstraints(changes)
    
    all_constraints = catalog_constraints + explicit_constraints + custom_constraints
    
    # Step 3: Convert Constraints to edges and deduplicate
    edges = dedupeEdges(convertConstraintsToEdges(all_constraints, invert))
    
    # Step 4: Iteratively detect and break cycles
    seen_cycles = Set()
    
    while True:
        # Edges are already deduplicated
        edge_pairs = edgesToPairs(edges)
        
        # Detect cycles
        cycle_node_indexes = findCycle(changes.length, edge_pairs)
        
        if not cycle_node_indexes:
            # No cycles found, we're done
            break
        
        # Normalize cycle to check if we've seen it before
        cycle_signature = normalizeCycle(cycle_node_indexes)
        if cycle_signature in seen_cycles:
            # We've seen this cycle before - filtering didn't break it
            throw CycleError(cycle_node_indexes, changes, cycle_edges)
        
        # Track this cycle
        seen_cycles.add(cycle_signature)
        
        # Filter only edges involved in the cycle to break it
        edges = filterEdgesForCycleBreaking(
            edges,
            cycle_node_indexes,
            changes,
            graph_data
        )
    
    # Step 5: Sort (edges already deduplicated, no cycles remain)
    edge_pairs = edgesToPairs(edges)
    sorted_indices = performStableTopologicalSort(changes.length, edge_pairs)
    
    # Step 6: Map indices to changes
    return [changes[i] for i in sorted_indices]
```

## Logical Organization

The logical pre-sorting step groups related changes together using shared utilities (`src/sort/utils.ts`) to ensure consistency with the dependency sorter. It partitions changes by phase, then groups by schema, object type, and stable ID.

### Implementation Notes

1. **Shared Logic**: Critical logic for determining phases (`getExecutionPhase`) and identifying metadata (`isMetadataStableId`) is centralized in `src/sort/utils.ts` to ensure `logicalSort` and `sortChanges` behave identically.
2. **Phase Partitioning**: Separates DROP and CREATE/ALTER phases first.
3. **Schema Grouping**: Groups objects by their schema.
4. **Stable ID Grouping**: Groups sub-entities (indexes, triggers) with their parent objects.
5. **Optimized Grouping**: Uses compiled regexes and shared utilities for performance.

This logical grouping happens **before** dependency resolution, making the resulting migration script readable for humans while the subsequent topological sort guarantees correctness for the database.
