# Integrations

Integrations allow you to customize how `pg-delta` filters and serializes database changes using a JSON-based DSL (Domain-Specific Language). This enables you to:

- **Filter changes**: Include or exclude specific changes based on patterns
- **Customize serialization**: Control how changes are serialized into SQL (e.g., skip authorization statements)

Integrations are stored as JSON files and can be:
- Loaded from built-in integrations (e.g., `--integration supabase`)
- Loaded from custom files (e.g., `--integration ./my-integration.json`)
- Passed directly via CLI flags (`--filter` and `--serialize`)

## Integration DSL Structure

An integration file is a JSON object with two optional properties:

```json
{
  "filter": { /* Filter DSL */ },
  "serialize": [ /* Serialization DSL */ ]
}
```

- **`filter`**: Determines which changes to include/exclude. If not provided, all changes are included.
- **`serialize`**: Customizes how changes are serialized. If not provided, changes are serialized with default options.

## Filter DSL

The Filter DSL uses pattern matching to determine which changes to include or exclude. Patterns can match against change properties and be combined using logical operators.

### Core Properties

All changes have these core properties:

- **`type`**: The object type (e.g., `"schema"`, `"table"`, `"procedure"`)
- **`operation`**: The operation type (`"create"`, `"alter"`, `"drop"`)
- **`scope`**: The scope of the change (`"object"`, `"comment"`, `"privilege"`, `"membership"`)

### Extracted Properties

These properties are extracted from changes:

- **`schema`**: The schema name (string or array of strings)
- **`owner`**: The owner role name (string or array of strings)
- **`member`**: The member role name (for membership changes, string or array of strings)

### Property Matching

- **String value**: Exact match (e.g., `{ "schema": "public" }`)
- **Array value**: Value must be in the array (e.g., `{ "schema": ["public", "app"] }`)
- **Missing properties**: Don't match (e.g., if a change has no schema, `{ "schema": "public" }` won't match)

### Logical Operators

Patterns can be combined using logical operators:

- **`and`**: All patterns must match (AND logic)
- **`or`**: Any pattern must match (OR logic)
- **`not`**: Negate a pattern (NOT logic)

**Important**: Composition operators (`and`, `or`, `not`) are exclusive - they cannot be mixed with property patterns in the same object.

### Filter DSL Examples

**Include only changes in the public schema:**

```json
{
  "schema": "public"
}
```

**Exclude system schemas:**

```json
{
  "not": {
    "schema": ["pg_catalog", "information_schema"]
  }
}
```

**Include schema creates OR changes in public schema:**

```json
{
  "or": [
    { "type": "schema", "operation": "create" },
    { "schema": "public" }
  ]
}
```

**Exclude changes owned by system roles:**

```json
{
  "not": {
    "owner": ["postgres", "service_role"]
  }
}
```

**Complex filter (include public schema OR exclude system schemas and system owners):**

```json
{
  "or": [
    { "schema": "public" },
    {
      "and": [
        {
          "not": {
            "schema": ["pg_catalog", "information_schema"]
          }
        },
        {
          "not": {
            "owner": ["postgres"]
          }
        }
      ]
    }
  ]
}
```

**Filter membership changes:**

```json
{
  "type": "role",
  "scope": "membership",
  "member": ["app_user"]
}
```

## Serialization DSL

The Serialization DSL is an array of rules that customize how changes are serialized. Rules are evaluated in order, and the first matching rule's options are applied. If no rule matches, the change is serialized with default options.

### Serialization Rule Structure

Each rule has two properties:

- **`when`**: A Filter Pattern that determines when this rule applies
- **`options`**: Serialization options to apply when the pattern matches

### Serialization Options

Currently supported options:

- **`skipAuthorization`** (boolean): Skip authorization statements (e.g., `ALTER ... OWNER TO`)

### Serialization DSL Examples

**Skip authorization for schema creates:**

```json
[
  {
    "when": {
      "type": "schema",
      "operation": "create"
    },
    "options": {
      "skipAuthorization": true
    }
  }
]
```

**Skip authorization for specific owners:**

```json
[
  {
    "when": {
      "owner": ["service_role", "authenticator"]
    },
    "options": {
      "skipAuthorization": true
    }
  }
]
```

**Multiple rules (first match wins):**

```json
[
  {
    "when": {
      "type": "schema",
      "operation": "create",
      "owner": ["service_role"]
    },
    "options": {
      "skipAuthorization": true
    }
  },
  {
    "when": {
      "schema": "public"
    },
    "options": {
      "skipAuthorization": false
    }
  }
]
```

