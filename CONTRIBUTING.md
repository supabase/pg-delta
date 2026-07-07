# Contributing to pg-toolbelt

Thanks for helping improve `pg-toolbelt`.

## Before you open a pull request

1. **Open an issue first.**
2. **Wait for maintainer triage.** An issue is ready for implementation only after a maintainer adds one of these labels:
   - `✨ Feature`
   - `🐛 Bug`
   - `📘 Docs`
   - `🛠️ Chore`
3. **Open a pull request only after that approval.**

Until one of those labels is set, the issue is considered untracked and still in triage, so work should not start and a pull request should not be opened.

Pull requests that do not follow this workflow are automatically closed by a bot.

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
bun run coverage
```

Always use `bun run test`, not bare `bun test`, so the repository's test wrapper and flags are preserved.

## Contribution expectations

- Keep changes focused and scoped to the approved issue.
- Add or update tests for code changes. **New code is expected to come with test coverage** — cover the lines and branches your change introduces. Check locally with `bun run coverage` (HTML report in `.coverage-artifacts/`; use `--unit-only` for a quick pass that skips pg-delta's slow integration + corpus suites).
- Add a changeset for user-facing fixes or features.
- Prefer targeted package tests while iterating, then run broader validation before finishing.

## Package-specific notes

### `pg-delta`

- Every fix or feature should include end-to-end coverage against a real PostgreSQL instance.
- Prefer a focused integration regression over broad test runs while iterating.
- If the bug is Supabase-specific, include the Supabase integration context in both the issue and the fix.

### `pg-topo`

- Keep tests focused on the smallest SQL sample that proves the behavior.
