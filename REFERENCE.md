Here is a summary of all the `pg_catalog`tables used by migra introspection queries. For each of them I listed all their columns (used or not by migra) and if they're considered stable between two databases.

### pg_attribute

| Column Name | Data Type | Description / Purpose | Stable? | Relevant for Diffing? |
| -- | -- | -- | -- | -- |
| attrelid | oid | OID of table this column belongs to (not portable across DBs) | Unstable | No |
| attname | name | Column name | Stable | Yes |
| atttypid | oid | OID of column type (not portable; use type name via join if needed) | Unstable | No |
| attlen | smallint | Storage length for fixed-length types (derived from type, rarely differs in user schemas) | Stable | No |
| attnum | smallint | Column order (1-based for user columns, negative for system columns) | Stable | Yes |
| attcacheoff | integer | Internal cache offset | Unstable | No |
| atttypmod | integer | Type modifier (e.g., varchar length, numeric precision/scale) | Stable | Yes |
| attndims | smallint | Number of array dimensions | Stable | Yes |
| attbyval | boolean | Passed by value (type property, not user-settable, but stable for a given type) | Stable | No |
| attalign | "char" | Alignment requirement (internal, type property) | Stable | No |
| attstorage | "char" | Storage type (internal, type property) | Stable | No |
| attcompression | "char" | Compression method (internal, rarely set by users) | Stable | No |
| attnotnull | boolean | NOT NULL constraint | Stable | Yes |
| atthasdef | boolean | Has default (use pg_attrdef for actual default) | Unstable | No |
| atthasmissing | boolean | Has missing value (internal, rarely used) | Unstable | No |
| attidentity | "char" | Identity column type (`''`, `'a'`, `'d'`) | Stable | Yes |
| attgenerated | "char" | Generated column type (`''`, `'s'` for stored, PG >= 12) | Stable | Yes |
| attisdropped | boolean | Is dropped (true if column is dropped, but still present in catalog) | Stable | Yes |
| attislocal | boolean | Is local (not inherited; relevant only for inherited tables) | Stable | No |
| attinhcount | smallint | Number of times column is inherited (rarely relevant for logical schema diff) | Stable | No |
| attcollation | oid | OID of collation (not portable; use collation name via join if needed) | Unstable | No |
| attstattarget | smallint | Statistics target (user-tunable, not schema) | Unstable | No |
| attacl | ARRAY | Column-level privileges (useful for privilege diffing, but not schema structure) | Unstable | No |
| attoptions | ARRAY | Per-column options (e.g., for storage parameters, relevant if used) | Stable | Yes |
| attfdwoptions | ARRAY | FDW options (for foreign tables, relevant if used) | Stable | Yes |
| attmissingval | anyarray | Default value for added columns (PG >= 11, rarely used) | Stable | No |

### pg_attrdef

| Column Name | Data Type | Description / Purpose | Stable? | Relevant for Diffing? |
| -- | -- | -- | -- | -- |
| oid | oid | Row OID (unique identifier for this default expression, not portable) | Unstable | No |
| adrelid | oid | OID of the table this default belongs to (not portable across DBs) | Unstable | No |
| adnum | smallint | Column number (attnum in pg_attribute) | Stable | Yes |
| adbin | pg_node_tree | Internal representation of the default expression (use pg_get_expr to read) | Stable | Yes |

### pg_class

