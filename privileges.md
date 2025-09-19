# Privileges and memberships in PostgreSQL, and how pg-diff handles them

This page explains how privileges work in PostgreSQL and how pg-diff extracts, models, diffs, and generates SQL for GRANT/REVOKE and role memberships. It also covers default privileges and dependency ordering, so generated migrations apply cleanly.

## PostgreSQL concepts (quick primer)

- **Roles and memberships**: Roles can be granted to other roles/users. Memberships can include options:
  - ADMIN OPTION: member can grant membership to others
  - INHERIT OPTION (PG16+): member inherits privileges from the role
  - SET OPTION (PG16+): member can `SET ROLE` to the granted role
- **Object privileges**: GRANT/REVOKE on objects like TABLE, VIEW, MATERIALIZED VIEW, SEQUENCE, SCHEMA, LANGUAGE, ROUTINE (functions/procedures), TYPE/DOMAIN. Some privileges may be granted WITH GRANT OPTION.
- **Column privileges**: Column-level privileges for SELECT, INSERT, UPDATE, REFERENCES.
- **Default privileges**: ALTER DEFAULT PRIVILEGES sets template privileges for future objects created by a grantor, optionally scoped to a schema and object type category (TABLES, SEQUENCES, ROUTINES, TYPES, SCHEMAS).
- **PUBLIC**: A special grantee meaning “all roles”. PostgreSQL stores PUBLIC as grantee OID 0; we normalize it to string `PUBLIC`.

pg-diff focuses on user-defined objects and excludes system schemas (`pg_%`, `information_schema`) and objects owned/created by extensions when appropriate.

## Folder structure

`src/objects/privilege/`
- `object-privilege/`: Object-level privileges
  - `object-privilege.model.ts`: extraction and model
  - `object-privilege.diff.ts`: diff logic (GRANT/REVOKE/REVOKE GRANT OPTION)
  - `changes/object-privilege.alter.ts`: SQL serialization classes
- `column-privilege/`: Column-level privileges on tables/views/mviews
  - `column-privilege.model.ts`: extraction and model
  - `column-privilege.diff.ts`: diff logic
  - `changes/column-privilege.alter.ts`: SQL serialization
- `default-privilege/`: ALTER DEFAULT PRIVILEGES
  - `default-privilege.model.ts`: extraction and model
  - `default-privilege.diff.ts`: diff logic
  - `changes/default-privilege.alter.ts`: SQL serialization
- `membership/`: Role memberships
  - `membership.model.ts`: extraction and model
  - `changes/membership.{create,drop,alter}.ts`: SQL serialization
- `membership.model.ts` and `membership.diff.ts`: compatibility shims (re-export/use membership support)

Privileges are integrated into the catalog and dependency graph via:
- `src/catalog.model.ts`: includes extracted privilege sets and memberships
- `src/depend.ts`: adds edges so GRANT/REVOKE run after referenced objects/roles exist

## Modeling and identity

We normalize privileges into “sets” keyed by stable IDs, so diffing is deterministic:

- Object privileges (`object-privilege.model.ts`)
  - Class: `ObjectPrivilegeSet`
  - Identity: by `target_stable_id` and `grantee`
  - Stable ID: `acl:${target_stable_id}::grantee:${grantee}`
  - Data: array of `{ privilege, grantable }` entries, sorted for stability
  - Targets covered and stable IDs:
    - TABLE → `table:schema.name`
    - VIEW → `view:schema.name`
    - MATERIALIZED VIEW → `materializedView:schema.name`
    - SEQUENCE → `sequence:schema.name`
    - SCHEMA → `schema:name`
    - LANGUAGE → `language:name`
    - ROUTINE → `procedure:schema.name(arg_types)`
    - TYPE/DOMAIN → `type:/domain:/enum:/range:/compositeType:schema.name`

- Column privileges (`column-privilege.model.ts`)
  - Class: `ColumnPrivilegeSet`
  - Identity: by `table_stable_id` and `grantee`
  - Stable ID: `aclcol:${table_stable_id}::grantee:${grantee}`
  - Data: array of items `{ privilege, grantable, columns[] }` where columns are sorted
  - Privileges: `SELECT | INSERT | UPDATE | REFERENCES`

