---
"@supabase/pg-delta-next": minor
---

feat(pg-delta-next): schema apply quick mode — optional --shadow provisions a co-located shadow

`schema apply`'s `--shadow` is now optional. When omitted, a throwaway shadow
database (`pgdelta_shadow_<unique>`) is created on the TARGET's own cluster from
`template0`, used to elaborate the declarative files, and dropped afterward
(`--keep-shadow` retains it for debugging). Co-locating with the target shares its
cluster-global roles and extension availability with a single connection string,
so no separate shadow cluster is needed for the common case.

Co-located shadows are `database` scope only (they share the target's cluster, so
they must never carry cluster-global role DDL — the scope projection and
cluster-DDL guard enforce this); `--scope cluster` still requires an explicit
`--shadow` to a dedicated cluster. If the connecting role lacks `CREATEDB`, apply
fails with a clear message pointing to `--shadow`.

Note: a fresh co-located shadow does not yet contain platform-managed schemas
(e.g. Supabase `auth`/`storage`); declarative files that reference them still need
an explicitly-provisioned shadow until the assumed-schema seeding step lands.