| Column Name | Data Type | Description / Purpose | Stable? | Relevant for Diffing? |
| -- | -- | -- | -- | -- |
| oid | oid | Row OID (unique identifier for this relation, not portable) | Unstable | No |
| relname | name | Name of the table, index, sequence, view, etc. | Stable | Yes |
| relnamespace | oid | OID of schema (pg_namespace) this relation belongs to (not portable) | Unstable | No |
| reltype | oid | OID of the composite type for this table (not portable) | Unstable | No |
| reloftype | oid | OID of type this table inherits from (typed tables, not portable) | Unstable | No |
| relowner | oid | OID of owner (pg_roles) (not portable) | Unstable | No |
| relam | oid | OID of access method (for indexes, not portable; use name via join if needed) | Unstable | No |
| relfilenode | oid | OID of the physical file (not portable, internal) | Unstable | No |
| reltablespace | oid | OID of tablespace (not portable; use tablespace name via join if needed) | Unstable | No |
| relpages | integer | Number of disk pages used by the relation (statistical, not schema) | Unstable | No |
| reltuples | real | Number of rows in the relation (statistical, not schema) | Unstable | No |
| relallvisible | integer | Number of all-visible pages (statistical, not schema) | Unstable | No |
| reltoastrelid | oid | OID of TOAST table (not portable, internal) | Unstable | No |
| relhasindex | boolean | True if the relation has (or can have) indexes | Stable | No |
| relisshared | boolean | True if the relation is shared across databases | Stable | No |
| relpersistence | "char" | Persistence type: permanent (`p`), unlogged (`u`), or temporary (`t`) | Stable | Yes |
| relkind | "char" | Relation type: table (`r`), index (`i`), sequence (`S`), view (`v`), etc. | Stable | Yes |
| relnatts | smallint | Number of user columns in the relation | Stable | No |
| relchecks | smallint | Number of CHECK constraints on the table | Stable | No |
| relhasrules | boolean | True if the relation has rules | Stable | No |
| relhastriggers | boolean | True if the relation has triggers | Stable | No |
| relhassubclass | boolean | True if the relation has subclasses (is inherited from) | Stable | No |
| relrowsecurity | boolean | True if row-level security is enabled | Stable | Yes |
| relforcerowsecurity | boolean | True if row-level security is forced | Stable | Yes |
| relispopulated | boolean | True if a materialized view is populated | Stable | No |
| relreplident | "char" | Replica identity setting: `d`efault, `n`othing, `f`ull, `i`ndex | Stable | No |
| relispartition | boolean | True if the relation is a partition (PG >= 10) | Stable | No |
| relrewrite | oid | OID of the relation that this one is being rewritten to (internal, not portable) | Unstable | No |
| relfrozenxid | xid | All tuples before this XID are frozen (internal, not schema) | Unstable | No |
| relminmxid | xid | All multi-xacts before this ID are frozen (internal, not schema) | Unstable | No |
| relacl | ARRAY | Access privileges (useful for privilege diffing, not schema structure) | Unstable | No |
| reloptions | ARRAY | Relation-level options (e.g., storage parameters, relevant if used) | Stable | Yes |
| relpartbound | pg_node_tree | Partition bound expression (for partitioned tables, relevant if used) | Stable | Yes |

### pg_collation

| Column Name | Data Type | Description / Purpose | Stable? | Relevant for Diffing? |
| -- | -- | -- | -- | -- |
| oid | oid | Row OID (unique identifier for this collation, not portable) | Unstable | No |
| collname | name | Name of the collation | Stable | Yes |
| collnamespace | oid | OID of schema (pg_namespace) this collation belongs to (not portable) | Unstable | No |
| collowner | oid | OID of owner (pg_roles) (not portable) | Unstable | No |
| collprovider | "char" | Provider: `d` (default), `c` (libc), `i` (ICU) | Stable | Yes |
| collisdeterministic | boolean | True if the collation is deterministic (ICU only, PG >= 12) | Stable | Yes |
| collencoding | integer | Encoding this collation applies to, or -1 for any | Stable | Yes |
| collcollate | text | LC_COLLATE setting (locale for collation) | Stable | Yes |
| collctype | text | LC_CTYPE setting (locale for character classification) | Stable | Yes |
| colllocale | text | ICU locale identifier (ICU only, PG >= 10) | Stable | Yes |
| collicurules | text | ICU collation rules (ICU only, PG >= 10) | Stable | Yes |
| collversion | text | Version string for the collation | Stable | Yes |

### pg_constraint