- Default privileges (`default-privilege.model.ts`)
  - Class: `DefaultPrivilegeSet`
  - Identity: by `(grantor, in_schema, objtype, grantee)`
  - Stable ID: `defacl:${grantor}:${objtype}:${scope}:grantee:${grantee}` where `scope` is `schema:<name>` or `global`
  - Data: array of `{ privilege, grantable }`
  - Objtype: `r` (TABLES), `S` (SEQUENCES), `f` (ROUTINES), `T` (TYPES), `n` (SCHEMAS)

- Role memberships (`membership.model.ts`)
  - Class: `RoleMembership`
  - Identity: by `role` and `member`
  - Stable ID: `membership:${role}->${member}`
  - Data: `{ grantor, admin_option, inherit_option?, set_option? }`

## Extraction

We use `aclexplode(...)` to expand ACL arrays into rows, coalesce grantee 0 to `PUBLIC`, filter out system schemas and extension-owned objects:
- Objects: relations (`pg_class`), schemas (`pg_namespace`), languages (`pg_language`), routines (`pg_proc` with allowed languages), and types (`pg_type` with allowed `typtype`). See `extractObjectPrivileges`.
- Columns: for eligible relations and non-dropped columns, expand `attacl`. See `extractColumnPrivileges`.
- Default privileges: `pg_default_acl` with expanded `defaclacl`. See `extractDefaultPrivileges`.
- Memberships: `pg_auth_members` joined to `pg_roles`. See `extractRoleMemberships`.

Each extractor returns a list of model instances which `catalog.model.ts` collects into records keyed by `stableId`.

## Diffing rules and SQL generation

All privilege diffs follow similar patterns: compare normalized sets, compute grants, revokes, and grant-option-only changes.

- Object privileges (`object-privilege.diff.ts` → `changes/object-privilege.alter.ts`)
  - New set: emit a `GRANT` grouped by `grantable` to minimize statements; one statement per grant-option group.
  - Dropped set: emit a `REVOKE` grouped by `grantable`.
  - Altered set:
    - Added privileges → `GRANT`
    - Removed privileges with grantable=false → `REVOKE`
    - Downgrade from WITH GRANT OPTION to base only → `REVOKE GRANT OPTION FOR`
    - Upgrade from base to WITH GRANT OPTION → only `GRANT ... WITH GRANT OPTION` (no base revoke)

- Column privileges (`column-privilege.diff.ts` → `changes/column-privilege.alter.ts`)
  - Grants/Revokes account for per-privilege column lists and grant-option.
  - Downgrade grant option on a subset of columns → `REVOKE GRANT OPTION FOR <priv> (<cols>) ON TABLE ... FROM ...`
  - Statements are grouped to minimize duplication and ensure deterministic ordering.

- Default privileges (`default-privilege.diff.ts` → `changes/default-privilege.alter.ts`)
  - Use `ALTER DEFAULT PRIVILEGES FOR ROLE <grantor> [IN SCHEMA <schema>]`.
  - Grants grouped by grant-option state.
  - Revokes split into two categories: `REVOKE GRANT OPTION FOR ...` and base `REVOKE ...`.
  - Upgrades from base to grant option do not revoke the base first.

- Role memberships (`membership.diff.ts` → `changes/membership.*.ts`)
  - Create: `GRANT role TO member [WITH ADMIN OPTION]` (we only emit ADMIN OPTION on create; INHERIT/SET default behavior is left implicit).
  - Drop: `REVOKE role FROM member`.
  - Alter: translate option flips into either `REVOKE <...> OPTION FOR role FROM member` (for removed options) or re-`GRANT role TO member WITH ...` (for added options). Admin, inherit, and set are handled individually.

### Worked examples

#### Object privileges

- New set (grouped by grant option)
  - Main: none
  - Branch: on `TABLE public.accounts` to `app_user`
    - `SELECT` (base), `UPDATE` (WITH GRANT OPTION)
  - Emits:

```sql
GRANT SELECT ON TABLE public.accounts TO app_user; 
GRANT UPDATE ON TABLE public.accounts TO app_user WITH GRANT OPTION
```

- Dropped set (grouped by grant option)
  - Main: `SELECT`, `UPDATE` (WITH GRANT OPTION)
  - Branch: none
  - Emits:

```sql
REVOKE SELECT ON TABLE public.accounts FROM app_user; 
REVOKE UPDATE ON TABLE public.accounts FROM app_user
```

