/**
 * The generative engine (stage 3/stage 5 deliverable 9): seeded random
 * schema pairs for the proof-loop soak. The generator emits SQL (Postgres
 * elaborates it — P1 holds even here) and mutates a copy to produce the
 * desired state, so every generated pair exercises diff/plan/prove in
 * both directions.
 *
 * KIND_COVERAGE is the stage-10 checklist: a soak only counts if the
 * generator emits every supported kind. Cluster-scoped kinds are excluded
 * deliberately (they leak across the shared cluster); the corpus's
 * isolated-cluster scenarios cover them.
 */

export const KIND_COVERAGE: Record<string, boolean | string> = {
  schema: true,
  table: true,
  column: true,
  default: true,
  constraint: true, // pk, fk, check, unique
  index: true,
  sequence: true,
  view: true,
  materializedView: true,
  function: true,
  procedure:
    "covered by corpus procedure-operations scenarios; the soak generator emits only CREATE FUNCTION",
  aggregate: true,
  trigger: true,
  policy: true,
  rule: true,
  domain: true,
  type: true, // enum + composite + range
  collation: true,
  comment: true,
  acl: "implicit — acldefault facts ride on every object",
  eventTrigger: "excluded: database-wide firing leaks across parallel tests",
  extension: "excluded: image-dependent availability",
  role: "excluded: cluster-scoped (corpus isolated-cluster scenarios cover)",
  membership: "excluded: cluster-scoped",
  defaultPrivilege: "excluded: cluster-scoped",
  publication: "excluded: interacts with concurrent generative drops",
  subscription: "excluded: cluster-scoped (replication slots)",
  fdw: "excluded: needs extension",
  server: "excluded: needs extension",
  userMapping: "excluded: needs extension",
};

