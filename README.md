# pg-toolbelt

Monorepo for Supabase PostgreSQL tooling.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [`@supabase/pg-delta`](./packages/pg-delta) | PostgreSQL schema diff and migration tool | [![npm](https://img.shields.io/npm/v/@supabase/pg-delta)](https://www.npmjs.com/package/@supabase/pg-delta) |
| [`@supabase/pg-topo`](./packages/pg-topo) | Topological sorting for SQL DDL statements | [![npm](https://img.shields.io/npm/v/@supabase/pg-topo)](https://www.npmjs.com/package/@supabase/pg-topo) |
| [`@supabase/pg-squash`](./packages/pg-squash) | Compress a migration chain with a proof of equivalence | [![npm](https://img.shields.io/npm/v/@supabase/pg-squash)](https://www.npmjs.com/package/@supabase/pg-squash) |

## Documentation

Start at **[docs/](./docs/README.md)**, which routes by what you need:

| I want to… | Read |
|---|---|
| Use it — CLI and programmatic API | [docs/getting-started.md](./docs/getting-started.md) |
| Understand why the engine was rebuilt | [docs/overview.md](./docs/overview.md) |
| Understand how it works | [docs/architecture/README.md](./docs/architecture/README.md) |
| Work on it | [docs/architecture/onboarding.md](./docs/architecture/onboarding.md) |
| Know what it models and excludes | [packages/pg-delta/COVERAGE.md](./packages/pg-delta/COVERAGE.md) |
| See what's next | [docs/roadmap/](./docs/roadmap/README.md) |

## Development

### Prerequisites

- [Bun](https://bun.sh) (latest)
- [Docker](https://www.docker.com/) (for integration tests)
- Node.js >= 20 (for TypeScript compilation)

### Setup

```bash
bun install
```

### Commands

```bash
bun run build           # Build all packages
bun run test            # Test all packages
bun run test:pg-delta   # Test pg-delta only
bun run test:pg-topo    # Test pg-topo only
bun run test:pg-squash  # Test pg-squash only
bun run coverage        # Test coverage report (all packages)
bun run check-types     # Type check all packages
bun run format-and-lint # Format and lint all code
```

### Test coverage

`bun run coverage` runs both packages' suites with Istanbul instrumentation and
writes an HTML/lcov report to `.coverage-artifacts/` (open
`.coverage-artifacts/index.html`). Docker is required (the suites use
testcontainers).

```bash
bun run coverage                               # everything (unit + integration + corpus)
bun run coverage --unit-only                   # skip pg-delta's slow integration + corpus suites
bun run coverage --pg-image postgres:17-alpine # pin the PostgreSQL image for pg-delta
bun run coverage --skip-tests                  # regenerate the report from the last run
```

New code is expected to come with test coverage — see
[CONTRIBUTING.md](./CONTRIBUTING.md).

### Working with individual packages

```bash
# pg-delta
cd packages/pg-delta
bun run test src/       # Unit tests only
bun run test tests/     # Integration tests only (requires Docker)

# pg-topo
cd packages/pg-topo
bun run test            # All tests (requires Docker)

# pg-squash
cd packages/pg-squash
bun run test            # Unit tests (no Docker)
bun run test:corpus     # Corpus (Docker, once the engine lands)
```

### Releasing

This monorepo uses [changesets](https://github.com/changesets/changesets) for versioning.

```bash
bunx changeset          # Create a changeset
bun run version         # Apply changesets to update versions
bunx changeset publish  # Publish to npm
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

- Open an issue first.
- Wait for a maintainer to triage it and add the `open-for-contribution` label.
- Then open a pull request that links the issue (for example `Closes #123`).

Use [ISSUES.md](./ISSUES.md) for issue-writing guidance, especially for `pg-delta` reproductions.

## License

MIT