- Alter: add privilege
  - Main: `SELECT`
  - Branch: `SELECT`, `DELETE`
  - Emits:

```sql
GRANT DELETE ON TABLE public.accounts TO app_user
```

- Alter: remove base privilege
  - Main: `SELECT`, `DELETE`
  - Branch: `SELECT`
  - Emits:

```sql
REVOKE DELETE ON TABLE public.accounts FROM app_user
```

- Alter: downgrade from WITH GRANT OPTION → base only
  - Main: `UPDATE` (WITH GRANT OPTION)
  - Branch: `UPDATE` (base)
  - Emits:

```sql
REVOKE GRANT OPTION FOR UPDATE ON TABLE public.accounts FROM app_user
```

- Alter: upgrade from base → WITH GRANT OPTION
  - Main: `UPDATE` (base)
  - Branch: `UPDATE` (WITH GRANT OPTION)
  - Emits:

```sql
GRANT UPDATE ON TABLE public.accounts TO app_user WITH GRANT OPTION
```

Note: For other kinds, the prefix adapts automatically: `ON VIEW`, `ON MATERIALIZED VIEW`, `ON SEQUENCE`, `ON SCHEMA`, `ON LANGUAGE`, `ON ROUTINE`, `ON TYPE`.

#### Column privileges

- New set (per-privilege column lists, grouped by grant option)
  - Main: none
  - Branch (grantee `app_user` on `public.accounts`):
    - `SELECT` (base) on `(id, email)`
    - `UPDATE` (WITH GRANT OPTION) on `(email)`
  - Emits:

```sql
GRANT SELECT (email, id) ON TABLE public.accounts TO app_user; 
GRANT UPDATE (email) ON TABLE public.accounts TO app_user WITH GRANT OPTION
```

- Dropped set
  - Main: as above
  - Branch: none
  - Emits:

```sql
REVOKE SELECT (email, id) ON TABLE public.accounts FROM app_user; 
REVOKE UPDATE (email) ON TABLE public.accounts FROM app_user
```

- Alter: add columns to an existing base privilege
  - Main: `SELECT` on `(id)`
  - Branch: `SELECT` on `(id, email)`
  - Emits:

```sql
GRANT SELECT (email) ON TABLE public.accounts TO app_user
```

- Alter: remove columns from an existing base privilege
  - Main: `INSERT` on `(id, email)`
  - Branch: `INSERT` on `(email)`
  - Emits:

```sql
REVOKE INSERT (id) ON TABLE public.accounts FROM app_user
```

- Alter: downgrade grant option for a subset of columns
  - Main: `UPDATE` (WITH GRANT OPTION) on `(email, status)` and base `UPDATE` on `(id)`
  - Branch: base `UPDATE` on `(email, id, status)`
  - Emits:

```sql
REVOKE GRANT OPTION FOR UPDATE (email, status) ON TABLE public.accounts FROM app_user
```

#### Default privileges

- New set (grouped by grant option)
  - Main: none
  - Branch: grantor `owner`, scope `IN SCHEMA public`, objtype `TABLES`, grantee `app_user`:
    - `SELECT` (base), `UPDATE` (WITH GRANT OPTION)
  - Emits:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE owner IN SCHEMA public GRANT SELECT ON TABLES TO app_user; 
ALTER DEFAULT PRIVILEGES FOR ROLE owner IN SCHEMA public GRANT UPDATE ON TABLES TO app_user WITH GRANT OPTION
```

- Dropped set
  - Main: as above
  - Branch: none
  - Emits:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE owner IN SCHEMA public REVOKE GRANT OPTION FOR UPDATE ON TABLES FROM app_user; 
ALTER DEFAULT PRIVILEGES FOR ROLE owner IN SCHEMA public REVOKE SELECT ON TABLES FROM app_user
```

- Alter: add privilege
  - Main: `SELECT`
  - Branch: `SELECT`, `INSERT`
  - Emits:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE owner IN SCHEMA public GRANT INSERT ON TABLES TO app_user
```

- Alter: remove base privilege
  - Main: `SELECT`, `INSERT`
  - Branch: `SELECT`
  - Emits:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE owner IN SCHEMA public REVOKE INSERT ON TABLES FROM app_user
```

