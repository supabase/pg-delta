# pg-delta

PostgreSQL migrations made easy.

Generate migration scripts by comparing two PostgreSQL databases. Automatically detects schema differences and creates safe, ordered migration scripts.

## Features

- 🔍 Compare databases and generate migration scripts automatically
- 🔒 Safety-first: detects data-loss operations and requires explicit confirmation
- 📋 Plan-based workflow: preview changes before applying, store plans for version control
- 🎯 Integration DSL: filter and customize serialization with JSON-based rules
- 🛠️ Developer-friendly: interactive CLI with tree-formatted change previews

## Installation

```bash
npm install @supabase/pg-delta
```

Or use with `npx`:

```bash
npx @supabase/pg-delta <source> <target>
```

## Quick Start

### CLI Usage

The CLI provides three main commands:

**Sync (default)** - Plan and apply changes in one go:

```bash
pg-delta sync \
  postgresql://user:pass@localhost:5432/source_db \
  postgresql://user:pass@localhost:5432/target_db
```

**Plan** - Preview changes before applying:

```bash
pg-delta plan \
  postgresql://user:pass@localhost:5432/source_db \
  postgresql://user:pass@localhost:5432/target_db \
  --output plan.json
```

**Apply** - Apply a previously created plan:

```bash
pg-delta apply \
  --plan plan.json \
  postgresql://user:pass@localhost:5432/source_db \
  postgresql://user:pass@localhost:5432/target_db
```

### Using Integrations

Use built-in integrations or custom JSON files:

```bash
# Built-in Supabase integration
pg-delta sync <source> <target> --integration supabase

# Custom integration file
pg-delta sync <source> <target> --integration ./my-integration.json
```

### Programmatic Usage

```typescript
import { main } from "@supabase/pg-delta";

const result = await main(
  "postgresql://source",
  "postgresql://target"
);

if (result) {
  console.log(result.migrationScript);
}
```

For plan-based workflow:

```typescript
import { createPlan, applyPlan } from "@supabase/pg-delta";

// Create a plan
const planResult = await createPlan(sourceUrl, targetUrl, {
  filter: { schema: "public" },
  serialize: [{ when: { type: "schema" }, options: { skipAuthorization: true } }]
});

if (planResult) {
  // Apply the plan
  const result = await applyPlan(
    planResult.plan,
    sourceUrl,
    targetUrl
  );
}
```

## Documentation

- [CLI Reference](./docs/cli.md) - Complete CLI documentation with all commands and options
- [API Reference](./docs/api.md) - Programmatic API documentation
- [Integrations](./docs/integrations.md) - Using and creating integrations with the DSL system
- [Sorting & Safety](./docs/sorting.md) - How migrations are ordered for safety

## Key Concepts

### Plan-Based Workflow

`pg-delta` uses a plan-based workflow that provides:

- **Preview before apply**: Review changes before executing them
- **Self-contained plans**: Plans store filtering and serialization rules
- **Reproducibility**: Plans can be version-controlled and shared
- **Safety checks**: Automatic detection of data-loss operations

### Integration DSL

Integrations use a JSON-based DSL for filtering and serialization:

- **Filter DSL**: Pattern matching to include/exclude changes
- **Serialization DSL**: Rules to customize SQL generation
- **Serializable**: Can be stored in plans and passed as CLI flags

See [Integrations Documentation](./docs/integrations.md) for complete details.

## Use Cases

- Generate migrations between environments (dev → staging → production)
- Compare database states and review differences
- Automate migration creation in CI/CD pipelines
- Maintain schema version control with plan files
- Filter platform-specific changes (e.g., Supabase system schemas)

## Contributing

Contributions welcome! Feel free to submit issues and pull requests.

## License

MIT
