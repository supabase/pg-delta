# PostgreSQL Schema Dependencies

This document explains how dependencies are handled in the PostgreSQL schema inspection system, specifically in the `pgkit` package's `schemainspect` module.

## Overview

The dependency system tracks relationships between database objects to ensure proper ordering during schema operations (creation, modification, deletion). It uses a directed graph representation where nodes are database objects and edges represent dependencies.

## Core Concepts

### Dependency Types

1. **Direct Dependencies** (`dependent_on`): Objects that this object depends on
2. **Reverse Dependencies** (`dependents`): Objects that depend on this object
3. **Transitive Dependencies** (`dependent_on_all`, `dependents_all`): All dependencies reachable through the dependency graph

### Database Objects with Dependencies

The following object types participate in the dependency system:

- **Selectables**: Tables, views, materialized views, composite types, functions
- **Enums**: Enum types
- **Triggers**: Database triggers
- **Constraints**: Foreign key constraints (optional)

## Explicit Dependency Table

| Object Kind         | dependents (can be depended on by)                                   | dependent_on (can depend on)                                  |
|---------------------|---------------------------------------------------------------------|---------------------------------------------------------------|
| **collation**       | domain, table, materializedView, view, type, compositeType, function | schema, extension                                             |
| **compositeType**   | table, materializedView, view, function, compositeType, domain, type | schema, extension, type, enum, domain, compositeType          |
| **constraint**      | table, domain, materializedView, view                               | schema, extension, table, domain, type, enum, compositeType   |
| **domain**          | table, materializedView, view, function, domain, type, constraint   | schema, extension, type, enum, domain, compositeType, collation|
| **enum**            | table, materializedView, view, function, domain, type, constraint   | schema, extension                                             |
| **extension**       | all (any object provided by extension)                              | schema (rarely), extension                                    |
| **function**        | view, materializedView, function, trigger, table                    | schema, extension, table, view, materializedView, type, domain, enum, compositeType |
| **index**           | (rare: partitioned index)                                           | schema, extension, table                                      |
| **materializedView**| view, materializedView, function                                    | schema, extension, table, view, materializedView, function, type, domain, enum, compositeType |
| **privilege**       | (none, metadata)                                                    | schema, extension, table, view, materializedView, sequence    |
| **rlsPolicy**       | (none, metadata)                                                    | schema, extension, table                                      |
| **schema**          | all (all objects in schema)                                         | extension (if schema is created by extension)                 |
| **sequence**        | table, materializedView, view, function                             | schema, extension                                             |
| **table**           | view, materializedView, function, index, trigger, constraint, rlsPolicy, privilege | schema, extension, type, domain, enum, compositeType, sequence, table (inheritance), collation |
| **trigger**         | (none, metadata)                                                    | schema, extension, table, function                            |
| **type**            | table, materializedView, view, function, domain, type, compositeType, constraint | schema, extension, type, enum, domain, compositeType, collation|
| **view**            | view, materializedView, function                                    | schema, extension, table, view, materializedView, function, type, domain, enum, compositeType |

**Legend/Notes:**
- **all** = all object types in your InspectionMap
- **metadata** = these objects are referenced for permissions/policies, not as data dependencies
- Some objects (like privilege, rlsPolicy, trigger, index) are mostly metadata and rarely have dependents
- **compositeType, type, domain, enum**: can be nested or used in each other

## Dependency Discovery

### 1. SQL Query-Based Discovery (`DEPS_QUERY`)

The primary dependency discovery mechanism uses PostgreSQL's system catalogs:

```sql
-- Core dependency query (simplified)
WITH things AS (
  -- Collect all relevant objects (functions, relations)
  SELECT oid, schema, name, identity_arguments, kind
  FROM pg_proc, pg_class, pg_namespace
  WHERE kind IN ('r', 'v', 'm', 'c', 'f')
),
combined AS (
  -- Find dependencies through pg_depend and pg_rewrite
  SELECT t.*, things_dependent_on.*
  FROM pg_depend d
  INNER JOIN things things_dependent_on ON d.refobjid = things_dependent_on.objid
  INNER JOIN pg_rewrite rw ON d.objid = rw.oid
  INNER JOIN things t ON rw.ev_class = t.objid
  WHERE d.deptype = 'n' AND rw.rulename = '_RETURN'
)
```

This query discovers dependencies by:
- Examining `pg_depend` system catalog for object dependencies
- Using `pg_rewrite` to connect dependencies to specific database objects
- Filtering for normal dependencies (`deptype = 'n'`)
- Focusing on `_RETURN` rules which represent object definitions

### 2. Schema-Based Discovery