| Column Name | Data Type | Description / Purpose | Stable? | Relevant for Diffing? |
| -- | -- | -- | -- | -- |
| oid | oid | Row OID (unique identifier for this constraint, not portable) | Unstable | No |
| conname | name | Name of the constraint | Stable | Yes |
| connamespace | oid | OID of schema (pg_namespace) this constraint belongs to (not portable) | Unstable | No |
| contype | "char" | Constraint type: `c` (CHECK), `f` (FK), `p` (PK), `u` (UNIQUE), `x` (EXCLUDE) | Stable | Yes |
| condeferrable | boolean | True if the constraint is deferrable | Stable | Yes |
| condeferred | boolean | True if the constraint is initially deferred | Stable | Yes |
| convalidated | boolean | True if the constraint is validated | Stable | Yes |
| conrelid | oid | OID of the table this constraint is on (not portable) | Unstable | No |
| contypid | oid | OID of the domain this constraint is on (not portable) | Unstable | No |
| conindid | oid | OID of the index supporting this constraint (not portable) | Unstable | No |
| conparentid | oid | OID of parent constraint (for inherited constraints, not portable) | Unstable | No |
| confrelid | oid | OID of referenced table (for FKs, not portable) | Unstable | No |
| confupdtype | "char" | FK ON UPDATE action: `a` (NO ACTION), `r` (RESTRICT), `c` (CASCADE), `n` (SET NULL), `d` (SET DEFAULT) | Stable | Yes |
| confdeltype | "char" | FK ON DELETE action: same codes as above | Stable | Yes |
| confmatchtype | "char" | FK match type: `f` (FULL), `p` (PARTIAL), `s` (SIMPLE) | Stable | Yes |
| conislocal | boolean | True if the constraint is local to the table | Stable | No |
| coninhcount | smallint | Number of times constraint is inherited | Stable | No |
| connoinherit | boolean | True if the constraint cannot be inherited | Stable | No |
| conkey | ARRAY | Column numbers (attnums) of the constrained columns | Stable | Yes |
| confkey | ARRAY | Column numbers (attnums) of the referenced columns (for FKs) | Stable | Yes |
| conpfeqop | ARRAY | OIDs of PK = FK operators (not portable) | Unstable | No |
| conppeqop | ARRAY | OIDs of PK = PK operators (not portable) | Unstable | No |
| conffeqop | ARRAY | OIDs of FK = FK operators (not portable) | Unstable | No |
| confdelsetcols | ARRAY | Columns to set to default on delete (for FKs, rarely used) | Stable | No |
| conexclop | ARRAY | OIDs of exclusion operators (for EXCLUDE constraints, not portable) | Unstable | No |
| conbin | pg_node_tree | Internal representation of CHECK constraint expression (use pg_get_expr to read) | Stable | Yes |

### pg_depend

| Column Name | Data Type | Description / Purpose | Stable? | Relevant for Diffing? |
| -- | -- | -- | -- | -- |
| classid | oid | OID of the system catalog this dependent object is in (e.g., pg_class, pg_type) | Stable | Yes |
| objid | oid | OID of the dependent object (not portable, but needed for internal joins) | Unstable | No |
| objsubid | integer | Sub-object ID (e.g., column number for attributes, 0 for whole object) | Stable | Yes |
| refclassid | oid | OID of the system catalog the referenced object is in | Stable | Yes |
| refobjid | oid | OID of the referenced object (not portable, but needed for internal joins) | Unstable | No |
| refobjsubid | integer | Sub-object ID of the referenced object (e.g., column number, 0 for whole object) | Stable | Yes |
| deptype | "char" | Dependency type: `n` (normal), `a` (auto), `i` (internal), etc. | Stable | Yes |

### pg_enum

| Column Name | Data Type | Description / Purpose | Stable? | Relevant for Diffing? |
| -- | -- | -- | -- | -- |
| oid | oid | Row OID (unique identifier for this enum value, not portable) | Unstable | No |
| enumtypid | oid | OID of the enum type this value belongs to (not portable) | Unstable | No |
| enumsortorder | real | Sort order of the enum value within the type | Stable | Yes |
| enumlabel | name | The actual label (string value) of the enum value | Stable | Yes |

