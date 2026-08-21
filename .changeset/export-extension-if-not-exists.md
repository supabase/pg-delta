---
"@supabase/pg-delta": minor
---

Add an opt-in `schema export --create-extension-if-not-exists` flag (and matching library option) that renders `CREATE EXTENSION IF NOT EXISTS`. Default export, plan, and apply still emit plain `CREATE`.
