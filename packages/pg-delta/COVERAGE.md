# Catalog coverage & deliberate exclusions

What the extractor models, and where it deliberately stops. The doctrine:
extract everything as facts at fact grain; deliberate gaps are recorded here,
never silently dropped.

## Fully modeled (own fact kind + create/drop/alter rules + corpus proof)

schema, role (+ config), role membership, default privilege, extension,
table (incl. partitioned/partitions, INHERITS, replica identity), column,
default, constraint (table + domain + foreign-table CHECK), index, sequence (+ OWNED BY), view,
materialized view, function, procedure, aggregate, trigger, policy, rewrite
rule, event trigger, domain, enum / composite / range type, collation,
publication, subscription, FDW, server, user mapping, foreign table.

Global satellite facts (one rule each): comment (any COMMENT-addressable target),
ACL (acldefault-normalized, per grantable object), security label (every
SECURITY-LABEL-addressable *modeled* target — see the security-label scope note
below; an addressable-but-unmodeled label is diagnosed, never silently dropped).

### Scope notes (where a family is partially scoped)

Most families are fully modeled end-to-end. The cases worth calling out — so
"modeled" is never read as "modeled without limits":

| Family | Extracted | Planned / Proven | Scope notes |
|---|---|---|---|
| Constraints | table + domain + foreign-table CHECK | yes | foreign tables carry only CHECK (no PK/FK/UNIQUE/EXCLUSION); serialized via `ALTER FOREIGN TABLE` |
| Foreign tables | yes (columns, options, local CHECK) | yes | inherit/partition-of foreign tables out of scope |
| Security labels | yes (`SECURITY LABEL`) | yes | needs a provider; CI uses the `dummy_seclabel` image. See the dedicated scope note below for which targets are supported / diagnosed / out of scope |
| Extension members | observed via `memberOfExtension` edges | projected out by default | sub-entity member families use the extract-time anti-join (tier-4-deferrals.md) |
| Not modeled | — | — | casts, operators (class/family), text-search, statistics, transforms, user languages, parameter ACLs: **detected + reported** as `unmodeled_kind`, never silently dropped |

