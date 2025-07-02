export const OBJECT_KIND_PREFIX = {
  collations: "collation",
  compositeTypes: "compositeType",
  constraints: "constraint",
  domains: "domain",
  enums: "enum",
  extensions: "extension",
  functions: "function",
  indexes: "index",
  materializedViews: "materializedView",
  privileges: "privilege",
  rlsPolicies: "rlsPolicy",
  schemas: "schema",
  sequences: "sequence",
  tables: "table",
  triggers: "trigger",
  types: "type",
  views: "view",
} as const;

export const DEPENDENCY_KIND_PREFIX = {
  c: "compositeType",
  f: "function",
  m: "materializedView",
  r: "table",
  v: "view",
} as const;