Additional dependencies are discovered through schema analysis:

#### Enum Dependencies
```typescript
// When a column uses an enum type
if (c.is_enum) {
  const e_sig = c.enum.signature
  if (e_sig in this.enums) {
    r.dependent_on.push(e_sig)
    c.enum.dependents.push(k)
  }
}
```

#### Inheritance Dependencies
```typescript
// When a table inherits from another table
if (r.parent_table) {
  const pt = this.relations[r.parent_table]
  r.dependent_on.push(r.parent_table)
  pt.dependents.push(r.signature)
}
```

#### Trigger Dependencies
```typescript
// Triggers depend on their target tables
for (const [k, t] of Object.entries(this.triggers)) {
  for (const dep_name of t.dependent_on) {
    const dependency = this.selectables[dep_name]
    dependency?.dependents.push(k)
  }
}
```

## Dependency Loading Process

### Phase 1: `load_deps()`

1. **Execute DEPS_QUERY** to get raw dependency data
2. **Process each dependency**:
   - Create signatures for both dependent and dependency objects
   - Add direct dependencies to `dependent_on` arrays
   - Add reverse dependencies to `dependents` arrays
   - Sort arrays for consistency
3. **Handle special cases**:
   - Enum column dependencies
   - Table inheritance dependencies
   - Trigger dependencies

### Phase 2: `load_deps_all()`

1. **Calculate transitive dependencies** using recursive traversal
2. **Build `dependent_on_all`** and `dependents_all` arrays
3. **Sort results** for consistent ordering

```typescript
const get_related_for_item = (
  item: InspectedSelectable | InspectedTrigger | InspectedEnum,
  att: 'dependent_on' | 'dependents',
): string[] => {
  const related = item[att].map((child: string) => 
    this.get_dependency_by_signature(child)
  )
  return [item.signature, ...related.flatMap(d => 
    get_related_for_item(d, att)
  )]
}
```

## Topological Sorting

### Purpose
Topological sorting provides a safe ordering for operations that respect dependencies:
- **Creation order**: Dependencies before dependents
- **Deletion order**: Dependents before dependencies

### Implementation

The `dependency_order()` method uses a `TopologicalSorter` class:

```typescript
dependency_order({
  drop_order = false,
  selectables = true,
  triggers = true,
  enums = true,
  include_fk_deps = false,
} = {}): string[]
```

#### TopologicalSorter Algorithm

1. **Graph Construction**: Build adjacency list from dependency relationships
2. **Cycle Detection**: Detect circular dependencies using DFS
3. **Topological Sort**: Use Kahn's algorithm:
   - Find nodes with no incoming edges (ready nodes)
   - Remove ready nodes and their outgoing edges
   - Repeat until all nodes are processed

#### States
- `_NODE_OUT = -1`: Node has been passed out (ready)
- `_NODE_DONE = -2`: Node has been processed (done)
- `>= 0`: Number of unprocessed predecessors

## Signature Generation

Dependencies are identified using object signatures:

```typescript
const parenthesize = (expr: string) => (expr ? `(${expr})` : '')
const x = `${quoted_identifier(dep.name, dep.schema)}${parenthesize(dep.identity_arguments)}`
```

### Signature Formats
- **Tables/Views**: `"schema"."name"`
- **Functions**: `"schema"."name"(arg1, arg2)`
- **Enums**: `"schema"."name"`

## Dependency Categories

### 1. Object Dependencies
- Views depend on their underlying tables/functions
- Materialized views depend on their query sources
- Functions depend on types, operators, and other functions

### 2. Type Dependencies
- Columns using enum types depend on those enums
- Composite types depend on their component types

### 3. Structural Dependencies
- Child tables depend on parent tables (inheritance)
- Partitioned tables depend on their partition definitions

### 4. Constraint Dependencies (Optional)
- Foreign key constraints create table-to-table dependencies
- Controlled by `include_fk_deps` parameter

## Error Handling

### Circular Dependencies
The system detects circular dependencies and throws `CycleError`:

```typescript
const cycle = this._find_cycle()
if (cycle) {
  throw new CycleError('nodes are in a cycle', cycle)
}
```

### Missing Dependencies
Graceful handling of missing dependency objects:

```typescript
try {
  this.selectables[x_dependent_on].dependents.push(x)
  this.selectables[x_dependent_on].dependents.sort()
} catch {
  // pass - dependency object may not exist
}
```

## Usage Examples

### Creating Objects in Dependency Order
```typescript
const inspector = await PostgreSQL.create(connection)
const creationOrder = inspector.dependency_order({ drop_order: false })
// Use creationOrder to create objects safely
```

