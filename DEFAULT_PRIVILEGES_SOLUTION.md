# Default Privileges Handling

## The Problem

When a migration script contains `ALTER DEFAULT PRIVILEGES` statements, they affect **all objects created after them** in that script. This creates a challenge for the diff tool:

1. **Side effects**: If we have:
   ```sql
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
   CREATE TABLE public.users (...);
   ```
   The `users` table will automatically get privileges granted to `anon` because of the default privileges.

2. **Order matters**: If default privileges are changed mid-migration, objects created before and after will have different privileges:
   ```sql
   CREATE TABLE public.first (...);  -- Gets initial defaults
   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
   CREATE TABLE public.second (...); -- Gets updated defaults (no anon)
   ```

3. **What we need**: The diff tool must generate the correct `GRANT`/`REVOKE` statements for each created object, accounting for what default privileges will be in effect when that object is created.

## The Solution

We use a **context-based approach** that computes the final default privileges state upfront and uses it when generating privilege changes for created objects.

### Key Insight

Since we ensure `ALTER DEFAULT PRIVILEGES` statements run **before** all `CREATE` statements (via a constraint spec), we can:
1. Compute the **final** default privileges state by applying all `ALTER DEFAULT PRIVILEGES` changes upfront
2. Use this final state for **all** object creations
3. Compare this final state against desired privileges to generate the correct `GRANT`/`REVOKE` statements

This works because the constraint spec guarantees execution order, so all objects are created with the same final default privileges state.

## How It Works

### Step 1: Diff Roles First

In `diffCatalogs()` (`src/catalog.diff.ts`), we diff roles first to collect all `ALTER DEFAULT PRIVILEGES` changes:

```43:66:src/catalog.diff.ts
  // Step 2: Compute default privileges state from role changes
  // This represents what defaults will be in effect after all ALTER DEFAULT PRIVILEGES
  // Since ALTER DEFAULT PRIVILEGES runs before CREATE (via constraint spec),
  // all created objects will use these final defaults.
  const defaultPrivilegeState = new DefaultPrivilegeState(main.roles);
  for (const change of roleChanges) {
    if (change instanceof GrantRoleDefaultPrivileges) {
      defaultPrivilegeState.applyGrant(
        change.role.name,
        change.objtype,
        change.inSchema,
        change.grantee,
        change.privileges,
      );
    } else if (change instanceof RevokeRoleDefaultPrivileges) {
      defaultPrivilegeState.applyRevoke(
        change.role.name,
        change.objtype,
        change.inSchema,
        change.grantee,
        change.privileges,
      );
    }
  }
```

### Step 2: Compute Final State

`DefaultPrivilegeState` (`src/objects/base.default-privileges.ts`) tracks default privileges:
- Initializes from the main catalog's current default privileges
- Applies all `GrantRoleDefaultPrivileges` and `RevokeRoleDefaultPrivileges` changes
- Computes the final state that will be in effect

### Step 3: Pass Context to Object Diff Functions

The final `defaultPrivilegeState` is passed as part of the diff context to all object diff functions:

```68:73:src/catalog.diff.ts
  // Step 3: Create context with default privileges state for object diffing
  const diffContext = {
    version: main.version,
    currentUser: main.currentUser,
    defaultPrivilegeState,
  };
```

### Step 4: Generate Privilege Changes During Object Creation

When creating an object (e.g., in `diffTables()`), we:
1. Get effective defaults from the state
2. Compare against desired privileges from the branch catalog
3. Generate `GRANT`/`REVOKE` changes to reach the desired state

```266:280:src/objects/table/table.diff.ts
    // PRIVILEGES: For created objects, compare against default privileges state
    // The migration script will run ALTER DEFAULT PRIVILEGES before CREATE (via constraint spec),
    // so objects are created with the default privileges state in effect.
    // We compare default privileges against desired privileges to generate REVOKE/GRANT statements
    // needed to reach the final desired state.
    const effectiveDefaults = ctx.defaultPrivilegeState.getEffectiveDefaults(
      ctx.currentUser,
      "table",
      branchTable.schema ?? "",
    );
    const desiredPrivileges = branchTable.privileges;
    const privilegeResults = diffPrivileges(
      effectiveDefaults,
      desiredPrivileges,
    );
```

### Step 5: Ensure Correct Ordering

A constraint spec in `sortChanges()` (`src/sort/phased-graph-sort.ts`) ensures `ALTER DEFAULT PRIVILEGES` runs before `CREATE` statements:

