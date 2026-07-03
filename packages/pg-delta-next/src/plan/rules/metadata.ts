/** Rule definitions for metadata satellites: comments, security labels, and
 *  ACL grants. */
import type { Fact } from "../../core/fact.ts";
import type { StableId } from "../../core/stable-id.ts";
import { commentTarget, grantTarget, lit, qid } from "../render.ts";
import type { KindRules } from "../rules.ts";
import { grantActions, p, str } from "./helpers.ts";

export const metadataRules: Record<string, KindRules> = {
  comment: {
    weight: 20,
    metadata: true,
    create: (fact) => {
      const target = (fact.id as { target: StableId }).target;
      const opts = { domainConstraint: p(fact, "onDomain") === true };
      return [
        {
          sql: `COMMENT ON ${commentTarget(target, opts)} IS ${lit(str(p(fact, "text")))}`,
        },
      ];
    },
    drop: (fact) => {
      const target = (fact.id as { target: StableId }).target;
      const opts = { domainConstraint: p(fact, "onDomain") === true };
      return { sql: `COMMENT ON ${commentTarget(target, opts)} IS NULL` };
    },
    attributes: {
      text: {
        alter: (fact, _from, to) => {
          const target = (fact.id as { target: StableId }).target;
          const opts = { domainConstraint: p(fact, "onDomain") === true };
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
    create: (fact) => {
      const id = fact.id as { target: StableId; provider: string };
      return [
        {
          sql: `SECURITY LABEL FOR ${lit(id.provider)} ON ${commentTarget(id.target)} IS ${lit(str(p(fact, "label")))}`,
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { target: StableId; provider: string };
      return {
        sql: `SECURITY LABEL FOR ${lit(id.provider)} ON ${commentTarget(id.target)} IS NULL`,
      };
    },
    attributes: {
      label: {
        alter: (fact, _from, to) => {
          const id = fact.id as { target: StableId; provider: string };
          return {
            sql: `SECURITY LABEL FOR ${lit(id.provider)} ON ${commentTarget(id.target)} IS ${lit(str(to))}`,
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
      const id = fact.id as { kind: "acl"; target: StableId; grantee: string };
      const grantee = id.grantee === "PUBLIC" ? "PUBLIC" : qid(id.grantee);
      const consumes: StableId[] =
        id.grantee === "PUBLIC" ? [] : [{ kind: "role", name: id.grantee }];
      const init = p(fact, "_initPrivs") as
        | { privileges: string[]; grantable: string[] }
        | undefined;
      // Ordinary ACL (or an extension member with NO install grant for this
      // grantee) → a bare REVOKE ALL, byte-identical to grantActions' leading
      // REVOKE so the replace-path drop elision still fires.
      if (init === undefined) {
        return {
          sql: `REVOKE ALL ON ${grantTarget(id.target)} FROM ${grantee}`,
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
