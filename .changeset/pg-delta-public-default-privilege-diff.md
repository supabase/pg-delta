---
"@supabase/pg-delta": patch
---

fix(pg-delta): correctly diff PUBLIC's built-in default privilege so REVOKE ... FROM PUBLIC is no longer silently dropped for functions, procedures, aggregates, domains, enums, ranges, composite types, and languages

`filterPublicBuiltInDefaults` stripped any `grantee === "PUBLIC"` entry
matching an object type's implicit default privilege (EXECUTE for
procedures/aggregates, USAGE for domains/enums/ranges/composite
types/languages) from both sides of a privilege diff, unconditionally.

For altered objects, both sides' privileges are already extracted via
`COALESCE(<acl-column>, acldefault(...))`, so they correctly and
symmetrically reflect PostgreSQL's implicit PUBLIC default (or its
explicit revocation) with no filtering needed at all - stripping PUBLIC
from both sides turned "existing object + a new PUBLIC revoke on one
side" into an empty diff.

For newly created objects, the "effective defaults" side (tracked via
`ALTER DEFAULT PRIVILEGES` customizations) never encodes PostgreSQL's
hardcoded PUBLIC fallback, while the desired object's real ACL does -
filtering PUBLIC off the desired side to paper over that asymmetry
erased the signal whenever the desired state revoked PUBLIC's default.
A new `withPublicBuiltInDefault` helper now adds that built-in default
back onto the defaults side instead, so both sides compare
symmetrically and an explicit `REVOKE ... FROM PUBLIC` in the desired
state is preserved.
