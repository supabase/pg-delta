# Identity and ACL invariants

Read this before changing a `StableId`, adding a role-bearing field, touching
ACL extraction, or changing rename behavior. PostgreSQL catalogs use OIDs to
connect objects at runtime; pg-delta uses declarative, name-based addresses to
describe the state that DDL can reproduce. Confusing those two identities is
the source of most rename and ACL edge cases.

This document distinguishes the **current implementation** from the **I1
target**. I1 has not landed yet: current planning still uses post-diff role
carry and a narrow role-rename ordering carve-out.

## The invariants at a glance

1. A `StableId` is a structured declarative address, not a PostgreSQL OID.
2. A fact's address belongs in `id`; semantic state belongs in `payload`.
3. `encodeId()` is the only string codec. Do not recover structured fields by
   parsing or regex outside that codec.
4. PostgreSQL carries OID references through a rename, but name-keyed facts do
   not follow automatically inside pg-delta.
5. ACL identity is target + grantee + optional column. ACL payload is the
   effective privilege set; grantor provenance is deliberately not modeled.
6. Payload keys beginning with `_` are operational hints. They may guide
   rendering, ordering, or safety, but never participate in equality.
7. State proof compares post-apply declarative identities. Data proof remaps
   accepted table/materialized-view renames only.

## StableId means declarative addressability

[`StableId`](../../packages/pg-delta/src/core/stable-id.ts) is a discriminated
union of the fields PostgreSQL DDL needs to address an object:

- a table is `{ kind: "table", schema, name }`;
- a routine also includes its argument-type list;
- a policy includes schema, table, and policy name;
- a membership includes the granted role and member;
- an ACL includes its target, grantee, and optional column.

These are durable *names within a captured state*, not durable database
identities. PostgreSQL may preserve one OID while `ALTER ... RENAME` changes the
name. pg-delta will then extract a different `StableId` for the same physical
object.

Keep identity structured end-to-end. Extraction returns identity parts and
TypeScript constructs the union. `encodeId()` and `parseId()` are the only
canonical string boundary. Encoded ids currently serve as in-memory map and
graph keys as well as persisted artifact fields and logs; callers must still
inspect the structured union rather than reverse-engineering the string.
Snapshot and plan formats have versions, but the StableId codec itself has no
independent version tag today.

Identity parts are not duplicated as structured payload attributes. Canonical
`pg_get_*def()` text can still embed an object's own or referenced names; that
known limitation can turn a would-be rename into a reported near-miss. Where
payload content remains identity-free, its hash can remain equal across a leaf
rename. Named Merkle rollups still fold encoded child ids and dependency
endpoints, so identity changes propagate to normal state equality. Rename
proposal uses a separate structural rollup that omits fact/edge identities to
compare whole subtrees.

## Names carried by PostgreSQL OIDs

`ALTER ROLE old RENAME TO new` changes the catalog name while preserving the
role OID. Ownership, grants, memberships, user mappings, and policy role lists
continue to reference that OID. Re-extraction reports `new` everywhere even
though pg-delta's pre-rename facts were keyed by `old`.

The current StableId role-name registry is
[`ROLE_NAME_BEARING_KINDS`](../../packages/pg-delta/src/plan/role-rename-carry.ts):

| Kind | Role-bearing identity fields |
|---|---|
| `role` | `name` |
| `membership` | `role`, `member` |
| `userMapping` | `role` |
| `defaultPrivilege` | `role`, `grantee` |
| `acl` | `grantee`; recursively, a role-bearing `target` |
| `comment` | recursively, a role-bearing `target` |
| `securityLabel` | recursively, a role-bearing `target` |

Two important role references are outside that table:

- an `owner` is a dependency edge whose `to` endpoint is a role, not a
  StableId kind;
- `policy.roles` is a structured payload field, not identity.

The registry guard test forces every new StableId kind to be classified, but it
cannot protect payload fields. Whenever a new catalog field contains a role
name, decide explicitly whether it belongs in identity, an edge, or structured
payload. Do not derive or repair the reference by parsing SQL text.

## Rename flow: current and target

### Current implementation

Current planning performs these steps:

1. Reconstruct the managed source and desired views.
2. Run generic diff and policy filtering; build remove/add worklists from kept
   deltas.
3. Propose rename-capable roots whose identity-free structural rollups match.
   Ambiguous and near-miss candidates are reported, never guessed.
4. Accept candidates according to `auto`, `prompt`, and explicit confirmation;
   cancel their old and new subtrees from create/drop worklists.
5. For accepted role renames, relabel role-bearing StableIds after the diff.
   Cancel unchanged remove/add pairs and matching owner unlink/link pairs;
   convert payload-changed pairs into mutations against the new identity.
6. Emit the rename separately, with the old subtree in `destroys` and the new
   subtree in `produces`, so dependent actions order against both names.