## Complete Integration Example

Here's a complete integration file that combines filtering and serialization:

```json
{
  "filter": {
    "or": [
      {
        "schema": "public"
      },
      {
        "and": [
          {
            "type": "schema",
            "operation": "create"
          },
          {
            "not": {
              "schema": ["pg_catalog", "information_schema"]
            }
          }
        ]
      }
    ]
  },
  "serialize": [
    {
      "when": {
        "type": "schema",
        "operation": "create",
        "owner": ["service_role"]
      },
      "options": {
        "skipAuthorization": true
      }
    }
  ]
}
```

## Using Integrations

### Programmatic Usage

**Using a built-in integration:**

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

**Creating a custom integration:**

```typescript
import { createPlan, type IntegrationDSL } from "@supabase/pg-delta";

const myIntegration: IntegrationDSL = {
  filter: {
    not: {
      schema: ["pg_catalog", "information_schema"],
    },
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

### CLI Usage

**Built-in integration:**

```bash
pg-delta plan \
  --source postgresql://... \
  --target postgresql://... \
  --integration supabase
```

**Custom integration file:**

```bash
pg-delta plan \
  --source postgresql://... \
  --target postgresql://... \
  --integration ./my-integration.json
```

### Via Filter/Serialize Flags

You can also pass filter and serialization DSLs directly:

```bash
pg-delta plan \
  --source postgresql://... \
  --target postgresql://... \
  --filter '{"schema":"public"}' \
  --serialize '[{"when":{"type":"schema"},"options":{"skipAuthorization":true}}]'
```

### Combining Integration with Overrides

When both an integration and explicit flags are provided, the explicit flags take precedence:

```bash
pg-delta plan \
  --source postgresql://... \
  --target postgresql://... \
  --integration supabase \
  --filter '{"schema":"custom"}'  # Overrides integration's filter
```

## Object Types

The following object types can be used in the `type` property:

- `aggregate`
- `collation`
- `composite_type`
- `domain`
- `enum`
- `event_trigger`
- `extension`
- `foreign_data_wrapper`
- `foreign_table`
- `index`
- `language`
- `materialized_view`
- `procedure`
- `publication`
- `range`
- `rls_policy`
- `role`
- `rule`
- `schema`
- `sequence`
- `server`
- `subscription`
- `table`
- `trigger`
- `type`
- `user_mapping`
- `view`

## Operations

The following operations can be used in the `operation` property:

- `create`: Creating a new object
- `alter`: Modifying an existing object
- `drop`: Dropping an object

## Scopes

The following scopes can be used in the `scope` property:

- `object`: Changes to the object itself
- `comment`: Changes to object comments
- `privilege`: Changes to object privileges
- `membership`: Changes to role memberships (for role changes)

## Property Availability

Not all properties are available for all change types:

- **`schema`**: Available for most object types, but not for cluster-wide objects like `role`, `publication`, `subscription`, `foreign_data_wrapper`, `server`, `event_trigger`, `language`
- **`owner`**: Available for most object types, but not for `user_mapping`
- **`member`**: Only available when `scope` is `"membership"` and `type` is `"role"`

If a property is not available for a change type, it will not match any pattern that requires that property.

## Plan Storage

When you create a plan with a DSL-based filter or serializer, those DSLs are stored in the plan file, making plans self-contained. When applying a plan, the same filtering rules that were used to create it are automatically applied.

This means:
- Plans are reproducible - they contain all the filtering logic used to create them
- Plans can be shared and applied without needing to remember the original filter/serialize flags
- Plans are version-controlled friendly - the JSON format is human-readable

## Built-in Integrations

### Supabase Integration

The `supabase` integration provides filtering and serialization rules optimized for Supabase databases:

- **Filter**: Excludes Supabase system schemas and roles, includes user schemas and extensions
- **Serialize**: Skips authorization for schema creates owned by Supabase system roles

**CLI usage:**

```bash
pg-delta plan --source <source> --target <target> --integration supabase
```

**Programmatic usage:**

```typescript
import { createPlan } from "@supabase/pg-delta";
import { supabase } from "@supabase/pg-delta/integrations/supabase";

const result = await createPlan(sourceUrl, targetUrl, {
  filter: supabase.filter,
  serialize: supabase.serialize,
});
```

See `src/core/integrations/supabase.ts` for the complete integration definition.
