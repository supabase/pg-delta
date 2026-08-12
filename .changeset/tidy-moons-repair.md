---
"@supabase/pg-delta": patch
---

Fix the planner's missing-requirement guard rejecting DB-webhook triggers (`CREATE TRIGGER … EXECUTE FUNCTION supabase_functions.http_request(...)`) when the target database has never had the webhooks infrastructure provisioned. A platform-provisioned member of an assumed schema — an object owned by a policy-declared assumed role other than the default owner, such as `supabase_functions.http_request()` (owned by `supabase_functions_admin`) — is now treated as present at apply time by the same platform guarantee that makes its schema assumed. User-created objects in assumed schemas (owned by the default owner or a user role) still fail fast at plan time when the target lacks them.
