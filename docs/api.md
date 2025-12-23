# API Reference

The `@supabase/pg-delta` package provides a programmatic API for generating and applying migration plans.

## Installation

```bash
npm install @supabase/pg-delta
```

## Quick Start

```typescript
import { createPlan, applyPlan } from "@supabase/pg-delta";
import { supabase } from "@supabase/pg-delta/integrations/supabase";

// Create a migration plan
const result = await createPlan(
  "postgresql://localhost:5432/source_db",
  "postgresql://localhost:5432/target_db",
  { filter: supabase.filter, serialize: supabase.serialize }
);

if (result) {
  const { plan } = result;
  console.log(plan.statements); // SQL statements to execute

  // Apply the plan
  const applyResult = await applyPlan(
    plan,
    "postgresql://localhost:5432/source_db",
    "postgresql://localhost:5432/target_db"
  );
  console.log(applyResult.status);
}
```

## Exports

### Main Entry Point

```typescript
import {
  createPlan,
  applyPlan,
  type Plan,
  type CreatePlanOptions,
  type IntegrationDSL,
} from "@supabase/pg-delta";
```

### Integrations

```typescript
import { supabase } from "@supabase/pg-delta/integrations/supabase";
```

## Functions

### `createPlan(source, target, options?)`

Create a migration plan by comparing two databases.

#### Parameters

- `source` (string | Sql): Source database connection URL or postgres.js client (current state)
- `target` (string | Sql): Target database connection URL or postgres.js client (desired state)
- `options` (CreatePlanOptions, optional): Configuration options

#### Returns

`Promise<{ plan: Plan; sortedChanges: Change[]; ctx: DiffContext } | null>`

- Returns an object with the plan and metadata if there are changes
- Returns `null` if databases are identical

#### Example

```typescript
import { createPlan } from "@supabase/pg-delta";

const result = await createPlan(
  process.env.SOURCE_DB_URL!,
  process.env.TARGET_DB_URL!
);

if (result) {
  console.log(`Found ${result.plan.statements.length} statements`);
  console.log(result.plan.statements.join(";\n"));
} else {
  console.log("No differences found");
}
```

---

### `applyPlan(plan, source, target, options?)`

Apply a plan's SQL statements to a database with integrity checks. Validates fingerprints before and after application to ensure plan integrity.

#### Parameters

- `plan` (Plan): The migration plan to apply
- `source` (string | Sql): Source database connection URL or postgres.js client
- `target` (string | Sql): Target database connection URL or postgres.js client
- `options` (ApplyPlanOptions, optional): Configuration options
  - `verifyPostApply` (boolean, default: true): Verify fingerprint after applying

#### Returns

`Promise<ApplyPlanResult>`

The result is a discriminated union with the following possible statuses:

```typescript
type ApplyPlanResult =
  | { status: "invalid_plan"; message: string }
  | { status: "fingerprint_mismatch"; current: string; expected: string }
  | { status: "already_applied" }
  | { status: "applied"; statements: number; warnings?: string[] }
  | { status: "failed"; error: unknown; script: string };
```

#### Example

```typescript
import { createPlan, applyPlan } from "@supabase/pg-delta";

const result = await createPlan(sourceUrl, targetUrl);

if (result) {
  const applyResult = await applyPlan(result.plan, sourceUrl, targetUrl);

  switch (applyResult.status) {
    case "applied":
      console.log(`Applied ${applyResult.statements} statements`);
      break;
    case "already_applied":
      console.log("Plan already applied");
      break;
    case "fingerprint_mismatch":
      console.error("Source database has changed since plan was created");
      break;
    case "failed":
      console.error("Failed to apply:", applyResult.error);
      break;
  }
}
```

## Types

### `Plan`

A migration plan containing all changes to transform one database schema into another.

