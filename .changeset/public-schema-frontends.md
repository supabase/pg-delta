---
"@supabase/pg-delta": minor
---

feat(pg-delta): publish reusable schema export/plan/render/shadow frontends

Extract the schema export, plan-from-files, render, and co-located shadow
orchestration from the private CLI into public `@supabase/pg-delta` /
`@supabase/pg-delta/frontends` APIs (`buildSchemaExport`, `planSchemaFiles`,
`renderPlanFiles`, `provisionCoLocatedShadow`, export manifest helpers, and
`ManagementScope`). The `pgdelta` CLI now calls these functions so there is a
single implementation for library and CLI consumers.
