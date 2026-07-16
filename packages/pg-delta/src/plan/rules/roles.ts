/** Rule definitions for cluster-level role objects: roles, role memberships,
 *  and default privileges. */
import type { Fact } from "../../core/fact.ts";
import type { PayloadValue } from "../../core/hash.ts";
import { lit, qid, splitOption } from "../render.ts";
import type { ActionSpec, KindRules } from "../rules.ts";
import {
  defaultPrivilegeCreateActions,
  defaultPrivilegeDropActions,
  p,
  renameRule,
  ROLE_FLAGS,
  roleFlagSql,
} from "./helpers.ts";

/** `ALTER ROLE <role> SET <key> TO <value>` — the single rendering of a role
 *  GUC config entry, shared by the create rule (materializing config on a fresh
 *  role) and the config set-delta alter (changing it later). `role` is already
 *  quoted by the caller. */
function roleConfigSetSql(role: string, key: string, value: string): string {
  return `ALTER ROLE ${role} SET ${qid(key)} TO ${lit(value)}`;
}

export const roleRules: Record<string, KindRules> = {
  role: {
    weight: 0,
    rename: renameRule(
      (fact) => `ALTER ROLE ${qid((fact.id as { name: string }).name)}`,
    ),
    // a create rule must materialize EVERY payload attribute not carried by a
    // child fact or edge: CREATE ROLE … WITH <flags>, then one
    // `ALTER ROLE … SET` per desired config entry (review P1 — creating a
    // configured role must not drop its GUC config). Follow-up actions consume
    // the role fact so they order after the CREATE.
    create: (fact) => {
      const role = qid((fact.id as { name: string }).name);
      const specs: ActionSpec[] = [
        { sql: `CREATE ROLE ${role} WITH ${roleFlagSql(fact.payload)}` },
      ];
      for (const entry of (p(fact, "config") as string[] | null) ?? []) {
        const [key, value] = splitOption(entry);
        specs.push({ sql: roleConfigSetSql(role, key, value) });
      }
      return specs;
    },
    drop: (fact) => {
      const name = qid((fact.id as { name: string }).name);
      // No `DROP OWNED BY`: every managed grant, default ACL, and owned
      // object has already been revoked/reassigned/dropped by its own plan
      // action. `DROP OWNED BY` would also sweep up anything the role owns
      // OUTSIDE the managed view, silently destroying unmanaged data — a
      // plain `DROP ROLE` instead fails loud if unmanaged ownership remains.
      return { sql: `DROP ROLE ${name}` };
    },
    attributes: {
      ...Object.fromEntries(
        Object.entries(ROLE_FLAGS).map(([key, [on, off]]) => [
          key,
          {
            alter: (fact: Fact, _from: PayloadValue, to: PayloadValue) => ({
              sql: `ALTER ROLE ${qid((fact.id as { name: string }).name)} WITH ${to ? on : off}`,
            }),
          },
        ]),
      ),
      config: {
        alter: (fact, from, to) => {
          const role = qid((fact.id as { name: string }).name);
          const oldCfg = new Map(
            ((from as string[] | null) ?? []).map(splitOption),
          );
          const newCfg = new Map(
            ((to as string[] | null) ?? []).map(splitOption),
          );
          const specs: ActionSpec[] = [];
          for (const [key] of oldCfg) {
            if (!newCfg.has(key)) {
              specs.push({ sql: `ALTER ROLE ${role} RESET ${qid(key)}` });
            }
          }
          for (const [key, value] of newCfg) {
            if (oldCfg.get(key) !== value) {
              specs.push({ sql: roleConfigSetSql(role, key, value) });
            }
          }
          return specs;
        },
      },
    },
  },

  membership: {
    weight: 1,
    create: (fact) => {
      const id = fact.id as { role: string; member: string };
      return [
        {
          sql: `GRANT ${qid(id.role)} TO ${qid(id.member)}${p(fact, "admin") ? " WITH ADMIN OPTION" : ""}`,
          consumes: [
            { kind: "role", name: id.role },
            { kind: "role", name: id.member },
          ],
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { role: string; member: string };
      return {
        sql: `REVOKE ${qid(id.role)} FROM ${qid(id.member)} CASCADE`,
        consumes: [
          { kind: "role", name: id.role },
          { kind: "role", name: id.member },
        ],
      };
    },
    attributes: {
      admin: {
        alter: (fact, _from, to) => {
          const id = fact.id as { role: string; member: string };
          return {
            sql: to
              ? `GRANT ${qid(id.role)} TO ${qid(id.member)} WITH ADMIN OPTION`
              : `REVOKE ADMIN OPTION FOR ${qid(id.role)} FROM ${qid(id.member)}`,
          };
        },
      },
    },
  },

  defaultPrivilege: {
    weight: 22,
    create: (fact) => defaultPrivilegeCreateActions(fact),
    drop: (fact) => defaultPrivilegeDropActions(fact),
    attributes: { privileges: "replace", grantable: "replace" },
  },
};