- Alter: downgrade from WITH GRANT OPTION → base only
  - Main: `UPDATE` (WITH GRANT OPTION)
  - Branch: `UPDATE` (base)
  - Emits:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE owner IN SCHEMA public REVOKE GRANT OPTION FOR UPDATE ON TABLES FROM app_user
```

- Alter: upgrade from base → WITH GRANT OPTION
  - Main: `UPDATE` (base)
  - Branch: `UPDATE` (WITH GRANT OPTION)
  - Emits:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE owner IN SCHEMA public GRANT UPDATE ON TABLES TO app_user WITH GRANT OPTION
```

#### Role memberships

- Create membership (emit ADMIN OPTION only on create if set)
  - Main: none
  - Branch: `GRANT parent_role TO child_role WITH ADMIN OPTION`
  - Emits:

```sql
GRANT parent_role TO child_role WITH ADMIN OPTION
```

- Drop membership
  - Main: membership exists
  - Branch: none
  - Emits:

```sql
REVOKE parent_role FROM child_role
```

- Alter: add options
  - Main: membership without options
  - Branch: membership with `ADMIN OPTION`, `INHERIT OPTION`, `SET OPTION`
  - Emits:

```sql
GRANT parent_role TO child_role WITH ADMIN OPTION INHERIT OPTION SET OPTION
```

- Alter: remove options
  - Main: membership with `ADMIN OPTION` and `SET OPTION`
  - Branch: membership without options
  - Emits:

```sql
REVOKE ADMIN OPTION SET OPTION FOR parent_role FROM child_role
```

## Dependency ordering

To ensure grants/revokes apply after their targets and grantees exist (and before drops where needed), we inject edges into the global dependency graph (`depend.ts`):
- Object privileges: `acl:<target>::grantee:<role> -> <target>` and `-> role:<role>`
- Column privileges: `aclcol:table:<schema>.<name>::grantee:<role> -> table:<schema>.<name>` and `-> role:<role>`
- Default privileges: `defacl:<grantor>:<objtype>:<scope>:grantee:<grantee> -> role:<grantor>`, `-> role:<grantee>`, and `-> schema:<schema>` when scoped
- Memberships: `membership:<role>-><member> -> role:<role>` and `-> role:<member>`

These edges let the diff planner order `GRANT/REVOKE` and membership changes deterministically relative to object/role creation and deletion.

## Naming and formatting rules

- Object qualification: we generate fully qualified names where appropriate:
  - Schemas and languages: bare names (already quoted)
  - Routines: include `schema.name(arg_types)`
  - Tables/views/mviews/sequences/types/domains: `schema.name`
- PUBLIC is serialized literally as `PUBLIC`.
- Privilege lists and column lists are deduplicated and sorted for stable output.

## Where to look in the code

- Object privileges: `src/objects/privilege/object-privilege/*`
- Column privileges: `src/objects/privilege/column-privilege/*`
- Default privileges: `src/objects/privilege/default-privilege/*`
- Memberships: `src/objects/privilege/membership/*`
- Dependency edges: `src/depend.ts` (search for `acl:`, `aclcol:`, `defacl:`, `membership:`)
- Catalog integration: `src/catalog.model.ts`

## Examples

- Grant SELECT on table to `app_user`:
  - Diff produces: `GRANT SELECT ON TABLE schema.table TO app_user`
- Revoke only grant option for UPDATE on table:
  - Diff produces: `REVOKE GRANT OPTION FOR UPDATE ON TABLE schema.table FROM app_user`
- Grant column-level privileges with grant option:
  - Diff produces: `GRANT SELECT (col1, col2) ON TABLE schema.table TO app_user WITH GRANT OPTION`
- Alter default privileges for tables in schema `public` by grantor `owner`:
  - Diff produces: `ALTER DEFAULT PRIVILEGES FOR ROLE owner IN SCHEMA public GRANT SELECT ON TABLES TO app_user`
- Grant role membership with admin option:
  - Diff produces: `GRANT parent_role TO child_role WITH ADMIN OPTION`

If you need to extend privilege coverage (new object kinds or options), mirror the existing pattern:
1) add extraction, 2) create model with stable ID and normalized data, 3) implement diff rules, 4) implement SQL serialization, 5) wire dependency edges, 6) add tests.
