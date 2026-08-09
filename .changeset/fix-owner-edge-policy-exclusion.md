---
"@supabase/pg-delta": patch
---

Fix policy hard-exclusion laundering an excluded owner role back into the plan.
`excludeFactsAndDescendants` no longer mints a dangling `owner -> role` edge for
a role that THIS exclusion removes (it only preserves edges that were already
dangling on input, the seed-rebuild case). Previously a policy-excluded role
retained its owner edge, was auto-assumed in `plan.ts`, and re-emerged as
`CREATE SCHEMA … AUTHORIZATION <role>` / `OWNER TO <role>` while silencing the
missing-requirement guard. Now the guard correctly fires when a kept object's
ACL (or ownership) references a policy-excluded role. Also fixes the
"typo'd function body is caught by re-validation" test to opt into
`strictFunctionBodies` (a user-routine body-lint is a warning by default under
lenient function bodies).
