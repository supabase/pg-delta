# pg-delta corpus fixtures

Each directory is one schema transition. `a.sql` and `b.sql` define its two
states; the engine corpus plans and proves both `a` → `b` and `b` → `a`.
Optional `seed.sql` and `seed-b.sql` files seed the corresponding source state,
and `meta.json` carries fixture scheduling or PostgreSQL-version metadata.
`meta.json` may also set `"renames": "auto" | "prompt" | "off"` to choose
rename handling for that scenario; omitted scenarios keep the `off` default.

## Action-shape budgets

An optional `budget.json` asserts the semantic shape of the **uncompacted**
plan. Budgets complement convergence and data-preservation proof: they catch a
plan that reaches the right schema through an unnecessarily destructive
drop/recreate path.

Assertions are explicit per direction:

```json
{
  "a-to-b": {
    "require": ["alter:column"],
    "forbid": ["replacement:table"]
  },
  "b-to-a": {
    "require": ["alter:column"],
    "forbid": ["replacement:table"]
  }
}
```

Each selector is `<shape>:<fact-kind>`. Shapes are `create`, `alter`, `drop`,
`replacement`, and `rename`; fact kinds are the stable-id kinds declared in
`src/core/stable-id.ts`. `require` means at least one matching observation and
`forbid` means none. Prefer these semantic assertions to total-action counts.

`replacement` is derived when a drop destroys and a create produces the exact
same encoded stable id. This deliberately includes every identity component,
such as routine argument types and ACL columns. `rename` is derived from one
alter action that both destroys an old subtree and produces a new subtree.

A known engine gap may be pinned without making the corpus permanently red:

```json
{
  "a-to-b": {
    "require": ["alter:column"],
    "expectedFailure": {
      "assertion": "require:alter:column",
      "issue": "https://github.com/supabase/pg-toolbelt/issues/332",
      "reason": "column STORAGE is not extracted"
    }
  }
}
```

`expectedFailure.assertion` names the one declared assertion the known issue may
violate. Any other violation still fails the budget. The expected failure is
self-expiring: once that assertion passes, the corpus fails and requires removal
of the stale pin. Unknown fields, shapes, fact kinds, empty assertion sets,
duplicates, and require/forbid contradictions fail while loading the corpus.
The live `column-operations--storage` fixture uses this mechanism to pin the
unmodeled column-storage transition tracked by
[#332](https://github.com/supabase/pg-toolbelt/issues/332).
