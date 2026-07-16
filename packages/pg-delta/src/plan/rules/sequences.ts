/** Rule definitions for sequences. */
import type { StableId } from "../../core/stable-id.ts";
import { rel } from "../render.ts";
import type { KindRules } from "../rules.ts";
import { p, renameRule, sequenceOwnedBySpecs, str } from "./helpers.ts";

export const sequenceRules: Record<string, KindRules> = {
  sequence: {
    weight: 3,
    cascadesToChildren: true,
    defaclObjtype: "S",
    dropRootRedirect: (fact, isRemoved) => {
      const ownedBy = fact.payload["ownedBy"] as {
        schema: string;
        table: string;
        column: string;
      } | null;
      if (ownedBy == null) return undefined;
      const columnId: StableId = {
        kind: "column",
        schema: ownedBy.schema,
        table: ownedBy.table,
        name: ownedBy.column,
      };
      if (isRemoved(columnId)) return columnId;
      const tableId: StableId = {
        kind: "table",
        schema: ownedBy.schema,
        name: ownedBy.table,
      };
      if (isRemoved(tableId)) return tableId;
      return undefined;
    },
    rename: renameRule((fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER SEQUENCE ${rel(id.schema, id.name)}`;
    }),
    create: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return [
        {
          sql:
            `CREATE SEQUENCE ${rel(id.schema, id.name)} AS ${str(p(fact, "dataType"))}` +
            ` INCREMENT BY ${str(p(fact, "increment"))} MINVALUE ${str(p(fact, "minValue"))}` +
            ` MAXVALUE ${str(p(fact, "maxValue"))} START WITH ${str(p(fact, "start"))}` +
            ` CACHE ${str(p(fact, "cache"))} ${p(fact, "cycle") ? "CYCLE" : "NO CYCLE"}`,
        },
        ...sequenceOwnedBySpecs(fact),
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return { sql: `DROP SEQUENCE ${rel(id.schema, id.name)}` };
    },
    ownerAlterPrefix: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER SEQUENCE ${rel(id.schema, id.name)}`;
    },
    attributes: {
      dataType: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} AS ${str(to)}`,
          };
        },
      },
      increment: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} INCREMENT BY ${str(to)}`,
          };
        },
      },
      minValue: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} MINVALUE ${str(to)}`,
          };
        },
      },
      maxValue: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} MAXVALUE ${str(to)}`,
          };
        },
      },
      start: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} START WITH ${str(to)}`,
          };
        },
      },
      cache: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} CACHE ${str(to)}`,
          };
        },
      },
      cycle: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; name: string };
          return {
            sql: `ALTER SEQUENCE ${rel(id.schema, id.name)} ${to ? "CYCLE" : "NO CYCLE"}`,
          };
        },
      },
      ownedBy: {
        alter: (fact, from) =>
          sequenceOwnedBySpecs(fact, {
            allowNone: true,
            releaseOld: from as {
              schema: string;
              table: string;
              column: string;
            } | null,
          }),
      },
    },
  },
};