```141:163:src/sort/phased-graph-sort.ts
  const constraintSpecs: ConstraintSpec<Change>[] = [
    {
      pairwise: (a: Change, b: Change) => {
        const aIsDefaultPriv =
          a instanceof GrantRoleDefaultPrivileges ||
          a instanceof RevokeRoleDefaultPrivileges;
        const bIsCreate = b.operation === "create" && b.scope === "object";

        // Exclude CREATE ROLE and CREATE SCHEMA from the constraint since they are
        // dependencies of ALTER DEFAULT PRIVILEGES and must come before it
        const bIsRoleOrSchema =
          bIsCreate && (b.objectType === "role" || b.objectType === "schema");

        // Default privilege changes should come before CREATE statements
        // (but not CREATE ROLE or CREATE SCHEMA, which are dependencies)
        // Note: pairwise is called for both (a,b) and (b,a), so we only need to check one direction
        if (aIsDefaultPriv && bIsCreate && !bIsRoleOrSchema) {
          return "a_before_b";
        }
        return undefined;
      },
    },
  ];
```

**Note**: The dependency system automatically ensures:
- `CREATE ROLE` comes before `ALTER DEFAULT PRIVILEGES FOR ROLE <role>` (via `requires()`)
- `CREATE SCHEMA` comes before `ALTER DEFAULT PRIVILEGES IN SCHEMA <schema>` (via `requires()`)

## Example

Consider this scenario:

**Branch database state:**
```sql
-- Initial default privileges grant ALL to anon
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;

-- Create table (gets ALL privileges from defaults)
CREATE TABLE public.users (...);

-- Change defaults to revoke anon
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- Create another table (gets no anon privileges)
CREATE TABLE public.admin (...);

-- Explicitly revoke anon from first table
REVOKE ALL ON public.users FROM anon;
```

**Generated migration:**
```sql
-- 1. All ALTER DEFAULT PRIVILEGES first (constraint spec)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- 2. Create tables (both get final defaults: no anon)
CREATE TABLE public.users (...);
CREATE TABLE public.admin (...);

-- 3. Revoke anon from users table (to match branch state)
REVOKE ALL ON public.users FROM anon;
```

**Why this works:**
- The constraint spec ensures `ALTER DEFAULT PRIVILEGES` runs first
- Both tables are created with the final default state (no anon)
- We only need to revoke from `users` to match the branch state
- The migration doesn't need to reproduce the exact sequence from the branch

## Supported Object Types

The solution handles all object types that have privilege change files (`*.privilege.ts`) and support default privileges in PostgreSQL:

- ✅ **Tables** (`src/objects/table/changes/table.privilege.ts`) - Fully implemented
- ✅ **Views** (`src/objects/view/changes/view.privilege.ts`) - Context ready
- ✅ **Materialized Views** (`src/objects/materialized-view/changes/materialized-view.privilege.ts`) - Context ready
- ✅ **Sequences** (`src/objects/sequence/changes/sequence.privilege.ts`) - Context ready
- ✅ **Procedures/Functions** (`src/objects/procedure/changes/procedure.privilege.ts`) - Context ready
- ✅ **Aggregates** (`src/objects/aggregate/changes/aggregate.privilege.ts`) - Context ready
- ✅ **Schemas** (`src/objects/schema/changes/schema.privilege.ts`) - Context ready
- ✅ **Domains** (`src/objects/domain/changes/domain.privilege.ts`) - Context ready
- ✅ **Enums** (`src/objects/type/enum/changes/enum.privilege.ts`) - Context ready
- ✅ **Composite Types** (`src/objects/type/composite-type/changes/composite-type.privilege.ts`) - Context ready
- ✅ **Range Types** (`src/objects/type/range/changes/range.privilege.ts`) - Context ready

**Note**: Languages (`src/objects/language/changes/language.privilege.ts`) have privilege files but do not support default privileges in PostgreSQL, so they are not included in this solution.

## Key Files

- `src/objects/base.default-privileges.ts` - `DefaultPrivilegeState` class that tracks and computes default privileges
- `src/catalog.diff.ts` - Diff roles first, compute final state, pass as context
- `src/objects/table/table.diff.ts` - Example implementation using `defaultPrivilegeState` to generate privilege changes
- `src/sort/phased-graph-sort.ts` - Constraint spec ensuring `ALTER DEFAULT PRIVILEGES` runs before `CREATE`
- `tests/integration/default-privileges-edge-case.test.ts` - Tests for edge cases
- `tests/integration/default-privileges-dependency-ordering.test.ts` - Tests for dependency ordering

## References

- [PostgreSQL ALTER DEFAULT PRIVILEGES Documentation](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html)
