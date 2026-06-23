---
"@supabase/pg-delta-next": patch
---

Complete the `defaclObjtype` rule-table mapping for types, domains, and schemas
(`T`/`T`/`n`). This is the single source of truth shared by the emitter's
default-privilege hygiene pass and the co-create REVOKE-elision guard, replacing
a duplicate hardcoded mapping. Consequences:

- A freshly created type/domain/schema under an applicable `ALTER DEFAULT
  PRIVILEGES … ON TYPES`/`ON SCHEMAS` now gets its implicit default grant cleaned
  up (hygiene REVOKE) the same way relations/sequences/functions already did.
- The co-create REVOKE-elision guard now correctly keeps a load-bearing leading
  `REVOKE ALL` when a `defaultPrivilege` on a type/domain/schema would grant the
  grantee a privilege outside the explicit ACL.

Purely structural / proof-stable: full corpus passes unchanged.
