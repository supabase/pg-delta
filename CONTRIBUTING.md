# Contributing to pg-toolbelt

Thanks for helping improve `pg-toolbelt`.

## Before you open a pull request

1. **Open an issue first.**
2. **Wait for maintainer triage.** A maintainer categorizes the issue with one of `✨ Feature`, `🐛 Bug`, `📘 Docs`, or `🛠️ Chore`, and adds the **`open-for-contribution`** label once it is ready to be worked on.
3. **Open a pull request only after the `open-for-contribution` label is set**, and link the issue with a closing keyword (for example `Closes #123`).

Until the `open-for-contribution` label is present, the issue is still in triage, so work should not start and a pull request should not be opened.

Pull requests from external contributors that do not follow this workflow are commented on and closed automatically by a bot. Supabase members are exempt, so they can work from Linear tickets that are not public on GitHub.

When you open the issue, use the guidance in [`ISSUES.md`](./ISSUES.md), especially for `pg-delta` bugs and regressions.

## If you are an AI agent

Follow the `pg-toolbelt` agent instructions before making changes. The canonical guide lives at `.github/agents/pg-toolbelt.md`.

That guide is the source of truth for package-specific expectations such as:

- targeted test selection while iterating
- changesets for user-facing changes
- package-specific workflow and validation rules

## Local setup

```bash
bun install
```

## Common commands

```bash
bun run build
bun run check-types
bun run format-and-lint
bun run test
```

Always use `bun run test`, not bare `bun test`, so the repository's test wrapper and flags are preserved.

## Contribution expectations

- Keep changes focused and scoped to the approved issue.
- Add or update tests for code changes.
- Add a changeset for user-facing fixes or features.
- Prefer targeted package tests while iterating, then run broader validation before finishing.

## Package-specific notes

### `pg-delta`

- Every fix or feature should include end-to-end coverage against a real PostgreSQL instance.
- Prefer a focused integration regression over broad test runs while iterating.
- If the bug is Supabase-specific, include the Supabase integration context in both the issue and the fix.

### `pg-topo`

- Keep tests focused on the smallest SQL sample that proves the behavior.
