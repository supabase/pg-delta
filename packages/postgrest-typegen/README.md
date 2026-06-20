# @supabase/postgrest-typegen

Type generation for [PostgREST](https://postgrest.org) from a PostgreSQL
schema. This is the type-generation engine behind `supabase gen types`,
extracted from [postgres-meta](https://github.com/supabase/postgres-meta) into a
small, driver-agnostic library.

> **Status:** alpha. The public API is settling as generators and introspection
> are ported. See the [pg-toolbelt](https://github.com/supabase/pg-toolbelt)
> repo for progress.

## Design

There is a hard split between **introspection** (database → metadata) and
**generation** (metadata → string):

```ts
import { introspect } from "@supabase/postgrest-typegen/introspection";
import { generateTypescript } from "@supabase/postgrest-typegen/generation";

// Any `pg.Pool` / `pg.Client` (or compatible driver) works here.
const metadata = await introspect(pool, { includedSchemas: ["public"] });
const types = await generateTypescript(metadata, { postgrestVersion: "12" });
```

`GeneratorMetadata` is the pluggable contract: the SQL introspector is the
default producer, but any source that can produce that shape can feed the
generators.

### Runtime validation (opt-in)

`GeneratorMetadata` is backed by an [ArkType](https://arktype.io) schema, so a
result coming from a custom/injected producer can be validated at runtime
rather than blindly cast. `introspect()` does **not** validate — wrap its
result yourself when you want the guarantee:

```ts
import { parseGeneratorMetadata, generatorMetadataSchema } from "@supabase/postgrest-typegen";

// Throws a TypeError with a readable summary if the shape is wrong.
const metadata = parseGeneratorMetadata(await someCustomIntrospector(db));

// Or use the raw schema directly for custom flows.
const out = generatorMetadataSchema(unknownInput);
```

### Generators

```ts
import {
  generateTypescript, // async (uses prettier)
  generateGo,
  generatePython,
  generateSwift,
} from "@supabase/postgrest-typegen/generation";
```

| Function             | Options                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `generateTypescript` | `{ detectOneToOneRelationships?, postgrestVersion?, defaultSchema? }`    |
| `generateGo`         | —                                                                       |
| `generatePython`     | —                                                                       |
| `generateSwift`      | `{ accessControl?: 'internal' \| 'public' \| 'private' \| 'package' }`   |

## Installation

```bash
npm install @supabase/postgrest-typegen
# pg is a peer of your application, not bundled here
npm install pg
```

## License

MIT
