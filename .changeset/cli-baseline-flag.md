---
"@supabase/pg-delta": minor
---

Add a `--baseline <snapshot.json>` CLI flag to `plan`, `schema export`, and `schema apply`. It loads a `pgdelta snapshot` file and subtracts that FactBase from both sides before diffing, so platform-provided objects captured in the baseline (base-image roles, extension-owned schemas, etc.) stay invisible. This lets a custom `--profile` file scope the managed view without shipping a committed, policy-declared baseline; an explicit `--baseline` takes precedence over any policy-declared baseline name.
