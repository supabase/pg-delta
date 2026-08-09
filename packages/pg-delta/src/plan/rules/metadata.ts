/** Rule definitions for metadata satellites: comments, security labels, and
 *  ACL grants. */
import type { Fact } from "../../core/fact.ts";
import type { StableId } from "../../core/stable-id.ts";
import { commentTarget, grantTarget, lit, qid } from "../render.ts";
import type { FactView, KindRules } from "../rules.ts";
import { aggSig, grantActions, p, str } from "./helpers.ts";

/** The COMMENT / SECURITY LABEL signature for an aggregate `target` — the
 *  `direct ORDER BY ordered` form for an ordered-set / hypothetical-set
 *  aggregate, reusing the aggregate DDL's `aggSig`. The aggregate metadata
 *  (aggKind / numDirectArgs) lives on the aggregate FACT, not the target id, so
 *  resolve the fact from whichever view holds it (desired for create/alter,
 *  source for drop). Returns undefined for a non-aggregate target or an
 *  unresolvable one, so `commentTarget` falls back to the plain arg list —
 *  which is already correct for an ordinary aggregate. */
function aggregateTargetSignature(
  target: StableId,
  ...views: (FactView | undefined)[]
): string | undefined {
  if (target.kind !== "aggregate") return undefined;
  for (const view of views) {
    const fact = view?.get(target);
    if (fact !== undefined) return aggSig(fact);
  }
  return undefined;
}

export const metadataRules: Record<string, KindRules> = {
  comment: {
    weight: 20,
    metadata: true,
    create: (fact, view, _params, sourceView) => {
      const target = (fact.id as { target: StableId }).target;
      const opts = {
        domainConstraint: p(fact, "onDomain") === true,
        aggregateSignature: aggregateTargetSignature(target, view, sourceView),
      };
      return [
        {
          sql: `COMMENT ON ${commentTarget(target, opts)} IS ${lit(str(p(fact, "text")))}`,
        },
      ];
    },
    drop: (fact, view) => {
      const target = (fact.id as { target: StableId }).target;
      const opts = {
        domainConstraint: p(fact, "onDomain") === true,
        aggregateSignature: aggregateTargetSignature(target, view),
      };
      return { sql: `COMMENT ON ${commentTarget(target, opts)} IS NULL` };
    },
    attributes: {
      text: {
        alter: (fact, _from, to, view, sourceView) => {
          const target = (fact.id as { target: StableId }).target;
          const opts = {
            domainConstraint: p(fact, "onDomain") === true,
            aggregateSignature: aggregateTargetSignature(
              target,
              view,
              sourceView,
            ),
          };
          return {
            sql: `COMMENT ON ${commentTarget(target, opts)} IS ${lit(str(to))}`,
          };
        },
      },
    },
  },

  // a global satellite rule (like comment): SECURITY LABEL shares COMMENT's
  // ON-target grammar, so it reuses commentTarget. The provider lives in
  // the fact id; the label text is the payload.
  securityLabel: {
    weight: 20,
    metadata: true,
    create: (fact, view, _params, sourceView) => {
      const id = fact.id as { target: StableId; provider: string };
      const opts = {
        aggregateSignature: aggregateTargetSignature(
          id.target,
          view,
          sourceView,
        ),
      };
      return [
        {
          sql: `SECURITY LABEL FOR ${lit(id.provider)} ON ${commentTarget(id.target, opts)} IS ${lit(str(p(fact, "label")))}`,
        },
      ];
    },
    drop: (fact, view) => {
      const id = fact.id as { target: StableId; provider: string };
      const opts = {
        aggregateSignature: aggregateTargetSignature(id.target, view),
      };
      return {
        sql: `SECURITY LABEL FOR ${lit(id.provider)} ON ${commentTarget(id.target, opts)} IS NULL`,
      };
    },
    attributes: {
      label: {
        alter: (fact, _from, to, view, sourceView) => {
          const id = fact.id as { target: StableId; provider: string };
          const opts = {
            aggregateSignature: aggregateTargetSignature(
              id.target,
              view,
              sourceView,
            ),
          };
          return {
            sql: `SECURITY LABEL FOR ${lit(id.provider)} ON ${commentTarget(id.target, opts)} IS ${lit(str(to))}`,
          };
        },
      },
    },
  },

  acl: {
    weight: 21,
    metadata: true,
    create: (fact) => grantActions(fact, "grant"),
    drop: (fact) => {
      const id = fact.id as {
        kind: "acl";
        target: StableId;
        grantee: string;
        column?: string;
      };
      const grantee = id.grantee === "PUBLIC" ? "PUBLIC" : qid(id.grantee);
      const consumes: StableId[] =
        id.grantee === "PUBLIC" ? [] : [{ kind: "role", name: id.grantee }];
      // Column-level grants revoke with the column list; object-level ones don't.
      const revokeAll =
        id.column === undefined
          ? "REVOKE ALL"
          : `REVOKE ALL (${qid(id.column)})`;
      const init = p(fact, "_initPrivs") as
        | { privileges: string[]; grantable: string[] }
        | undefined;
      // Ordinary ACL (or an extension member with NO install grant for this
      // grantee) → a bare REVOKE ALL, byte-identical to grantActions' leading
      // REVOKE so the replace-path drop elision still fires.
      if (init === undefined) {
        return {
          sql: `${revokeAll} ON ${grantTarget(id.target)} FROM ${grantee}`,
          consumes,
        };
      }
      // Extension-member customization removed → revert to the AS-INSTALLED grant
      // (`_initPrivs` from pg_init_privs) rather than stripping the extension's
      // own grant. Emitted as ONE atomic multi-statement action, NOT two graph
      // nodes: the reset REVOKE and the restore GRANT(s) target the same
      // object+grantee and must never be reordered — two nodes carry no ordering
      // edge, so the trailing REVOKE could re-drop the restored grant. Safe
      // because ACL DDL is transactional (the string runs in one implicit
      // transaction); do NOT copy this shape for a nonTransactional action.
      const restore: Fact = {
        id: fact.id,
        payload: { privileges: init.privileges, grantable: init.grantable },
      };
      return {
        sql: grantActions(restore, "grant")
          .map((s) => s.sql)
          .join(";\n"),
        consumes,
      };
    },
    attributes: {
      privileges: "replace",
      grantable: "replace",
    },
  },
};
