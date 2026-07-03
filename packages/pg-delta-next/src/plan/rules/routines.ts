/** Rule definitions for routines: functions / procedures and aggregates. */
import type { Fact } from "../../core/fact.ts";
import { lit, qid, rel, routineSig } from "../render.ts";
import type { KindRules } from "../rules.ts";
import { aggSig, dependencyConsumes, p, str } from "./helpers.ts";

// aggfinalmodify / aggmfinalmodify → CREATE AGGREGATE keyword. 'r'
// (READ_ONLY) is the default, so it's rendered as undefined (omitted).
const FINALFUNC_MODIFY: Record<string, string | undefined> = {
  r: undefined,
  s: "SHAREABLE",
  w: "READ_WRITE",
};
// pg_proc.proparallel → PARALLEL keyword. 'u' (UNSAFE) is the default and
// is omitted.
const PARALLEL: Record<string, string | undefined> = {
  u: undefined,
  s: "SAFE",
  r: "RESTRICTED",
};

/** FUNCTION / PROCEDURE keyword from the routine's own id kind — never a
 *  payload field (the kind is part of the address, P0). */
const routineKeyword = (fact: Fact): "FUNCTION" | "PROCEDURE" =>
  fact.id.kind === "procedure" ? "PROCEDURE" : "FUNCTION";

// Functions and procedures share one rule implementation: identical
// create/drop/rename/owner shapes, differing only by the keyword derived from
// the id kind. Registered under both `function` and `procedure` keys below.
const routineRule: KindRules = {
  weight: 8,
  cascadesToChildren: true,
  rebuildable: true,
  defaclObjtype: "f",
  rename: (fact, to) => ({
    sql: `ALTER ROUTINE ${routineSig(fact.id as { schema: string; name: string; args: string[] })} RENAME TO ${qid((to as { name: string }).name)}`,
  }),
  create: (fact) => [
    {
      sql: str(p(fact, "def")),
    },
  ],
  drop: (fact) => {
    const id = fact.id as { schema: string; name: string; args: string[] };
    return { sql: `DROP ${routineKeyword(fact)} ${routineSig(id)}` };
  },
  ownerAlterPrefix: (fact) => {
    const id = fact.id as { schema: string; name: string; args: string[] };
    return `ALTER ${routineKeyword(fact)} ${routineSig(id)}`;
  },
  attributes: {
    // `def` is pg_get_functiondef output — itself a `CREATE OR REPLACE`. A
    // body / volatility / security / strictness / cost / SET-clause / arg-name
    // or arg-default change re-runs it IN PLACE (PostgreSQL / pg_dump semantics:
    // owner, grants, and dependents survive). The alter consumes the routine's
    // `depends` targets so a BEGIN ATOMIC body that references a newly-created
    // object is ordered after that object's create.
    def: {
      alter: (fact, _from, _to, view) => ({
        sql: str(p(fact, "def")),
        consumes: dependencyConsumes(view, fact.id),
      }),
    },
    // CREATE OR REPLACE refuses a return-type change ("cannot change return type
    // of existing function"), cannot flip window-ness, and cannot rename a
    // parameter or remove a parameter default ("cannot change name of input
    // parameter" / "cannot remove parameter defaults"); a language change is
    // demolished for the same drop-and-recreate safety. Each forces a replace
    // (with the forced dependent rebuild). Arg TYPES are identity → a different
    // stable id → natural drop+create, so `argSignature` differs within a stable
    // id only by name/mode/default.
    returnType: "replace",
    argSignature: "replace",
    language: "replace",
    isWindow: "replace",
  },
};

export const routineRules: Record<string, KindRules> = {
  function: routineRule,
  procedure: routineRule,

  aggregate: {
    weight: 9,
    cascadesToChildren: true,
    defaclObjtype: "f",
    create: (fact) => {
      const id = fact.id as { schema: string; name: string; args: string[] };
      const parts = [
        `SFUNC = ${str(p(fact, "sfunc"))}`,
        `STYPE = ${str(p(fact, "stype"))}`,
      ];
      // emit `KEY = <func>` for a non-null regproc-style option
      const fn = (key: string, clause: string): void => {
        const v = p(fact, key);
        if (v != null) parts.push(`${clause} = ${str(v)}`);
      };
      const sspace = Number(p(fact, "sspace") ?? 0);
      if (sspace !== 0) parts.push(`SSPACE = ${sspace}`);
      fn("finalfunc", "FINALFUNC");
      if (p(fact, "finalfuncExtra")) parts.push("FINALFUNC_EXTRA");
      const finalfuncModify =
        FINALFUNC_MODIFY[str(p(fact, "finalfuncModify") ?? "r")];
      if (finalfuncModify != null)
        parts.push(`FINALFUNC_MODIFY = ${finalfuncModify}`);
      fn("combinefunc", "COMBINEFUNC");
      fn("serialfunc", "SERIALFUNC");
      fn("deserialfunc", "DESERIALFUNC");
      fn("msfunc", "MSFUNC");
      fn("minvfunc", "MINVFUNC");
      fn("mstype", "MSTYPE");
      const msspace = Number(p(fact, "msspace") ?? 0);
      if (msspace !== 0) parts.push(`MSSPACE = ${msspace}`);
      fn("mfinalfunc", "MFINALFUNC");
      if (p(fact, "mfinalfuncExtra")) parts.push("MFINALFUNC_EXTRA");
      const mfinalfuncModify =
        FINALFUNC_MODIFY[str(p(fact, "mfinalfuncModify") ?? "r")];
      if (mfinalfuncModify != null)
        parts.push(`MFINALFUNC_MODIFY = ${mfinalfuncModify}`);
      const initcond = p(fact, "initcond");
      if (initcond != null) parts.push(`INITCOND = ${lit(str(initcond))}`);
      const minitcond = p(fact, "minitcond");
      if (minitcond != null) parts.push(`MINITCOND = ${lit(str(minitcond))}`);
      const sortop = p(fact, "sortop");
      if (sortop != null) parts.push(`SORTOP = ${str(sortop)}`);
      const parallel = PARALLEL[str(p(fact, "parallel") ?? "u")];
      if (parallel != null) parts.push(`PARALLEL = ${parallel}`);
      if (str(p(fact, "aggKind")) === "h") parts.push("HYPOTHETICAL");
      return [
        {
          sql: `CREATE AGGREGATE ${rel(id.schema, id.name)}(${aggSig(fact)}) (${parts.join(", ")})`,
        },
      ];
    },
    drop: (fact) => {
      const id = fact.id as { schema: string; name: string; args: string[] };
      return {
        sql: `DROP AGGREGATE ${rel(id.schema, id.name)}(${aggSig(fact)})`,
      };
    },
    ownerAlterPrefix: (fact) => {
      const id = fact.id as { schema: string; name: string; args: string[] };
      return `ALTER AGGREGATE ${rel(id.schema, id.name)}(${aggSig(fact)})`;
    },
    attributes: {
      aggKind: "replace",
      numDirectArgs: "replace",
      sfunc: "replace",
      stype: "replace",
      finalfunc: "replace",
      initcond: "replace",
      combinefunc: "replace",
      serialfunc: "replace",
      deserialfunc: "replace",
      msfunc: "replace",
      minvfunc: "replace",
      mstype: "replace",
      msspace: "replace",
      mfinalfunc: "replace",
      minitcond: "replace",
      finalfuncExtra: "replace",
      mfinalfuncExtra: "replace",
      finalfuncModify: "replace",
      mfinalfuncModify: "replace",
      sspace: "replace",
      sortop: "replace",
      parallel: "replace",
    },
  },
};