### pg_extension

| Column Name | Data Type | Description / Purpose | Stable? | Relevant for Diffing? |
| -- | -- | -- | -- | -- |
| oid | oid | Row OID (unique identifier for this extension, not portable) | Unstable | No |
| extname | name | Name of the extension | Stable | Yes |
| extowner | oid | OID of the owner (pg_roles) (not portable) | Unstable | No |
| extnamespace | oid | OID of the schema (pg_namespace) the extension is installed in (not portable) | Unstable | No |
| extrelocatable | boolean | True if the extension can be relocated to another schema | Stable | Yes |
| extversion | text | Version string of the extension | Stable | Yes |
| extconfig | ARRAY | OIDs of configuration tables (not portable) | Unstable | No |
| extcondition | ARRAY | Conditions for configuration tables (text expressions) | Stable | No |

### pg_index

| Column Name | Data Type | Description / Purpose | Stable? | Relevant for Diffing? |
| -- | -- | -- | -- | -- |
| indexrelid | oid | OID of the index relation itself (not portable) | Unstable | No |
| indrelid | oid | OID of the table this index is on (not portable) | Unstable | No |
| indnatts | smallint | Number of attributes in the index (including included columns) | Stable | No |
| indnkeyatts | smallint | Number of key attributes in the index | Stable | No |
| indisunique | boolean | True if the index is UNIQUE | Stable | Yes |
| indnullsnotdistinct | boolean | True if NULLs are not distinct in unique index (PG >= 15) | Stable | Yes |
| indisprimary | boolean | True if the index is a PRIMARY KEY | Stable | Yes |
| indisexclusion | boolean | True if the index is for an EXCLUDE constraint | Stable | Yes |
| indimmediate | boolean | True if the index enforces immediate constraint checking | Stable | Yes |
| indisclustered | boolean | True if the index is the one used for CLUSTER | Stable | No |
| indisvalid | boolean | True if the index is valid for queries | Stable | No |
| indcheckxmin | boolean | True if the index must be checked for xmin validity | Stable | No |
| indisready | boolean | True if the index is ready for inserts | Stable | No |
| indislive | boolean | True if the index is live (not being dropped) | Stable | No |
| indisreplident | boolean | True if the index is the replica identity | Stable | No |
| indkey | ARRAY | Column numbers (attnums) of the index key columns | Stable | Yes |
| indcollation | ARRAY | OIDs of collations for each column (not portable; use collation names via join) | Unstable | No |
| indclass | ARRAY | OIDs of operator classes for each column (not portable; use names via join) | Unstable | No |
| indoption | ARRAY | Per-column flag options (e.g., ASC/DESC, NULLS FIRST/LAST) | Stable | Yes |
| indexprs | pg_node_tree | Expression tree for index expressions (for expression indexes) | Stable | Yes |
| indpred | pg_node_tree | Expression tree for partial index predicate | Stable | Yes |

### pg_inherits

| Column Name | Data Type | Description / Purpose | Stable? | Relevant for Diffing? |
| -- | -- | -- | -- | -- |
| inhrelid | oid | OID of the child table (not portable) | Unstable | No |
| inhparent | oid | OID of the parent table (not portable) | Unstable | No |
| inhseqno | integer | Order of this parent in the inheritance hierarchy for the child | Stable | Yes |
| inhdetachpending | boolean | True if the inheritance link is pending detach (PG >= 14, rarely used) | Stable | No |

### pg_language

| Column Name | Data Type | Description / Purpose | Stable? | Relevant for Diffing? |
| -- | -- | -- | -- | -- |
| oid | oid | Row OID (unique identifier for this language, not portable) | Unstable | No |
| lanname | name | Name of the procedural language | Stable | Yes |
| lanowner | oid | OID of the owner (pg_roles) (not portable) | Unstable | No |
| lanispl | boolean | True if this is a procedural language | Stable | Yes |
| lanpltrusted | boolean | True if the language is trusted | Stable | Yes |
| lanplcallfoid | oid | OID of the call handler function (not portable) | Unstable | No |
| laninline | oid | OID of the inline handler function (not portable) | Unstable | No |
| lanvalidator | oid | OID of the validator function (not portable) | Unstable | No |
| lanacl | ARRAY | Access privileges (useful for privilege diffing, not schema structure) | Unstable | No |

