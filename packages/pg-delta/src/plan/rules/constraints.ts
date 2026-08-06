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
      // `CONSTRAINT name <def>` (pg_get_constraintdef text, verbatim). NOT
      // VALID constraints never hint: an inline constraint always validates.
      //
      // `executorSafe` marks the SELF-CONTAINED types (PRIMARY KEY / UNIQUE /
      // CHECK — never a reference to another relation's rows), whose fold is
      // legal in a regular diff plan run by the apply executor under the
      // strict crossing veto. FOREIGN KEY (and exclusion) hints stay
      // export-only (`PlanOptions.foldConstraints`, set by `schema export`,
      // whose files are loaded by the retry/reorder loader): a folded FK may
      // reference a table created later, and folding one that happens to sort
      // earlier would make plan shape position-dependent and hide the FK's
      // distinct shareRowExclusive lock on the REFERENCED table from the
      // safety report.
      const type = str(p(fact, "type"));
      const foldHint =
        p(fact, "validated") === true && fact.parent?.kind === "table"
          ? {
              compaction: {
                foldInto: fact.parent,
                clause: `CONSTRAINT ${qid(id.name)} ${str(p(fact, "def"))}`,
                ...(type === "p" || type === "u" || type === "c"
                  ? { executorSafe: true }
                  : {}),
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
          const target = constraintTarget(fact);
          if (!to) {
            // VALIDATED → NOT VALID: PostgreSQL has no ALTER form to
            // de-validate a constraint in place — only ADD CONSTRAINT …
            // NOT VALID accepts it. Replace the constraint itself (drop +
            // re-add), mirroring create()'s NOT VALID suffixing (defensive
            // guard against a def that already carries the text).
            const defText = str(p(fact, "def"));
            const addSql = !defText.includes("NOT VALID")
              ? `${defText} NOT VALID`
              : defText;
            return [
              { sql: `${target} DROP CONSTRAINT ${qid(id.name)}` },
              {
                sql: `${target} ADD CONSTRAINT ${qid(id.name)} ${addSql}`,
                ...(p(fact, "type") === "f"
                  ? { lockClass: "shareRowExclusive" as const }
                  : {}),
              },
            ];
          }
          return {
            sql: `${target} VALIDATE CONSTRAINT ${qid(id.name)}`,
            lockClass: "shareUpdateExclusive",
          };
        },
      },
    },
  },
};
