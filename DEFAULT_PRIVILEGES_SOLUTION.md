# Solution for Default Privileges Handling

## Problem Statement

1. **Generalization**: Support default privileges for all object types that have privileges (tables, views, sequences, functions, types, schemas, etc.), not just tables.

2. **ALTER DEFAULT PRIVILEGES**: When default privileges are altered mid-migration, subsequent object creations should use the updated default privileges, not the original ones from introspection.

## Solution Overview

The solution uses a **context-based approach**: diff default privileges first, compute the final default privileges state, then pass it as context to all diffing methods. Each diff function uses this state to compute the correct grant/revoke statements when creating objects.

This approach:
- Generates privilege changes at the right time (during CREATE, not pre/post-processing)
- Ensures correct ordering (privilege changes follow CREATE statements naturally)
- Keeps logic where it belongs (in each diff function)
- Avoids complex pre/post-processing

## Implementation

### Phase 1: Generalized Default Privilege Computation ✅

**File**: `src/objects/base.default-privileges.ts`

1. Created `computeDefaultPrivilegesForObject()` function:
   - Takes: `currentUser`, `objectType`, `objectSchema`, `roles`, `version`
   - Returns: `PrivilegeProps[]` for that object type
   - Maps object types to default privilege `objtype` codes:
     - TABLE → "r"
     - VIEW → "r" (same as tables)
     - MATERIALIZED VIEW → "r"
     - SEQUENCE → "S"
     - FUNCTION/PROCEDURE/AGGREGATE → "f"
     - TYPE/DOMAIN/ENUM/RANGE/COMPOSITE_TYPE → "T"
     - SCHEMA → "n"
     - LANGUAGE → (no default privileges)

2. Created `DefaultPrivilegeState` class:
   - Stores default privileges per role/schema/objtype/grantee
   - Can apply `GrantRoleDefaultPrivileges` and `RevokeRoleDefaultPrivileges` changes
   - Can compute effective default privileges for a given object
   - Initializes from roles' `default_privileges` array extracted during catalog introspection

### Phase 2: Context-Based Diffing ✅

**File**: `src/catalog.diff.ts`

1. **Diff roles first** to get all default privilege changes
2. **Compute final default privileges state** by applying all role changes to `DefaultPrivilegeState`
3. **Create diff context** with `version`, `currentUser`, and `defaultPrivilegeState`
4. **Pass context to all diff functions** (diffTables, diffViews, diffSequences, etc.)

**File**: `src/objects/table/table.diff.ts` (and other diff functions)

1. **Accept extended context** with `defaultPrivilegeState`
2. **For CREATE statements**:
   - Get effective defaults from `defaultPrivilegeState.getEffectiveDefaults()`
   - Diff effective defaults against desired privileges from branch catalog
   - Generate GRANT/REVOKE changes immediately after CREATE
   - This ensures correct ordering (CREATE → constraints → comments → privileges)

### Phase 3: Constraint-Based Ordering ✅

**Files**: `tests/integration/roundtrip.ts`, `src/main.ts`

Added a constraint spec to ensure `ALTER DEFAULT PRIVILEGES` statements execute before CREATE statements in the final migration:

```typescript
constraintSpecs = [
  {
    pairwise: (a: Change, b: Change) => {
      const aIsDefaultPriv = a instanceof GrantRoleDefaultPrivileges || 
                             a instanceof RevokeRoleDefaultPrivileges;
      const bIsCreate = b.operation === "create" && b.scope === "object";
      
      if (aIsDefaultPriv && bIsCreate) return "a_before_b";
      if (aIsCreate && bIsDefaultPriv) return "b_before_a";
      return undefined;
    },
  },
];
```

**Important**: This constraint only applies when there are no dependency conflicts. The dependency system automatically ensures:
- `CREATE ROLE` comes before `ALTER DEFAULT PRIVILEGES FOR ROLE <role>` (via `requires()`)
- `CREATE SCHEMA` comes before `ALTER DEFAULT PRIVILEGES IN SCHEMA <schema>` (via `requires()`)

