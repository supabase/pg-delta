/** Rule definitions for foreign-data objects: FDWs, servers, user mappings,
 *  and foreign tables. */
import type { StableId } from "../../core/stable-id.ts";
import { alterOptionsClause, lit, optionsClause, qid, rel } from "../render.ts";
import type { KindRules } from "../rules.ts";
import { p, renameRule, str } from "./helpers.ts";

export const foreignRules: Record<string, KindRules> = {
  fdw: {
    weight: 2,
    create: (fact) => {
      const name = qid((fact.id as { name: string }).name);
      let sql = `CREATE FOREIGN DATA WRAPPER ${name}`;
      const handler = p(fact, "handler");
      if (handler != null) sql += ` HANDLER ${str(handler)}`;
      const validator = p(fact, "validator");
      if (validator != null) sql += ` VALIDATOR ${str(validator)}`;
      sql += optionsClause((p(fact, "options") as string[]) ?? []);
      return [{ sql }];
    },
    drop: (fact) => ({
      sql: `DROP FOREIGN DATA WRAPPER ${qid((fact.id as { name: string }).name)}`,
    }),
    ownerAlterPrefix: (fact) =>
      `ALTER FOREIGN DATA WRAPPER ${qid((fact.id as { name: string }).name)}`,
    attributes: {
      options: {
        alter: (fact, from, to) => ({
          sql: `ALTER FOREIGN DATA WRAPPER ${qid((fact.id as { name: string }).name)} ${alterOptionsClause(
            (from as string[] | null) ?? [],
            (to as string[] | null) ?? [],
          )}`,
        }),
      },
      handler: {
        alter: (fact, _from, to) => ({
          sql: `ALTER FOREIGN DATA WRAPPER ${qid((fact.id as { name: string }).name)} ${to == null ? "NO HANDLER" : `HANDLER ${str(to)}`}`,
        }),
      },
      validator: {
        alter: (fact, _from, to) => ({
          sql: `ALTER FOREIGN DATA WRAPPER ${qid((fact.id as { name: string }).name)} ${to == null ? "NO VALIDATOR" : `VALIDATOR ${str(to)}`}`,
        }),
      },
    },
  },

  server: {
    weight: 3,
    create: (fact) => {
      const name = qid((fact.id as { name: string }).name);
      let sql = `CREATE SERVER ${name}`;
      const type = p(fact, "type");
      if (type != null) sql += ` TYPE ${lit(str(type))}`;
      const version = p(fact, "version");
      if (version != null) sql += ` VERSION ${lit(str(version))}`;
      sql += ` FOREIGN DATA WRAPPER ${qid(str(p(fact, "fdw")))}`;
      sql += optionsClause((p(fact, "options") as string[]) ?? []);
      return [{ sql }];
    },
    drop: (fact) => ({
      sql: `DROP SERVER ${qid((fact.id as { name: string }).name)}`,
    }),
    ownerAlterPrefix: (fact) =>
      `ALTER SERVER ${qid((fact.id as { name: string }).name)}`,
    attributes: {
      version: {
        alter: (fact, _from, to) => ({
          sql: `ALTER SERVER ${qid((fact.id as { name: string }).name)} VERSION ${lit(str(to))}`,
        }),
        // PostgreSQL has no ALTER SERVER grammar to UNSET a version, so removing
        // it (to == null) forces a drop + recreate of the server.
        replaceWhen: (_from, to) => to == null,
      },
      options: {
        alter: (fact, from, to) => ({
          sql: `ALTER SERVER ${qid((fact.id as { name: string }).name)} ${alterOptionsClause(
            (from as string[] | null) ?? [],
            (to as string[] | null) ?? [],
          )}`,
        }),
      },
      type: "replace",
      fdw: "replace",
    },
  },

  userMapping: {
    weight: 4,
    create: (fact) => {
      const id = fact.id as { server: string; role: string };
      const roleName = id.role === "PUBLIC" ? "PUBLIC" : qid(id.role);
      return [
        {
          sql: `CREATE USER MAPPING FOR ${roleName} SERVER ${qid(id.server)}${optionsClause((p(fact, "options") as string[]) ?? [])}`,
          ...(id.role === "PUBLIC"
            ? {}
            : { consumes: [{ kind: "role", name: id.role } as StableId] }),
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { server: string; role: string };
      const roleName = id.role === "PUBLIC" ? "PUBLIC" : qid(id.role);
      return {
        sql: `DROP USER MAPPING FOR ${roleName} SERVER ${qid(id.server)}`,
        ...(id.role === "PUBLIC"
          ? {}
          : { consumes: [{ kind: "role", name: id.role } as StableId] }),
      };
    },
    attributes: {
      options: {
        alter: (fact, from, to) => {
          const id = fact.id as { server: string; role: string };
          const roleName = id.role === "PUBLIC" ? "PUBLIC" : qid(id.role);
          return {
            sql: `ALTER USER MAPPING FOR ${roleName} SERVER ${qid(id.server)} ${alterOptionsClause(
              (from as string[] | null) ?? [],
              (to as string[] | null) ?? [],
            )}`,
            ...(id.role === "PUBLIC"
              ? {}
              : { consumes: [{ kind: "role", name: id.role } as StableId] }),
          };
        },
      },
    },
  },

  foreignTable: {
    weight: 5,
    cascadesToChildren: true,
    defaclObjtype: "r",
    rename: renameRule((fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER FOREIGN TABLE ${rel(id.schema, id.name)}`;
    }),
    create: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return [
        {
          sql: `CREATE FOREIGN TABLE ${rel(id.schema, id.name)} () SERVER ${qid(str(p(fact, "server")))}${optionsClause((p(fact, "options") as string[]) ?? [])}`,
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return { sql: `DROP FOREIGN TABLE ${rel(id.schema, id.name)}` };
    },
    ownerAlterPrefix: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER FOREIGN TABLE ${rel(id.schema, id.name)}`;
    },
    attributes: {
      options: {
        alter: (fact, from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER FOREIGN TABLE ${rel(id.schema, id.name)} ${alterOptionsClause(
              (from as string[] | null) ?? [],
              (to as string[] | null) ?? [],
            )}`,
          };
        },
      },
      server: "replace",
    },
  },
};
