---
"@supabase/pg-delta-next": patch
---

Two more owner-ACL correctness fixes for plan/export from empty:

- **Full owner revoke.** After `REVOKE ALL … FROM <owner>` the object's `relacl` is non-NULL but has no owner row, so extraction emitted no owner ACL fact and planning from empty left PostgreSQL's built-in owner privileges in place. Extraction now synthesizes an empty owner ACL entry (mirroring the existing revoked-PUBLIC-default handling), so the plan emits the `REVOKE ALL … FROM owner` and converges.
- **Owner ACL elision vs ALTER DEFAULT PRIVILEGES.** The default-ACL elision could drop a co-created object's owner `REVOKE`/`GRANT` group when the desired owner privileges equalled an ADP-reduced default. But a from-empty plan does not guarantee the object is created after the ADP action, so the create-time owner ACL is ambiguous. Elision now keeps the group whenever an ADP customizes that objtype (for the PUBLIC and owner branches alike), comparing only against the built-in default otherwise.