```typescript
interface Plan {
  version: number;
  toolVersion?: string;
  source: { fingerprint: string };
  target: { fingerprint: string };
  statements: string[];
  role?: string;
  filter?: FilterDSL;
  serialize?: SerializeDSL;
  risk?: { level: "safe" } | { level: "data_loss"; statements: string[] };
}
```

### `CreatePlanOptions`

Options for creating a plan.

```typescript
interface CreatePlanOptions {
  /** Filter - either FilterDSL (stored in plan) or ChangeFilter function (not stored) */
  filter?: FilterDSL | ChangeFilter;
  /** Serialize - either SerializeDSL (stored in plan) or ChangeSerializer function (not stored) */
  serialize?: SerializeDSL | ChangeSerializer;
  /** Role to use when executing the migration (SET ROLE will be added to statements) */
  role?: string;
}
```

### `IntegrationDSL`

A serializable representation of an integration combining filter and serialization options.

```typescript
type IntegrationDSL = {
  /** Filter DSL - determines which changes to include/exclude */
  filter?: FilterDSL;
  /** Serialization DSL - customizes how changes are serialized */
  serialize?: SerializeDSL;
};
```

See [Integrations](./integrations.md) for the full DSL documentation.

## Using Integrations

Integrations provide pre-configured filter and serialize options. Use them by spreading their properties into `CreatePlanOptions`:

```typescript
import { createPlan } from "@supabase/pg-delta";
import { supabase } from "@supabase/pg-delta/integrations/supabase";

// Use the supabase integration
const result = await createPlan(sourceUrl, targetUrl, {
  filter: supabase.filter,
  serialize: supabase.serialize,
});
```

### Custom Integration

You can create your own integration using the `IntegrationDSL` type:

```typescript
import { createPlan, type IntegrationDSL } from "@supabase/pg-delta";

const myIntegration: IntegrationDSL = {
  filter: {
    schema: "public",
  },
  serialize: [
    {
      when: { type: "schema", operation: "create" },
      options: { skipAuthorization: true },
    },
  ],
};

const result = await createPlan(sourceUrl, targetUrl, {
  filter: myIntegration.filter,
  serialize: myIntegration.serialize,
});
```

## Error Handling

Both `createPlan` and `applyPlan` may throw errors for connection failures or database query errors. Always wrap calls in try-catch blocks:

```typescript
try {
  const result = await createPlan(sourceUrl, targetUrl);
  // Handle result
} catch (error) {
  console.error("Failed to create plan:", error);
  process.exit(1);
}
```

## Examples

### Basic Migration

```typescript
import { createPlan, applyPlan } from "@supabase/pg-delta";

async function migrate() {
  const sourceUrl = process.env.SOURCE_DB_URL!;
  const targetUrl = process.env.TARGET_DB_URL!;

  const result = await createPlan(sourceUrl, targetUrl);

  if (!result) {
    console.log("No differences found");
    return;
  }

  console.log("Migration plan:");
  console.log(result.plan.statements.join(";\n"));

  const applyResult = await applyPlan(result.plan, sourceUrl, targetUrl);

  if (applyResult.status === "applied") {
    console.log(`Successfully applied ${applyResult.statements} statements`);
  }
}
```

### With Supabase Integration

```typescript
import { createPlan, applyPlan } from "@supabase/pg-delta";
import { supabase } from "@supabase/pg-delta/integrations/supabase";

const result = await createPlan(sourceUrl, targetUrl, {
  filter: supabase.filter,
  serialize: supabase.serialize,
});

if (result) {
  await applyPlan(result.plan, sourceUrl, targetUrl);
}
```

### With Role

```typescript
import { createPlan } from "@supabase/pg-delta";

// SET ROLE will be added to the beginning of the migration
const result = await createPlan(sourceUrl, targetUrl, {
  role: "postgres",
});
```

### Filtering by Schema

```typescript
import { createPlan } from "@supabase/pg-delta";

// Only include changes in the public schema
const result = await createPlan(sourceUrl, targetUrl, {
  filter: { schema: "public" },
});
```
