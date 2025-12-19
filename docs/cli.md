# CLI Reference

The `pg-delta` CLI provides a command-line interface for generating migration scripts by comparing PostgreSQL databases.

## Installation

```bash
npm install -g @supabase/pg-delta
```

Or use with `npx`:

```bash
npx @supabase/pg-delta sync --source <source> --target <target>
```

## Commands

### `sync` (default)

Plan and apply schema changes in one go with confirmation prompt. This is the default command when no command is specified.

#### Usage

```bash
pg-delta sync --source <source-url> --target <target-url> [options]
# or simply
pg-delta --source <source-url> --target <target-url> [options]
```

#### Options

- `-s, --source <url>` (required): Source database connection URL (current state)
- `-t, --target <url>` (required): Target database connection URL (desired state)
- `--role <role>`: Role to use when executing the migration (SET ROLE will be added to statements)
- `--filter <json>`: Filter DSL as inline JSON to filter changes (e.g., `'{"schema":"public"}'`)
- `--serialize <json>`: Serialize DSL as inline JSON array (e.g., `'[{"when":{"type":"schema"},"options":{"skipAuthorization":true}}]'`)
- `--integration <name|path>`: Integration name (e.g., `supabase`) or path to integration JSON file (must end with `.json`)
- `-y, --yes`: Skip confirmation prompt and apply changes automatically
- `-u, --unsafe`: Allow data-loss operations (unsafe mode)

#### Examples

**Basic usage:**

```bash
pg-delta sync \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db
```

**Skip confirmation:**

```bash
pg-delta sync \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --yes
```

**Use Supabase integration:**

```bash
pg-delta sync \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --integration supabase
```

**Use custom integration file:**

```bash
pg-delta sync \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --integration ./my-integration.json
```

**Filter changes:**

```bash
pg-delta sync \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --filter '{"schema":"public"}'
```

#### Exit Codes

- `0`: Success (changes applied or no changes detected)
- `1`: Error occurred
- `2`: User cancelled or changes detected but not applied

---

### `plan`

Compute schema diff and preview changes. Defaults to tree display; json/sql outputs are available for artifacts or piping.

#### Usage

```bash
pg-delta plan --source <source-url> --target <target-url> [options]
```

#### Options

- `-s, --source <url>` (required): Source database connection URL (current state)
- `-t, --target <url>` (required): Target database connection URL (desired state)
- `-o, --output <file>`: Write output to file (stdout by default). If format is not set: `.sql` infers sql, `.json` infers json, otherwise uses human output
- `--format <format>`: Output format override: `json` (plan) or `sql` (script)
- `--role <role>`: Role to use when executing the migration (SET ROLE will be added to statements)
- `--filter <json>`: Filter DSL as inline JSON to filter changes (e.g., `'{"schema":"public"}'`)
- `--serialize <json>`: Serialize DSL as inline JSON array (e.g., `'[{"when":{"type":"schema"},"options":{"skipAuthorization":true}}]'`)
- `--integration <name|path>`: Integration name (e.g., `supabase`) or path to integration JSON file (must end with `.json`)

#### Examples

**Preview changes (tree format):**

```bash
pg-delta plan \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db
```

**Save plan as JSON:**

```bash
pg-delta plan \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --output plan.json
```

**Generate SQL script:**

```bash
pg-delta plan \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --format sql \
  --output migration.sql
```

**Use integration:**

```bash
pg-delta plan \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --integration supabase \
  --output plan.json
```

#### Exit Codes

- `0`: Success - no changes detected
- `2`: Changes detected (plan generated)
- `1`: Error - command execution failed

---

### `apply`

Apply a plan's migration script to a target database.

#### Usage

```bash
pg-delta apply --plan <plan-file> --source <source-url> --target <target-url> [options]
```

#### Options

- `-p, --plan <file>` (required): Path to plan file (JSON format)
- `-s, --source <url>` (required): Source database connection URL (current state)
- `-t, --target <url>` (required): Target database connection URL (desired state)
- `-u, --unsafe`: Allow data-loss operations (unsafe mode)

#### Examples

**Apply a plan:**

```bash
pg-delta apply \
  --plan plan.json \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db
```

**Apply unsafe plan:**

```bash
pg-delta apply \
  --plan plan.json \
  --source postgresql://user:pass@localhost:5432/source_db \
  --target postgresql://user:pass@localhost:5432/target_db \
  --unsafe
```

#### Exit Codes

- `0`: Success (changes applied)
- `1`: Error occurred

**Note:** Safe by default - will refuse plans containing data-loss unless `--unsafe` is set.

---

## Connection URLs

The connection URL follows the standard PostgreSQL connection string format:

```
postgresql://[user[:password]@][host][:port][/database][?params...]
```

Examples:

- `postgresql://localhost/mydb`
- `postgresql://user:password@localhost:5432/mydb`
- `postgresql://user@localhost/mydb?sslmode=require`

---

## Integrations

Integrations provide pre-configured filter and serialization rules for specific database platforms or use cases. See [Integrations Documentation](./integrations.md) for details.

Available built-in integrations:
- `supabase` - Supabase-specific filtering and serialization rules

You can also create custom integrations by providing a JSON file. See the integrations documentation for the DSL format.

---

## Help

Get help for any command:

```bash
pg-delta --help
pg-delta sync --help
pg-delta plan --help
pg-delta apply --help
```
