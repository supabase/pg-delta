# Filing issues for pg-toolbelt

Open an issue before opening a pull request. A maintainer categorizes each issue with one of `✨ Feature`, `🐛 Bug`, `📘 Docs`, or `🛠️ Chore`, and adds the **`open-for-contribution`** label once it is ready to be worked on. A pull request should only be opened after that label is present.

Until the `open-for-contribution` label is present, the issue is still waiting for triage, so work should not start and a pull request should not be opened.

## Start with the basics

Please include:

- the affected package (`pg-delta` or `pg-topo`)
- the version, commit SHA, or branch you tested
- your OS and runtime versions when relevant
- a minimal reproduction
- the expected result
- the actual result

If you already know the fix, still open the issue first and wait for the `open-for-contribution` label before sending a pull request.

## What to include for `pg-delta`

`pg-delta` issues are much easier to reproduce when the report contains the exact database shape and command that triggered the problem.

Please include:

- the PostgreSQL version(s) involved
- whether this is plain PostgreSQL or Supabase
- the exact `pg-delta` command and flags you ran
- whether you used `plan`, `apply`, `sync`, `catalog-export`, `declarative export`, or `declarative apply`
- the relevant schema input:
  - SQL needed to create the source and target state, or
  - a minimal declarative schema directory, or
  - the catalog snapshots / plan output if that is what reproduces the issue
- the expected SQL, plan, or behavior
- the actual SQL, plan, error output, or diff output

If the issue depends on a specific extension, role setup, policy, trigger, or Supabase-managed object, include that too.

## What helps maintainers reproduce and fix a `pg-delta` issue

The best reports make it obvious how to turn the bug into a regression test. Useful additions include:

- a minimal setup SQL snippet for both sides of the diff
- the smallest failing scenario you could reduce it to
- whether the issue reproduces on all supported PostgreSQL versions or only one
- whether `--integration supabase` is required
- any debug output that narrows the problem down

When contributors work on a fix, they will usually need to add targeted coverage under `packages/pg-delta/tests/integration/` and, when useful, a focused unit test next to the affected source.

## Tips for strong `pg-delta` repros

- Strip the example down to the smallest schema that still fails.
- Prefer inline SQL over screenshots.
- Include generated SQL or plan output as text.
- Mention any environment-dependent inputs such as extensions, roles, or external objects.
- If the problem is specific to declarative mode, include the exact file layout and file contents.

## What to include for `pg-topo`

Please include:

- the SQL statements that need to be ordered
- the order you expected
- the order or diagnostic you actually got
- whether the issue depends on comments, annotations, or filesystem discovery