### pg_namespace

| Column Name | Data Type | Description / Purpose | Stable? | Relevant for Diffing? |
| -- | -- | -- | -- | -- |
| oid | oid | Row OID (unique identifier for this schema, not portable) | Unstable | No |
| nspname | name | Name of the schema | Stable | Yes |
| nspowner | oid | OID of the owner (pg_roles) (not portable) | Unstable | No |
| nspacl | ARRAY | Access privileges (useful for privilege diffing, not schema structure) | Unstable | No |

### pg_policy

| Column Name | Data Type | Description / Purpose | Stable? | Relevant for Diffing? |
| -- | -- | -- | -- | -- |
| oid | oid | Row OID (unique identifier for this policy, not portable) | Unstable | No |
| polname | name | Name of the policy | Stable | Yes |
| polrelid | oid | OID of the table this policy applies to (not portable) | Unstable | No |
| polcmd | "char" | Command type: `r` (SELECT), `a` (INSERT), `w` (UPDATE), `d` (DELETE), `*` (ALL) | Stable | Yes |
| polpermissive | boolean | True if the policy is permissive (vs restrictive) | Stable | Yes |
| polroles | ARRAY | OIDs of roles to which the policy applies (not portable; use role names via join if needed) | Unstable | No |
| polqual | pg_node_tree | Expression tree for the policy's USING clause | Stable | Yes |
| polwithcheck | pg_node_tree | Expression tree for the policy's WITH CHECK clause | Stable | Yes |

### pg_proc

| Column Name | Data Type | Description / Purpose | Stable? | Relevant for Diffing? |
| -- | -- | -- | -- | -- |
| oid | oid | Row OID (unique identifier for this function, not portable) | Unstable | No |
| proname | name | Name of the function/procedure | Stable | Yes |
| pronamespace | oid | OID of the schema (pg_namespace) (not portable) | Unstable | No |
| proowner | oid | OID of the owner (pg_roles) (not portable) | Unstable | No |
| prolang | oid | OID of the language (pg_language) (not portable; use language name via join) | Unstable | No |
| procost | real | Estimated execution cost | Stable | No |
| prorows | real | Estimated number of rows returned | Stable | No |
| provariadic | oid | OID of variadic parameter type (not portable) | Unstable | No |
| prosupport | regproc | OID of support function (not portable) | Unstable | No |
| prokind | "char" | Kind: `f` (function), `p` (procedure), `a` (aggregate), `w` (window) | Stable | Yes |
| prosecdef | boolean | True if SECURITY DEFINER | Stable | Yes |
| proleakproof | boolean | True if leakproof | Stable | Yes |
| proisstrict | boolean | True if function is strict (NULL in => NULL out) | Stable | Yes |
| proretset | boolean | True if function returns a set | Stable | Yes |
| provolatile | "char" | Volatility: `i` (immutable), `s` (stable), `v` (volatile) | Stable | Yes |
| proparallel | "char" | Parallel safety: `u` (unsafe), `s` (safe), `r` (restricted) | Stable | Yes |
| pronargs | smallint | Number of arguments | Stable | Yes |
| pronargdefaults | smallint | Number of arguments with defaults | Stable | Yes |
| prorettype | oid | OID of return type (not portable; use type name via join) | Unstable | No |
| proargtypes | ARRAY | OIDs of argument types (not portable; use type names via join) | Unstable | No |
| proallargtypes | ARRAY | OIDs of all argument types (not portable; use type names via join) | Unstable | No |
| proargmodes | ARRAY | Argument modes: `i` (IN), `o` (OUT), `b` (INOUT), `v` (VARIADIC), `t` (TABLE) | Stable | Yes |
| proargnames | ARRAY | Argument names | Stable | Yes |
| proargdefaults | pg_node_tree | Expression tree for argument defaults | Stable | Yes |
| protrftypes | ARRAY | OIDs of transform types (not portable) | Unstable | No |
| prosrc | text | Function source code (for SQL, C, etc.) | Stable | Yes |
| probin | text | Path to C-language binary, if applicable | Stable | No |
| prosqlbody | pg_node_tree | SQL function body (internal, for SQL-language functions) | Stable | No |
| proconfig | ARRAY | Function-local GUC settings | Stable | No |
| proacl | ARRAY | Access privileges (useful for privilege diffing, not schema structure) | Unstable | No |