### Dropping Objects in Reverse Dependency Order
```typescript
const dropOrder = inspector.dependency_order({ drop_order: true })
// Use dropOrder to drop objects safely
```

### Checking Object Dependencies
```typescript
const table = inspector.tables['"public"."users"']
console.log('Dependencies:', table.dependent_on)
console.log('Dependents:', table.dependents)
console.log('All dependencies:', table.dependent_on_all)
```

## Performance Considerations

1. **Query Optimization**: DEPS_QUERY uses efficient joins and filtering
2. **Caching**: Dependencies are calculated once during inspection
3. **Memory Usage**: Transitive dependencies can be large for complex schemas
4. **Sorting**: Arrays are sorted for consistent behavior

## Limitations

1. **Extension Objects**: Dependencies on extension objects are excluded
2. **Internal Schemas**: Dependencies in system schemas are filtered out
3. **Dynamic Dependencies**: Runtime dependencies (e.g., dynamic SQL) are not captured
4. **Cross-Database**: Dependencies across different databases are not supported

## Future Enhancements

1. **Incremental Updates**: Support for updating dependencies without full re-inspection
2. **Dependency Validation**: Tools to validate dependency consistency
3. **Visualization**: Graph visualization of dependency relationships
4. **Performance Metrics**: Dependency analysis performance monitoring 


All postgres objects in a diagram looks like this:

```
---
config:
  layout: elk
---
flowchart TD
 subgraph Cluster["Cluster (Server-wide)"]
        ROLES["Role (user/group)"]
        TABLESPACES["Tablespace"]
        DATABASES["Database"]
  end
 subgraph Database["Database (per-db objects)"]
        SCHEMAS["Schema"]
        EXTENSIONS["Extension"]
        EVENTTRIG["Event Trigger"]
        FDW["Foreign Data Wrapper"]
        SERVER["Foreign Server"]
        USERMAP["User Mapping (role↔server)"]
        PUBLICATION["Publication"]
        SUBSCRIPTION["Subscription"]
        LANGUAGE["Language"]
        CAST["Cast"]
  end
 subgraph Schema["Schema (namespace)"]
        TABLE["Table"]
        VIEW["View"]
        MATVIEW["Materialized View"]
        SEQUENCE["Sequence"]
        FRTABLE["Foreign Table"]
        TYPE["Type"]
        ENUM["Enum Type"]
        DOMAIN["Domain"]
        RANGE["Range Type"]
        COMPOSITE["Composite Type"]
        FUNCTION["Function"]
        PROCEDURE["Procedure"]
        AGGREGATE["Aggregate"]
        OPERATOR["Operator"]
        OPCLASS["Operator Class"]
        OPFAMILY["Operator Family"]
        COLLATION["Collation"]
        TS_CONFIG["TS Configuration"]
        TS_DICT["TS Dictionary"]
        TS_PARSER["TS Parser"]
        TS_TEMPLATE["TS Template"]
        CONVERSION["Conversion"]
        STATS["Extended Statistics"]
  end
 subgraph Relation["Table/View/MV specific"]
        INDEX["Index"]
        CONSTRAINT["Constraint (PK/UK/CK/FK)"]
        TRIGGER["Trigger"]
        RULE["Rule"]
        POLICY["RLS Policy"]
        COLUMNATTR["Column: default/generated/identity/collation"]
  end
 subgraph DomainObj["Domain specific"]
        DOM_CONS["Domain Constraint"]
        DOM_ATTR["Domain Default/Not Null"]
  end
    Cluster --> DATABASES
    DATABASES --> Database
    Database --> SCHEMAS & EXTENSIONS & EVENTTRIG & FDW & SERVER & USERMAP & PUBLICATION & SUBSCRIPTION & LANGUAGE & CAST
    SCHEMAS --> TABLE & VIEW & MATVIEW & SEQUENCE & FRTABLE & TYPE & FUNCTION & PROCEDURE & AGGREGATE & OPERATOR & OPCLASS & OPFAMILY & COLLATION & TS_CONFIG & TS_DICT & TS_PARSER & TS_TEMPLATE & CONVERSION & STATS
    TYPE --> ENUM & DOMAIN & RANGE & COMPOSITE
    TABLE --> Relation
    VIEW --> Relation
    MATVIEW --> Relation
    DOMAIN --> DomainObj
```
![diagram](https://github.com/user-attachments/assets/21e2a9c1-2fcf-4374-980e-2b426bfcc9dc)

When creating a "Change" of any kind, you should always only add into the dependencies of the change objects that are "at the same level".
While the "inter level" ordering (a table is under schema) will be handled by global level rules.
Same thing for some general same object constraint (a create table must come before the alter table)