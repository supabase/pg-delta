/** Rule definitions for row-level security policies. */
import type { StableId } from "../../core/stable-id.ts";
import { qid, rel } from "../render.ts";
import type { KindRules } from "../rules.ts";
import { p, policySql } from "./helpers.ts";

export const policyRules: Record<string, KindRules> = {
  policy: {
    weight: 16,
    cascadesToChildren: true,
    rebuildable: true,
    // Never fold a policy's drop into its table's DROP (mirrors the FK-constraint
    // exception). A policy's USING / WITH CHECK can reference another object (a
    // view, function, …) dropped separately; PostgreSQL refuses to drop that
    // object while the policy still references it, and the table-cascade would
    // only remove the policy AFTER the table — which itself must drop after the
    // referenced object, forming an unbreakable teardown cycle. An explicit DROP
    // POLICY ordered before the referenced drop makes teardown constructible. A
    // redundant explicit drop (policy with no external reference) is trimmed by
    // the cosmetic elideCascadeSubsumedPolicyDrops compaction pass.
    suppressible: () => false,
    rename: (fact, to) => {
      const id = fact.id as { schema: string; table: string; name: string };
      return {
        sql: `ALTER POLICY ${qid(id.name)} ON ${rel(id.schema, id.table)} RENAME TO ${qid((to as { name: string }).name)}`,
      };
    },
    create: (fact) => {
      const roles = (p(fact, "roles") as string[])
        .filter((r) => r !== "PUBLIC")
        .map((r): StableId => ({ kind: "role", name: r }));
      return [{ sql: policySql(fact), consumes: roles }];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; table: string; name: string };
      return {
        sql: `DROP POLICY ${qid(id.name)} ON ${rel(id.schema, id.table)}`,
      };
    },
    attributes: {
      // USING / WITH CHECK predicates can be ADDED or REMOVED, not merely
      // edited, and PostgreSQL offers no `ALTER POLICY … DROP USING`; an
      // in-place ALTER would crash on the null (clause-removed) transition.
      // Rebuild the (rebuildable) policy instead — exactly how `cmd` and
      // `permissive` below already work, since they have no in-place ALTER.
      usingExpr: "replace",
      checkExpr: "replace",
      roles: {
        alter: (fact, _from, to) => {
          const id = fact.id as { schema: string; table: string; name: string };
          const roles = (to as string[]).map((r) =>
            r === "PUBLIC" ? "PUBLIC" : qid(r),
          );
          return {
            sql: `ALTER POLICY ${qid(id.name)} ON ${rel(id.schema, id.table)} TO ${roles.join(", ")}`,
          };
        },
      },
      cmd: "replace",
      permissive: "replace",
    },
  },
};