### pg_rewrite

| Column Name | Data Type | Description / Purpose | Stable? | Relevant for Diffing? |
| -- | -- | -- | -- | -- |
| oid | oid | Row OID (unique identifier for this rule, not portable) | Unstable | No |
| rulename | name | Name of the rewrite rule | Stable | Yes |
| ev_class | oid | OID of the relation this rule applies to (not portable) | Unstable | No |
| ev_type | "char" | Event type: `1` (SELECT), `2` (UPDATE), `3` (INSERT), `4` (DELETE) | Stable | Yes |
| ev_enabled | "char" | Rule enabled status: `O` (enabled), `D` (disabled), `R` (rewrite), `A` (always) | Stable | Yes |
| is_instead | boolean | True if this is an INSTEAD rule | Stable | Yes |
| ev_qual | pg_node_tree | Expression tree for the rule's qualification (WHEN clause) | Stable | Yes |
| ev_action | pg_node_tree | Expression tree for the rule's action | Stable | Yes |

### pg_roles

| Column Name | Data Type | Description / Purpose | Stable? | Relevant for Diffing? |
| -- | -- | -- | -- | -- |
| rolname | name | Name of the role (user or group) | Stable | Yes |
| rolsuper | boolean | True if the role is a superuser | Stable | Yes |
| rolinherit | boolean | True if the role inherits privileges | Stable | Yes |
| rolcreaterole | boolean | True if the role can create other roles | Stable | Yes |
| rolcreatedb | boolean | True if the role can create databases | Stable | Yes |
| rolcanlogin | boolean | True if the role can log in (is a user, not just a group) | Stable | Yes |
| rolreplication | boolean | True if the role can initiate replication | Stable | Yes |
| rolconnlimit | integer | Connection limit for the role | Stable | Yes |
| rolpassword | text | Password hash (not portable, not relevant for schema diffing) | Unstable | No |
| rolvaliduntil | timestamp with time zone | Password expiration timestamp (not portable, not relevant for schema diff) | Unstable | No |
| rolbypassrls | boolean | True if the role can bypass row-level security | Stable | Yes |
| rolconfig | ARRAY | Role-specific configuration settings (GUCs) | Stable | No |
| oid | oid | Row OID (unique identifier for this role, not portable) | Unstable | No |

### pg_trigger