This post-diff carry lives in
[`role-rename-carry.ts`](../../packages/pg-delta/src/plan/role-rename-carry.ts).
It cannot relabel `policy.roles`, because that reference is payload-carried.
The current planner therefore retains the narrow B1 ordering carve-out for a
policy mutation spanning an accepted role rename.

### I1 target (not current)

[I1](../roadmap/agent-tracks/I1-prediff-rename-identity.md) replaces carry with
identity normalization:

1. A discovery diff, with policy filtering, proposes and accepts role renames.
2. Copy-on-write normalization rewrites both fact bases into the **desired-name
   space**: ids, parents, edges, `referenceOnly` encoded ids, and known
   structured payload references such as `policy.roles`.
3. A second canonical diff and policy filter produce the ordinary plan.
4. The existing rename-emission seam still renders SQL from the original
   physical old/new facts.

Only the source fingerprint remains tied to the physical pre-rename source.
Everything else consumes the canonical pair. When I1 lands, the role carry
module and B1 carve-out should disappear; until then, documentation and tests
must describe them as current behavior.

## ACL identity and equality

An ACL is a satellite fact. Its identity is:

```ts
{ kind: "acl", target: StableId, grantee: string, column?: string }
```

For an object-level grant, `target` is the object and `column` is absent. For a
column-level grant such as `GRANT SELECT (email) ON users TO reporter`, `target`
remains the owning relation and `column` contains `email`; the fact's parent is
the column fact. Keeping the optional column in the codec and every identity
rewrite is essential—dropping it aliases a column grant with an object grant.

The semantic payload contains sorted `privileges` and `grantable` sets.
Extraction models the grantee's **effective privileges**, not which grantor
supplied them. `aclexplode()` can return the same privilege once per grantor;
the extractor groups by grantee and de-duplicates privilege and grant-option
values. Consequently:

- two databases with the same effective grantee privileges compare equal even
  if grantor provenance differs;
- removing one of several equivalent grantors is intentionally invisible while
  the effective set remains;
- export and replay preserve effective access, not exact GRANT provenance.

Ordinary object ACL extraction normalizes a null ACL through `acldefault()` and
synthesizes empty owner/PUBLIC entries when a built-in default was revoked. An
extension member instead records only differences from `pg_init_privs` (or the
object default), because recreating the extension restores the installed ACL.

## Non-semantic underscore payload fields

[`canonicalize()`](../../packages/pg-delta/src/core/hash.ts) recursively omits
every object key beginning with `_`. Those fields therefore cannot change fact
hashes, diff deltas, fingerprints, or state-proof equality.

They are not dead data. They can guide a plan whose semantic need is already
established by hashed state:

| Field | Purpose and consumer |
|---|---|
| `_ownerDefault` | Version-correct owner defaults from `acldefault()`; lets default-ACL compaction remove only grants PostgreSQL supplies on create. |
| `_initPrivs` | Extension member's installed ACL; lets ACL removal restore install state instead of blindly revoking everything. |
| `_revokedDefault` | Records a removed built-in default privilege so default-privilege rendering can restore it. |
| `_position` | Preserves declared column/composite-attribute creation order without making order-only drift semantic. |
| `_serverMajor` | Selects only subscription mutations supported by the captured PostgreSQL version. |
| `_configGucs` | Keeps assumed-schema seeding from replaying routines that require unsafe configuration. |

The rule for adding one is strict: changing an underscore field alone must not
represent desired-state drift, because generic diff will never see it. Use an
underscore field only for extraction provenance, rendering context, ordering,
or safety. If changing the value must produce DDL by itself, it is semantic and
must not begin with `_`.

## Proof implications

State proof applies the finished plan, re-extracts the clone, reconstructs the
same managed view, and compares it with the projected desired view. The
post-apply catalog must therefore use the desired declarative ids and names;
underscore hints cannot rescue a state mismatch because proof does not include
them in equality.

Data proof has a narrower rename rule. Accepted table and materialized-view
renames map the old relation key used for pre-apply row statistics to the new
relation key used after apply. That prevents a data-preserving rename from being
misclassified as drop/recreate. Role and other object renames do not use this
row-key map.

Under the I1 target, the proof algorithm remains unchanged, but fingerprint
routing matters: apply must compare the physical pre-rename source with the
physical source fingerprint, while canonical ids feed diff, planning, and the
desired state proof.

## Checklist for contributors

Before adding or changing identity, ACL, or role-bearing state:

- Is the value part of the DDL address (`id`), semantic state (`payload`), or a
  dependency/provenance relationship (`edge`)?
- If a StableId embeds a role name, is its kind classified and relabeled in the
  role-name-bearing registry and guard test?
- If a payload embeds a role name, is the current carry limitation documented
  and the I1 normalizer inventory updated?
- Does an ACL change preserve `target`, `grantee`, and optional `column`?
- Are privilege arrays sorted and grantor duplicates removed intentionally?
- If a field begins with `_`, is it safe for equality and proof to ignore it?
- Does rename behavior have both plan-ordering coverage and, for relations,
  data-proof coverage?