/** mulberry32 — tiny deterministic PRNG; the seed IS the repro case. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Gen {
  random: () => number;
  statements: string[];
  tables: Array<{ schema: string; name: string; columns: string[] }>;
  enums: Array<{ schema: string; name: string; values: string[] }>;
  sequences: Array<{ schema: string; name: string }>;
  functions: Array<{ schema: string; name: string }>;
}

const pick = <T>(g: Gen, items: T[]): T =>
  items[Math.floor(g.random() * items.length)] as T;
const chance = (g: Gen, p: number): boolean => g.random() < p;

const COLUMN_TYPES = [
  "integer",
  "bigint",
  "text",
  "numeric(12,3)",
  "boolean",
  "timestamptz",
  "date",
  "jsonb",
  "uuid",
];

function genSchema(g: Gen, name: string): void {
  g.statements.push(`CREATE SCHEMA ${name};`);

  if (chance(g, 0.7)) {
    const enumName = `${name}_status`;
    const values = ["draft", "active", "done", "archived"].slice(
      0,
      2 + Math.floor(g.random() * 3),
    );
    g.statements.push(
      `CREATE TYPE ${name}.${enumName} AS ENUM (${values.map((v) => `'${v}'`).join(", ")});`,
    );
    g.enums.push({ schema: name, name: enumName, values });
  }
  if (chance(g, 0.3)) {
    g.statements.push(`CREATE TYPE ${name}.pair AS (x integer, y integer);`);
  }
  if (chance(g, 0.25)) {
    g.statements.push(`CREATE TYPE ${name}.span AS RANGE (SUBTYPE = numeric);`);
  }
  if (chance(g, 0.4)) {
    g.statements.push(
      `CREATE DOMAIN ${name}.positive AS integer CHECK (VALUE > 0);`,
    );
  }
  if (chance(g, 0.2)) {
    g.statements.push(
      `CREATE COLLATION ${name}.c_icu (PROVIDER = icu, LOCALE = 'en-US');`,
    );
  }
  if (chance(g, 0.5)) {
    const seq = `${name}_seq`;
    g.statements.push(
      `CREATE SEQUENCE ${name}.${seq} START ${1 + Math.floor(g.random() * 100)};`,
    );
    g.sequences.push({ schema: name, name: seq });
  }

  const tableCount = 1 + Math.floor(g.random() * 3);
  for (let t = 0; t < tableCount; t++) {
    const tableName = `t${t}`;
    const columns: string[] = ["id integer NOT NULL"];
    const colNames = ["id"];
    const colCount = 1 + Math.floor(g.random() * 4);
    for (let c = 0; c < colCount; c++) {
      const colName = `c${c}`;
      let type = pick(g, COLUMN_TYPES);
      if (chance(g, 0.2) && g.enums.some((e) => e.schema === name)) {
        const e = pick(
          g,
          g.enums.filter((x) => x.schema === name),
        );
        type = `${e.schema}.${e.name}`;
        columns.push(
          `${colName} ${type}${chance(g, 0.5) ? ` DEFAULT '${e.values[0]}'` : ""}`,
        );
      } else {
        const withDefault =
          chance(g, 0.3) && type === "integer" ? " DEFAULT 0" : "";
        const notNull = chance(g, 0.2) && withDefault ? " NOT NULL" : "";
        columns.push(`${colName} ${type}${withDefault}${notNull}`);
      }
      colNames.push(colName);
    }
    columns.push(`PRIMARY KEY (id)`);
    g.statements.push(
      `CREATE TABLE ${name}.${tableName} (${columns.join(", ")});`,
    );
    g.tables.push({ schema: name, name: tableName, columns: colNames });

    if (chance(g, 0.5) && colNames.length > 1) {
      g.statements.push(
        `CREATE INDEX ${tableName}_idx_${t} ON ${name}.${tableName} (${colNames[1]});`,
      );
    }
    if (chance(g, 0.35) && g.tables.length > 1) {
      const target = pick(g, g.tables.slice(0, -1));
      g.statements.push(
        `ALTER TABLE ${name}.${tableName} ADD CONSTRAINT ${tableName}_fk_${t} FOREIGN KEY (id) REFERENCES ${target.schema}.${target.name}(id);`,
      );
    }
    if (chance(g, 0.3)) {
      g.statements.push(
        `ALTER TABLE ${name}.${tableName} ADD CONSTRAINT ${tableName}_ck CHECK (id >= 0);`,
      );
    }
    if (chance(g, 0.3)) {
      g.statements.push(
        `COMMENT ON TABLE ${name}.${tableName} IS 'generated ${tableName}';`,
      );
    }
    if (chance(g, 0.25)) {
      g.statements.push(
        `ALTER TABLE ${name}.${tableName} ENABLE ROW LEVEL SECURITY;`,
        `CREATE POLICY p_${tableName} ON ${name}.${tableName} FOR SELECT USING (id > 0);`,
      );
    }
    if (chance(g, 0.25)) {
      g.statements.push(
        `CREATE RULE r_${tableName} AS ON DELETE TO ${name}.${tableName} DO ALSO NOTHING;`,
      );
    }
  }

  if (chance(g, 0.6) && g.tables.some((t) => t.schema === name)) {
    const t = pick(
      g,
      g.tables.filter((x) => x.schema === name),
    );
    g.statements.push(
      `CREATE VIEW ${name}.v_${t.name} AS SELECT id FROM ${t.schema}.${t.name} WHERE id > 0;`,
    );
  }
  if (chance(g, 0.3) && g.tables.some((t) => t.schema === name)) {
    const t = pick(
      g,
      g.tables.filter((x) => x.schema === name),
    );
    g.statements.push(
      `CREATE MATERIALIZED VIEW ${name}.mv_${t.name} AS SELECT id FROM ${t.schema}.${t.name};`,
    );
  }
  if (chance(g, 0.6)) {
    const fn = `f_${name}`;
    g.statements.push(
      `CREATE FUNCTION ${name}.${fn}(a integer) RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT a * 2';`,
    );
    g.functions.push({ schema: name, name: fn });
  }
  if (chance(g, 0.3)) {
    g.statements.push(
      `CREATE AGGREGATE ${name}.agg_sum (integer) (SFUNC = int4pl, STYPE = integer, INITCOND = '0');`,
    );
  }
  if (chance(g, 0.35) && g.tables.some((t) => t.schema === name)) {
    const t = pick(
      g,
      g.tables.filter((x) => x.schema === name),
    );
    g.statements.push(
      `CREATE FUNCTION ${name}.tg_${t.name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;`,
      `CREATE TRIGGER trg_${t.name} BEFORE INSERT ON ${t.schema}.${t.name} FOR EACH ROW EXECUTE FUNCTION ${name}.tg_${t.name}();`,
    );
  }
}

/** Mutations applied to the BASE statements to derive the desired state. */
function mutate(g: Gen, base: string[]): string[] {
  const out = [...base];
  // drop a random non-schema statement (dependents may break the script —
  // mutations operate on the SQL, Postgres adjudicates; a script that
  // fails to load is regenerated by the caller)
  if (chance(g, 0.5) && out.length > 3) {
    const idx = 1 + Math.floor(g.random() * (out.length - 1));
    const victim = out[idx] as string;
    if (!victim.startsWith("CREATE SCHEMA")) out.splice(idx, 1);
  }
  // append additions
  const schemaMatch = /CREATE SCHEMA (\w+);/.exec(out[0] ?? "");
  const schema = schemaMatch?.[1] ?? "gen0";
  if (chance(g, 0.8)) {
    out.push(
      `CREATE TABLE ${schema}.added_t (id integer PRIMARY KEY, note text DEFAULT 'x');`,
    );
  }
  if (chance(g, 0.5)) {
    out.push(`CREATE SEQUENCE ${schema}.added_seq START 9;`);
  }
  if (chance(g, 0.4)) {
    out.push(
      `CREATE FUNCTION ${schema}.added_f() RETURNS integer LANGUAGE sql AS 'SELECT 41';`,
    );
  }
  // in-place alters expressed as desired-state differences
  if (chance(g, 0.5)) {
    out.push(`COMMENT ON SCHEMA ${schema} IS 'mutated';`);
  }
  return out;
}

export interface GeneratedPair {
  seed: number;
  a: string;
  b: string;
}

export function generatePair(seed: number): GeneratedPair {
  const random = rng(seed);
  const g: Gen = {
    random,
    statements: [],
    tables: [],
    enums: [],
    sequences: [],
    functions: [],
  };
  const schemaCount = 1 + Math.floor(random() * 2);
  for (let i = 0; i < schemaCount; i++) genSchema(g, `gen${i}`);
  const a = g.statements.join("\n");
  const b = mutate(g, g.statements).join("\n");
  return { seed, a, b };
}
