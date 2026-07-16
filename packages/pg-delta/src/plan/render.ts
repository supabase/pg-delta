/** SQL rendering primitives shared by the rule table. */
import type { StableId } from "../core/stable-id.ts";

export function qid(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function lit(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function rel(schema: string, name: string): string {
  return `${qid(schema)}.${qid(name)}`;
}

export function routineSig(id: {
  schema: string;
  name: string;
  args: string[];
}): string {
  return `${rel(id.schema, id.name)}(${id.args.join(", ")})`;
}

/** SQL identity phrase for COMMENT ON / GRANT targets, per target kind.
 *  `opts.domainConstraint` selects the `ON DOMAIN …` form for a constraint that
 *  belongs to a domain (the id shape is identical to a table constraint). */
export function commentTarget(
  id: StableId,
  opts?: { domainConstraint?: boolean },
): string {
  switch (id.kind) {
    case "schema":
      return `SCHEMA ${qid(id.name)}`;
    case "table":
      return `TABLE ${rel(id.schema, id.name)}`;
    case "view":
      return `VIEW ${rel(id.schema, id.name)}`;
    case "materializedView":
      return `MATERIALIZED VIEW ${rel(id.schema, id.name)}`;
    case "sequence":
      return `SEQUENCE ${rel(id.schema, id.name)}`;
    case "index":
      return `INDEX ${rel(id.schema, id.name)}`;
    case "column":
      return `COLUMN ${rel(id.schema, id.table)}.${qid(id.name)}`;
    case "constraint":
      return opts?.domainConstraint
        ? `CONSTRAINT ${qid(id.name)} ON DOMAIN ${rel(id.schema, id.table)}`
        : `CONSTRAINT ${qid(id.name)} ON ${rel(id.schema, id.table)}`;
    case "trigger":
      return `TRIGGER ${qid(id.name)} ON ${rel(id.schema, id.table)}`;
    case "policy":
      return `POLICY ${qid(id.name)} ON ${rel(id.schema, id.table)}`;
    case "function":
      return `FUNCTION ${routineSig(id)}`;
    case "procedure":
      return `PROCEDURE ${routineSig(id)}`;
    case "aggregate":
      // A zero-argument aggregate's signature is `(*)`, not `()` — PostgreSQL
      // requires COMMENT ON / SECURITY LABEL ON AGGREGATE name(*). Ordered-set
      // args (id.args non-empty) render as the plain list, like `aggSig`.
      return `AGGREGATE ${rel(id.schema, id.name)}(${id.args.length > 0 ? id.args.join(", ") : "*"})`;
    case "extension":
      return `EXTENSION ${qid(id.name)}`;
    case "role":
      return `ROLE ${qid(id.name)}`;
    case "domain":
      return `DOMAIN ${rel(id.schema, id.name)}`;
    case "type":
      return `TYPE ${rel(id.schema, id.name)}`;
    case "collation":
      return `COLLATION ${rel(id.schema, id.name)}`;
    case "foreignTable":
      return `FOREIGN TABLE ${rel(id.schema, id.name)}`;
    case "rule":
      return `RULE ${qid(id.name)} ON ${rel(id.schema, id.table)}`;
    case "eventTrigger":
      return `EVENT TRIGGER ${qid(id.name)}`;
    case "publication":
      return `PUBLICATION ${qid(id.name)}`;
    case "subscription":
      return `SUBSCRIPTION ${qid(id.name)}`;
    case "fdw":
      return `FOREIGN DATA WRAPPER ${qid(id.name)}`;
    case "server":
      return `SERVER ${qid(id.name)}`;
    default:
      throw new Error(`commentTarget: unsupported kind ${id.kind}`);
  }
}

/** GRANT/REVOKE object phrase per target kind. */
export function grantTarget(id: StableId): string {
  switch (id.kind) {
    case "table":
    case "view":
    case "materializedView":
      return `TABLE ${rel(id.schema, id.name)}`;
    case "sequence":
      return `SEQUENCE ${rel(id.schema, id.name)}`;
    case "schema":
      return `SCHEMA ${qid(id.name)}`;
    case "procedure":
      return `PROCEDURE ${routineSig(id)}`;
    case "function":
    // aggregates are granted via the FUNCTION form (there is no
    // GRANT ... ON AGGREGATE in PostgreSQL's privilege grammar).
    case "aggregate":
      return `FUNCTION ${routineSig(id)}`;
    case "domain":
    case "type":
      return `TYPE ${rel(id.schema, id.name)}`;
    case "foreignTable":
      return `TABLE ${rel(id.schema, id.name)}`;
    case "fdw":
      return `FOREIGN DATA WRAPPER ${qid(id.name)}`;
    case "server":
      return `FOREIGN SERVER ${qid(id.name)}`;
    default:
      throw new Error(`grantTarget: unsupported kind ${id.kind}`);
  }
}

/** "k=v" option strings (as stored in pg_*options) → OPTIONS clause pieces. */
export function splitOption(opt: string): [key: string, value: string] {
  const i = opt.indexOf("=");
  return i === -1 ? [opt, ""] : [opt.slice(0, i), opt.slice(i + 1)];
}

export function optionsClause(options: string[]): string {
  if (options.length === 0) return "";
  const parts = options.map((opt) => {
    const [key, value] = splitOption(opt);
    return `${qid(key)} ${lit(value)}`;
  });
  return ` OPTIONS (${parts.join(", ")})`;
}

/** ALTER … OPTIONS (ADD/SET/DROP …) clause from old vs new option lists. */
export function alterOptionsClause(
  oldOptions: string[],
  newOptions: string[],
): string {
  const oldMap = new Map(oldOptions.map(splitOption));
  const newMap = new Map(newOptions.map(splitOption));
  const parts: string[] = [];
  for (const [key, value] of newMap) {
    if (!oldMap.has(key)) parts.push(`ADD ${qid(key)} ${lit(value)}`);
    else if (oldMap.get(key) !== value)
      parts.push(`SET ${qid(key)} ${lit(value)}`);
  }
  for (const key of oldMap.keys()) {
    if (!newMap.has(key)) parts.push(`DROP ${qid(key)}`);
  }
  return `OPTIONS (${parts.join(", ")})`;
}
