# I2 — Document identity / ACL invariants

**Priority:** Medium · **Wave:** 2 (optional) · **Ship:** alone · **Parallel with:** I1 if different files; D0; K1

## Goal

Write down the identity model so the next role-bearing field does not rediscover
carry/normalize bugs via production regressions.

## Why this track exists

Reviews found: name-keyed StableIds vs OID-carried Postgres refs; non-hashed
`_` payload attrs (`_ownerDefault`, `_initPrivs`); grantor-blind ACL extraction;
column-qualified ACL codec. Knowledge lives in code comments across
`stable-id.ts`, `role-rename-carry.ts`, extract ACL, hash.ts.

## Out of scope

- No planner behavior changes (that’s I1).
- No extract logic changes unless documenting an intentional current behavior
  that is already tested.

## Owned files (write)

- New: `docs/architecture/identity-and-acl.md` (recommended)
- Light cross-links from:
  - `docs/architecture/README.md`
  - `docs/architecture/target-architecture.md` (short pointer only)
  - Header comments in `core/stable-id.ts` and extract ACL module pointing to the doc

## Content outline

1. **StableId = declarative addressability**, not OID identity
2. Which kinds embed role names (table matching `ROLE_NAME_BEARING_KINDS`)
3. Rename story: structural propose → (post-I1) normalize → diff
4. ACL model: grantee/column keys; grantor handling (document current extract
   choice and why)
5. Non-hashed `_` fields: what they are for; why they must not silently affect
   Merkle equality; planner consumers
6. Proof implications: rename-aware data proof / canonical ids

## Acceptance criteria

- [ ] One architecture doc a new contributor can read before touching ACL/rename
- [ ] Links from architecture README
- [ ] No false claims that carry is gone until I1 merges (use “current” vs
      “target” sections if I1 not done)

## Test plan / changeset

- Docs only; no changeset.