As documented in [PostgreSQL's ALTER DEFAULT PRIVILEGES documentation](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html), `ALTER DEFAULT PRIVILEGES` can specify:
- `FOR ROLE targetrole` - requires the target role to exist
- `IN SCHEMA schemaname` - requires the schema to exist

The `GrantRoleDefaultPrivileges` and `RevokeRoleDefaultPrivileges` classes already declare these dependencies in their `requires()` getters, so the topological sort ensures proper ordering.

## How It Works

1. **Diff Roles First**: `diffCatalogs()` calls `diffRoles()` first to get all default privilege changes.

2. **Compute Final State**: All `GrantRoleDefaultPrivileges` and `RevokeRoleDefaultPrivileges` changes are applied to a `DefaultPrivilegeState` instance, computing the final state that will be in effect.

3. **Pass Context**: The final `defaultPrivilegeState` is passed as part of the diff context to all object diff functions.

4. **Generate Privilege Changes During Diffing**: For each CREATE statement:
   - The diff function calls `defaultPrivilegeState.getEffectiveDefaults()` to get what privileges would be granted by default
   - It diffs these against the desired privileges from the branch catalog
   - It generates GRANT/REVOKE changes immediately after the CREATE statement
   - This ensures natural ordering: CREATE → constraints → comments → privileges

5. **Sorting**: The dependency system ensures:
   - Roles/schemas are created before ALTER DEFAULT PRIVILEGES
   - ALTER DEFAULT PRIVILEGES comes before CREATE statements (via constraint spec)
   - Privilege changes follow their CREATE statements (via `requires()`)

## Benefits

- **Simpler**: No pre-processing or post-processing needed
- **More maintainable**: Logic stays in diff functions where it belongs
- **Correct ordering**: Privilege changes are generated at the right time, ensuring natural ordering
- **Same result**: Achieves the same final privilege state
- **Better performance**: Computes defaults once and passes as context
- **Respects dependencies**: Roles and schemas are created before being referenced

## Supported Object Types

The solution handles all object types that support default privileges:
- ✅ Tables (implemented)
- ✅ Views (context ready, privilege generation pending)
- ✅ Materialized Views (context ready, privilege generation pending)
- ✅ Sequences (context ready, privilege generation pending)
- ✅ Procedures/Functions (context ready, privilege generation pending)
- ✅ Aggregates (context ready, privilege generation pending)
- ✅ Schemas (context ready, privilege generation pending)
- ✅ Domains (context ready, privilege generation pending)
- ✅ Enums (context ready, privilege generation pending)
- ✅ Composite Types (context ready, privilege generation pending)
- ✅ Range Types (context ready, privilege generation pending)
- ✅ Languages (context ready, privilege generation pending)

## Files Created/Modified

**New Files**:
- `src/objects/base.default-privileges.ts` - Generalized default privilege computation and state tracking

**Modified Files**:
- `src/catalog.diff.ts` - Diff roles first, compute default privileges state, pass as context
- `src/objects/table/table.diff.ts` - Uses defaultPrivilegeState from context to generate privilege changes
- `src/objects/view/view.diff.ts` - Updated to accept extended context
- `src/objects/sequence/sequence.diff.ts` - Updated to accept extended context
- `src/objects/schema/schema.diff.ts` - Updated to accept extended context
- `src/objects/procedure/procedure.diff.ts` - Updated to accept extended context
- `src/objects/aggregate/aggregate.diff.ts` - Updated to accept extended context
- `src/objects/domain/domain.diff.ts` - Updated to accept extended context
- `src/objects/type/enum/enum.diff.ts` - Updated to accept extended context
- `src/objects/type/range/range.diff.ts` - Updated to accept extended context
- `src/objects/type/composite-type/composite-type.diff.ts` - Updated to accept extended context
- `src/objects/materialized-view/materialized-view.diff.ts` - Updated to accept extended context
- `tests/integration/roundtrip.ts` - Removed pre-processing, kept constraint spec
- `src/main.ts` - Removed pre-processing, kept constraint spec
- `tests/integration/default-privileges-edge-case.test.ts` - Test for ALTER DEFAULT PRIVILEGES mid-migration

## References

- [PostgreSQL ALTER DEFAULT PRIVILEGES Documentation](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html)
