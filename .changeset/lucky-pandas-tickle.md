---
"@supabase/pg-delta": patch
---

fix: the supabase profile no longer exports platform role plumbing under cluster scope (#371). The `supabase_privileged_role` role object and its grant to `postgres` join the system-role exclusions, and the `postgres` role object itself (NOSUPERUSER attributes + platform `search_path` config) is projected out of the managed view — none of it is user-declared state, and none of it can be re-applied by the non-superuser `postgres`. User roles, and grants where `postgres` is merely a member, still round-trip.
