# pg-diff

PostgreSQL migrations made easy.

A modern alternative to `pg_dump` that generates migration scripts by diffing PostgreSQL databases.

## Features

- 🔍 Compare databases and generate migration scripts
- 🚀 More powerful than traditional `pg_dump`
- 🔒 Safe and reliable schema evolution
- 🛠️ Developer-friendly workflow
- 🎯 Integration system for platform-specific handling

## Installation

```bash
npm install @supabase/pg-diff
```

## Quick Start

### CLI Usage

```bash
pg-diff diff postgresql://source postgresql://target
```

### Programmatic Usage

```typescript
import { main } from "@supabase/pg-diff";

const result = await main(
  "postgresql://source",
  "postgresql://target"
);

if (result) {
  console.log(result.migrationScript);
}
```

## Documentation

- [CLI Reference](./cli.md) - Complete CLI documentation
- [API Reference](./api.md) - Programmatic API documentation
- [Integrations](./integrations.md) - Using and creating integrations
- [Sorting & Safety](./sorting.md) - How migrations are ordered for safety

## Use Cases

- Generate migrations between environments
- Compare database states
- Automate migration creation
- Maintain schema version control

## Contributing

Contributions welcome! Feel free to submit issues and pull requests.

## License

MIT

