/** Rule definitions for views, materialized views, and rewrite rules. */
import { qid, rel } from "../render.ts";
import type { ActionSpec, KindRules } from "../rules.ts";
import {
  enabledPhrase,
  p,
  reloptionsAlterSpecs,
  reloptionsWithClause,
  renameRule,
  str,
} from "./helpers.ts";

export const viewRules: Record<string, KindRules> = {
  view: {
    weight: 12,
    cascadesToChildren: true,
    rebuildable: true,
    defaclObjtype: "r",
    rename: renameRule((fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER VIEW ${rel(id.schema, id.name)}`;
    }),
    create: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return [
        {
          sql: `CREATE VIEW ${rel(id.schema, id.name)}${reloptionsWithClause(fact)} AS ${str(p(fact, "def"))}`,
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return { sql: `DROP VIEW ${rel(id.schema, id.name)}` };
    },
    ownerAlterPrefix: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER VIEW ${rel(id.schema, id.name)}`;
    },
    attributes: {
      def: "replace",
      reloptions: {
        alter: (fact, from, to) => {
          const id = fact.id as { schema: string; name: string };
          return reloptionsAlterSpecs(
            `ALTER VIEW ${rel(id.schema, id.name)}`,
            from,
            to,
          );
        },
      },
    },
  },

  materializedView: {
    weight: 13,
    cascadesToChildren: true,
    rebuildable: true,
    defaclObjtype: "r",
    rename: renameRule((fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER MATERIALIZED VIEW ${rel(id.schema, id.name)}`;
    }),
    create: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return [
        {
          sql: `CREATE MATERIALIZED VIEW ${rel(id.schema, id.name)}${reloptionsWithClause(fact)} AS ${str(p(fact, "def"))}`,
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return {
        sql: `DROP MATERIALIZED VIEW ${rel(id.schema, id.name)}`,
        dataLoss: "destructive",
      };
    },
    ownerAlterPrefix: (fact) => {
      const id = fact.id as { schema: string; name: string };
      return `ALTER MATERIALIZED VIEW ${rel(id.schema, id.name)}`;
    },
    attributes: {
      def: "replace",
      reloptions: {
        alter: (fact, from, to) => {
          const id = fact.id as { schema: string; name: string };
          return reloptionsAlterSpecs(
            `ALTER MATERIALIZED VIEW ${rel(id.schema, id.name)}`,
            from,
            to,
          );
        },
      },
    },
  },

  rule: {
    weight: 15,
    cascadesToChildren: true,
    rebuildable: true,
    create: (fact) => {
      const id = fact.id as { schema: string; table: string; name: string };
      // A fresh CREATE RULE always lands ENABLED (origin). When the desired rule
      // is disabled/replica/always, append the follow-up ALTER so the hashed
      // ev_enabled state converges — mirrors the trigger create path.
      const specs: ActionSpec[] = [{ sql: str(p(fact, "def")) }];
      const enabled = p(fact, "enabled");
      if (enabled != null && enabled !== "O") {
        specs.push({
          sql: `ALTER TABLE ${rel(id.schema, id.table)} ${enabledPhrase(str(enabled))} RULE ${qid(id.name)}`,
        });
      }
      return specs;
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; table: string; name: string };
      return {
        sql: `DROP RULE ${qid(id.name)} ON ${rel(id.schema, id.table)}`,
      };
    },
    attributes: {
      def: "replace",
      enabled: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; table: string; name: string };
          return {
            sql: `ALTER TABLE ${rel(id.schema, id.table)} ${enabledPhrase(str(to))} RULE ${qid(id.name)}`,
          };
        },
      },
    },
  },
};