| Column Name | Data Type | Description / Purpose | Stable? | Relevant for Diffing? |
| -- | -- | -- | -- | -- |
| oid | oid | Row OID (unique identifier for this trigger, not portable) | Unstable | No |
| tgrelid | oid | OID of the table this trigger is on (not portable) | Unstable | No |
| tgparentid | oid | OID of parent trigger (for inherited triggers, not portable) | Unstable | No |
| tgname | name | Name of the trigger | Stable | Yes |
| tgfoid | oid | OID of the function to be called (not portable; use function name via join) | Unstable | No |
| tgtype | smallint | Bitmask describing trigger type (BEFORE/AFTER, ROW/STATEMENT, event type) | Stable | Yes |
| tgenabled | "char" | Trigger enabled status: `O` (enabled), `D` (disabled), `R` (replica), `A` (always) | Stable | Yes |
| tgisinternal | boolean | True if the trigger is internal (system-generated) | Stable | Yes |
| tgconstrrelid | oid | OID of the constraint relation (for FK triggers, not portable) | Unstable | No |
| tgconstrindid | oid | OID of the constraint index (for FK triggers, not portable) | Unstable | No |
| tgconstraint | oid | OID of the associated constraint (not portable) | Unstable | No |
| tgdeferrable | boolean | True if the trigger is deferrable (for constraint triggers) | Stable | Yes |
| tginitdeferred | boolean | True if the trigger is initially deferred | Stable | Yes |
| tgnargs | smallint | Number of arguments passed to the trigger function | Stable | Yes |
| tgattr | ARRAY | Attribute numbers (columns) the trigger is on (for column triggers) | Stable | Yes |
| tgargs | bytea | Arguments passed to the trigger function | Stable | Yes |
| tgqual | pg_node_tree | Expression tree for WHEN condition (PG >= 14) | Stable | Yes |
| tgoldtable | name | Name of transition table for old rows (if any) | Stable | Yes |
| tgnewtable | name | Name of transition table for new rows (if any) | Stable | Yes |

### pg_type

| Column Name | Data Type | Description / Purpose | Stable? | Relevant for Diffing? |
| -- | -- | -- | -- | -- |
| oid | oid | Row OID (unique identifier for this type, not portable) | Unstable | No |
| typname | name | Name of the type | Stable | Yes |
| typnamespace | oid | OID of the schema (pg_namespace) (not portable) | Unstable | No |
| typowner | oid | OID of the owner (pg_roles) (not portable) | Unstable | No |
| typlen | smallint | Storage length for this type (or -1 for variable) | Stable | No |
| typbyval | boolean | True if passed by value (type property, not user-settable) | Stable | No |
| typtype | "char" | Type type: `b` (base), `c` (composite), `d` (domain), `e` (enum), `p` (pseudo), etc. | Stable | Yes |
| typcategory | "char" | Type category: `A` (array), `B` (boolean), `C` (composite), etc. | Stable | Yes |
| typispreferred | boolean | True if this is the preferred type in its category | Stable | No |
| typisdefined | boolean | True if this type is defined (not just a shell) | Stable | No |
| typdelim | "char" | Delimiter character for array types | Stable | No |
| typrelid | oid | OID of the pg_class entry for this type (composite types, not portable) | Unstable | No |
| typsubscript | regproc | OID of subscript handler function (not portable) | Unstable | No |
| typelem | oid | OID of element type (for arrays, not portable) | Unstable | No |
| typarray | oid | OID of array type (not portable) | Unstable | No |
| typinput | regproc | OID of input function (not portable) | Unstable | No |
| typoutput | regproc | OID of output function (not portable) | Unstable | No |
| typreceive | regproc | OID of receive function (not portable) | Unstable | No |
| typsend | regproc | OID of send function (not portable) | Unstable | No |
| typmodin | regproc | OID of typmodin function (not portable) | Unstable | No |
| typmodout | regproc | OID of typmodout function (not portable) | Unstable | No |
| typanalyze | regproc | OID of analyze function (not portable) | Unstable | No |
| typalign | "char" | Alignment requirement (`c`, `s`, `i`, `d`) | Stable | No |
| typstorage | "char" | Storage type (`p`, `e`, `m`, `x`) | Stable | No |
| typnotnull | boolean | True if the type is NOT NULL | Stable | Yes |
| typbasetype | oid | OID of base type (for domains, not portable) | Unstable | No |
| typtypmod | integer | Type modifier (for domains, etc.) | Stable | Yes |
| typndims | integer | Number of array dimensions (for domains) | Stable | Yes |
| typcollation | oid | OID of collation (not portable; use collation name via join if needed) | Unstable | No |
| typdefaultbin | pg_node_tree | Expression tree for default value (internal) | Stable | Yes |
| typdefault | text | Default value for the type (as text) | Stable | Yes |
| typacl | ARRAY | Access privileges (useful for privilege diffing, not schema structure) | Unstable | No |