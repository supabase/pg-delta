---
"@supabase/pg-topo": minor
---

Expose a typed `privilege` payload on GRANT / REVOKE / ALTER DEFAULT PRIVILEGES nodes so consumers can read direction, roles, schemas, and privileges from the AST instead of regex-matching `sql`.