Ownership is modeled as an `owner` EDGE (object --owner--> role), not a payload
field: it diffs as an edge link/unlink that the planner renders as `ALTER …
OWNER TO` (per-kind prefix), and an owner role projected out of the managed view
prunes the edge so the object is created applier-owned — no `skipAuthorization`
param. The `CREATE EXTENSION … SCHEMA` clause is likewise derived from the
extension's `relocatable` fact, not a `skipSchema` param. The only serialize
param is `concurrentIndexes` (an apply-time strategy). See
[`managed-view-architecture.md`](https://github.com/supabase/pg-toolbelt/blob/main/docs/architecture/managed-view-architecture.md).

## Sub-entity facts (granularity is one, §3.1)

Composite-type attributes and publication members are full facts, not
payload blobs — so they diff at sub-entity grain, are rename candidates,
and can be `pg_depend` edge targets:

- **Composite type attributes** → `typeAttribute` facts (schema, type,
  name; payload type + collation), parented to the `type`. On a fresh type
  they inline into `CREATE TYPE AS (…)` (delta-set); on an existing type
  they are managed incrementally: `ADD` / `DROP` / `RENAME ATTRIBUTE …
  CASCADE` all work even while the type is used by table columns and
  preserve the stored data.
- **Published tables** → `publicationRel` facts (publication, schema,
  table; payload column-list + `WHERE`), parented to the `publication`.
  **Published schemas** → `publicationSchema` facts. On a fresh publication
  they inline into `CREATE PUBLICATION FOR …`; otherwise managed with
  `ALTER PUBLICATION ADD/DROP`. A per-table column-list / `WHERE` change
  replaces that member (`DROP TABLE` + re-`ADD`), with no churn on the rest
  of the publication.

One irreducible PostgreSQL limitation: `ALTER TYPE … ALTER ATTRIBUTE …
TYPE` is rejected while the composite is used by a table column (`CASCADE`
only reaches typed tables, not columns). The `typeAttribute` rule supports
the attribute-type change for unused composites and fails loudly with a
clear remediation message for in-use ones — it does not emit a statement
that would fail at apply.

## Environment-gated (modeled; integration proof needs a non-default image)

- **Security labels** — extraction (`pg_seclabel` / `pg_shseclabel`), the
  `securityLabel` rule, and rendering are implemented and unit-proven
  (`src/plan/security-label.test.ts`). The create / change-in-place / drop
  cycle is proven **end-to-end** (`tests/security-label-proof.test.ts`)
  against a `postgres:<major>-alpine` image with the `dummy_seclabel` test
  module compiled in and preloaded (`tests/dummy-seclabel.Dockerfile`,
  `tests/containers.ts::seclabelCluster`). The `dummy` provider stores labels
  verbatim (clean apply → re-extract roundtrip), validating against its fixed
  vocabulary (unclassified / classified / secret / top secret). The image is
  built on first run; `PGDELTA_SKIP_DUMMY_SECLABEL_BUILD=1` skips the proof in
  sandboxes that cannot reach the Alpine / GitHub CDNs at build time. The main
  corpus stays on stock `postgres:*-alpine` (label catalogs are empty there, so
  it is unaffected); a CI prebuild of the image is a possible follow-up.

  Three tiers of label TARGET (verified on PG17 with the dummy provider —
  `src/extract/security-labels.ts`):
  - **Supported** (extracted, planned, proven per kind in
    `tests/security-label-proof.test.ts`): table, view, materialized view,
    sequence, foreign table, column, schema, type, domain, function, procedure,
    aggregate, role, event trigger, publication, subscription.
  - **Deliberately unsupported but DIAGNOSED**: a valid SECURITY LABEL target
    that the engine does not model — `LANGUAGE`, `LARGE OBJECT`, `DATABASE`,
    `TABLESPACE`. A label on one of these surfaces an `unresolved_security_label`
    warning (escalated to a hard stop by `--strict-coverage`) instead of being
    silently dropped — the failure mode that would otherwise let a proof pass
    vacuously.
  - **Not addressable at all** (so a label can never exist): index, collation,
    foreign data wrapper, foreign server, constraint, trigger, policy, rule.
    PostgreSQL rejects `SECURITY LABEL ON …` for these object types
    ("security labels are not supported for this type of object"), so they
    cannot appear in `pg_seclabel`.

## Not modeled (deliberate) — but DETECTED, never silently missed

These kinds are not modeled, but a user-created object of one of them is no
longer invisible: `extract()` runs a provenance-aware **catalog completeness
check** (`src/extract/unmodeled.ts`) that emits an `unmodeled_kind` diagnostic
naming each kind found, and the CLI's `--strict-coverage` refuses to plan while
any exist. Built-in (OID < `FirstNormalObjectId`) and extension-owned objects
are excluded — only genuine user state is reported. So the exclusions below are
*enforced and visible*, not a silent gap (review finding 1).

- **Languages** (`pg_language`) — the `language` StableId kind is reserved in
  the codec but not extracted; user-defined languages are rare and the
  built-ins (`sql`, `plpgsql`, `c`, `internal`) are not user state. Add a
  `language` extractor + rule when a real need appears.
- **FTS configs/dictionaries/parsers/templates, operator classes/families as
  first-class facts, casts, transforms, statistics objects** — out of v1 scope;
  none are modeled, all are detected. Extension-provided variants are filtered
  at extract time (see below).
- **Parameter ACLs** (`pg_parameter_acl`, PG 15+ — backs `GRANT SET ON
  PARAMETER` / `GRANT ALTER SYSTEM ON PARAMETER`) — out of v1 scope; not
  modeled, detected. The probe is version-gated (`minVersion: 15` in
  `unmodeled.ts`'s `PROBES`) since the catalog does not exist on PG 14.
- **Large objects** — out of v1 scope; not modeled and (as data state rather
  than schema DDL) not part of the unmodeled-kind schema check.
- **Sequence `last_value`** — runtime state, not desired schema state
  (matches every comparable tool). Never extracted.
- **Extension version** — excluded from the `extension` payload (a managed
  platform pins versions out of band; including it produces phantom diffs).
- **Collation `collversion`** — excluded (host-glibc/ICU dependent).

## Extension members: observed, projected by default (4b)

Extension-owned objects are **observed** at extraction as ordinary facts
carrying a `memberOfExtension` edge to their extension — "provenance is data, an
edge fact, not an extraction-time filter" (§3.1) — and then **projected out of
the managed universe by default** in `plan()`/`prove()`
(`excludeExtensionMembers`, the counterpart of `excludeManaged`). So policy-free
behaviour is unchanged (members never diff), while raw `extract()` can see them
with full ownership provenance.

Flipped (member-ROOT families, each observed + tagged, verified by the
`extension-member-parity` pg_depend oracle): schemas, tables, sequences,
views/materialized views, routines (functions + procedures), aggregates,
domains, enum/composite/range types, collations.

A reference INTO a member (a user table column of an extension type, a default
calling an extension function) resolves to the **extension**, not the member
fact (the resolver's collapse branches): the member is projected out, so a
member-targeted edge would be pruned with it and the dependent would lose its
ordering on the extension. The collapsed edge points at the extension (which
survives), so ordering holds — pinned by `extension-member-ordering`.

**Still filtered (documented, regression-free):** sub-entity families (columns,
constraints, indexes, triggers, policies, rewrite rules) and rare member-root
kinds (foreign data wrappers, foreign servers, foreign tables, event triggers,
publications) keep their `notExtensionMember` anti-joins. Their members ride out
with the projected parent (sub-entities) or are vanishingly rare (the rest), so
the default projected behaviour is identical either way; they were left to keep
the migration bounded and fully parity-gated.
