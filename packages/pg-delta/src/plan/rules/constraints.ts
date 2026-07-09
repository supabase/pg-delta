/** Rule definitions for table / domain constraints. */
import { qid } from "../render.ts";
import type { KindRules } from "../rules.ts";
import { constraintTarget, p, str } from "./helpers.ts";

export const constraintRules: Record<string, KindRules> = {
  constraint: {
    weight: 10,
    cascadesToChildren: true,
    rebuildable: true,
    suppressible: (fact) => fact.payload["type"] !== "f",
    rename: (fact, to) => {
      const id = fact.id as { name: string };
      return {
        sql: `${constraintTarget(fact)} RENAME CONSTRAINT ${qid(id.name)} TO ${qid((to as { name: string }).name)}`,
      };
    },
    create: (fact) => {
      const id = fact.id as { schema: string; table: string; name: string };
      const target = constraintTarget(fact);
      let sql = `${target} ADD CONSTRAINT ${qid(id.name)} ${str(p(fact, "def"))}`;
      if (!p(fact, "validated") && !str(p(fact, "def")).includes("NOT VALID")) {
        sql += " NOT VALID";
      }
      // Inline-fold hint (compaction §3.6, constraint folding): a VALIDATED
      // TABLE constraint can render inline inside its table's CREATE parens as
      // `CONSTRAINT name <def>` (pg_get_constraintdef text, verbatim). Data
      // only — the fold pass applies it solely under
      // `PlanOptions.foldConstraints` (set by `schema export`, whose files are
      // loaded by the retry/reorder loader, not the apply executor). NOT VALID
      // constraints never hint: an inline constraint always validates.
      const foldHint =
        p(fact, "validated") === true && fact.parent?.kind === "table"
          ? {
              compaction: {
                foldInto: fact.parent,
                clause: `CONSTRAINT ${qid(id.name)} ${str(p(fact, "def"))}`,
              },
            }
          : {};
      // ADD FOREIGN KEY takes SHARE ROW EXCLUSIVE (both tables), weaker
      // than the ACCESS EXCLUSIVE default for other constraint forms
      return [
        {
          sql,
          ...(p(fact, "type") === "f"
            ? { lockClass: "shareRowExclusive" as const }
            : {}),
          ...foldHint,
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; table: string; name: string };
      return {
        sql: `${constraintTarget(fact)} DROP CONSTRAINT ${qid(id.name)}`,
      };
    },
    attributes: {
      def: "replace",
      type: "replace",
      validated: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; table: string; name: string };
          if (!to)
            throw new Error("constraint cannot be de-validated in place");
          return {
            sql: `${constraintTarget(fact)} VALIDATE CONSTRAINT ${qid(id.name)}`,
            lockClass: "shareUpdateExclusive",
          };
        },
      },
    },
  },
};
