/** Routines: functions / procedures and aggregates. */
import type { StableId } from "../core/stable-id.ts";
import {
  aclJsonMemberAware,
  type CatalogFamily,
  memberExtensionExpr,
  parseAcl,
  schemaId,
  USER_SCHEMA_FILTER,
} from "./scope.ts";

// ── routines (functions + procedures; pg_get_functiondef canonical) ──
const ROUTINES_SQL = `
    SELECT n.nspname AS schema, p.proname AS name, r.rolname AS owner,
           p.prokind AS prokind,
           ARRAY(SELECT format_type(t.t, NULL)
                 FROM unnest(p.proargtypes) WITH ORDINALITY AS t(t, ord)
                 ORDER BY t.ord)::text[] AS identity_args,
           pg_get_functiondef(p.oid) AS def,
           pg_get_function_result(p.oid) AS return_type,
           pg_get_function_arguments(p.oid) AS arg_signature,
           -- proconfig GUC NAMES only (name=value split in POSTGRES, never in
           -- TS): a structured, non-semantic duplicate of the routine's SET
           -- header clauses used purely for the seed replayability decision.
           (SELECT array_agg(split_part(c, '=', 1))
              FROM unnest(p.proconfig) AS c) AS config_gucs,
           l.lanname AS language,
           obj_description(p.oid, 'pg_proc') AS comment,
           ${aclJsonMemberAware("p.proacl", "f", "p.proowner", "pg_proc", "p.oid")} AS acl,
           ${memberExtensionExpr("pg_proc", "p.oid")} AS ext_member_of
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
    JOIN pg_language l ON l.oid = p.prolang
    WHERE p.prokind IN ('f', 'p', 'w') AND ${USER_SCHEMA_FILTER}
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend idep
        WHERE idep.classid = 'pg_proc'::regclass AND idep.objid = p.oid
          AND idep.deptype = 'i')
    ORDER BY n.nspname, p.proname`;

export const routinesFamily: CatalogFamily = {
  name: "routines",
  statements: () => [ROUTINES_SQL],
  apply: (ctx, rowSets) => {
    const { pushWithMeta, pushMemberEdge, pushOwnerEdge } = ctx;
    for (const row of rowSets[0]!) {
      const args = (row["identity_args"] as string[]).map(String);
      // GUC names this routine's proconfig SETs (from `config_gucs`, split in SQL).
      // Carried as the `_`-prefixed `_configGucs` so it is NON-SEMANTIC: dropped
      // from the hash and diff (core/hash.ts), exactly like `_position` on type
      // attributes. It exists ONLY so the co-located shadow seed can DECIDE whether
      // a routine is replayable by a non-superuser (a SUSET-context GUC in the SET
      // header makes CREATE fail 42501) WITHOUT parsing the `def` SQL text — the SET
      // clauses are already semantic inside `def`; this is a structured duplicate
      // for that decision alone. Omitted when empty so it never appears in payloads
      // that have no proconfig.
      const configGucs = ((row["config_gucs"] as string[] | null) ?? []).map(
        String,
      );
      // prokind distinguishes procedures ('p') from functions ('f'/'w'); the kind
      // lives in the id (not the payload) so satellite renderers address the
      // routine with the correct DDL keyword (FUNCTION vs PROCEDURE). Window
      // functions ('w') are still FUNCTIONs for DDL — they only differ by `isWindow`.
      const id: StableId = {
        kind: String(row["prokind"]) === "p" ? "procedure" : "function",
        schema: String(row["schema"]),
        name: String(row["name"]),
        args,
      };
      pushWithMeta(
        {
          id,
          parent: schemaId(row["schema"]),
          payload: {
            def: String(row["def"]),
            // Classification fields for the change path: `def` (pg_get_functiondef)
            // is itself a CREATE OR REPLACE, so a body/volatility/… change alters
            // in place — but return type, language, and window-kind are things
            // CREATE OR REPLACE refuses or cannot express, so a change to any of
            // them must demolish (see plan/rules/routines.ts). They deliberately
            // double-count with `def` (all change together) so they carry no extra
            // diff signal; they exist only to route the change. `return_type` is
            // NULL for procedures (null-stable — no delta among procedures).
            returnType:
              row["return_type"] == null
                ? null
                : (row["return_type"] as string),
            // full argument signature (names / modes / defaults). CREATE OR
            // REPLACE refuses to rename a parameter or remove a default, so ANY
            // arg-signature change must demolish. Arg TYPES are identity (a
            // different stable id → natural drop+create), so within a stable id
            // this differs only by name/mode/default — the part OR-REPLACE can't
            // always express.
            argSignature: String(row["arg_signature"]),
            language: String(row["language"]),
            isWindow: String(row["prokind"]) === "w",
            ...(configGucs.length > 0 ? { _configGucs: configGucs } : {}),
          },
        },
        row,
        parseAcl(row["acl"]),
      );
      pushMemberEdge(id, row);
      pushOwnerEdge(id, row["owner"]);
    }
  },
};

// ── aggregates (CREATE AGGREGATE is reconstructed from pg_aggregate) ─
const AGGREGATES_SQL = `
    SELECT n.nspname AS schema, p.proname AS name, r.rolname AS owner,
           ARRAY(SELECT format_type(t.t, NULL)
                 FROM unnest(p.proargtypes) WITH ORDINALITY AS t(t, ord)
                 ORDER BY t.ord)::text[] AS identity_args,
           a.aggkind AS agg_kind, a.aggnumdirectargs AS num_direct_args,
           a.aggtransfn::regproc::text AS sfunc,
           format_type(a.aggtranstype, NULL) AS stype,
           a.aggtransspace AS sspace,
           CASE WHEN a.aggfinalfn <> 0 THEN a.aggfinalfn::regproc::text END AS finalfunc,
           a.aggfinalextra AS finalfunc_extra,
           a.aggfinalmodify AS finalfunc_modify,
           CASE WHEN a.aggcombinefn <> 0 THEN a.aggcombinefn::regproc::text END AS combinefunc,
           CASE WHEN a.aggserialfn <> 0 THEN a.aggserialfn::regproc::text END AS serialfunc,
           CASE WHEN a.aggdeserialfn <> 0 THEN a.aggdeserialfn::regproc::text END AS deserialfunc,
           CASE WHEN a.aggmtransfn <> 0 THEN a.aggmtransfn::regproc::text END AS msfunc,
           CASE WHEN a.aggminvtransfn <> 0 THEN a.aggminvtransfn::regproc::text END AS minvfunc,
           CASE WHEN a.aggmtranstype <> 0 THEN format_type(a.aggmtranstype, NULL) END AS mstype,
           a.aggmtransspace AS msspace,
           CASE WHEN a.aggmfinalfn <> 0 THEN a.aggmfinalfn::regproc::text END AS mfinalfunc,
           a.aggmfinalextra AS mfinalfunc_extra,
           a.aggmfinalmodify AS mfinalfunc_modify,
           a.agginitval AS initcond,
           a.aggminitval AS minitcond,
           CASE WHEN a.aggsortop <> 0 THEN (
             SELECT 'OPERATOR(' || quote_ident(opn.nspname) || '.' || o.oprname || ')'
             FROM pg_operator o
             JOIN pg_namespace opn ON opn.oid = o.oprnamespace
             WHERE o.oid = a.aggsortop) END AS sortop,
           p.proparallel AS parallel,
           obj_description(p.oid, 'pg_proc') AS comment,
           ${aclJsonMemberAware("p.proacl", "f", "p.proowner", "pg_proc", "p.oid")} AS acl,
           ${memberExtensionExpr("pg_proc", "p.oid")} AS ext_member_of
    FROM pg_proc p
    JOIN pg_aggregate a ON a.aggfnoid = p.oid
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.prokind = 'a' AND ${USER_SCHEMA_FILTER}
    ORDER BY n.nspname, p.proname`;

export const aggregatesFamily: CatalogFamily = {
  name: "aggregates",
  statements: () => [AGGREGATES_SQL],
  apply: (ctx, rowSets) => {
    const { pushWithMeta, pushMemberEdge, pushOwnerEdge } = ctx;
    for (const row of rowSets[0]!) {
      const id: StableId = {
        kind: "aggregate",
        schema: String(row["schema"]),
        name: String(row["name"]),
        args: (row["identity_args"] as string[]).map(String),
      };
      pushWithMeta(
        {
          id,
          parent: schemaId(row["schema"]),
          payload: {
            aggKind: String(row["agg_kind"]),
            numDirectArgs: Number(row["num_direct_args"]),
            sfunc: String(row["sfunc"]),
            stype: String(row["stype"]),
            sspace: Number(row["sspace"]),
            finalfunc:
              row["finalfunc"] == null ? null : (row["finalfunc"] as string),
            finalfuncExtra: Boolean(row["finalfunc_extra"]),
            finalfuncModify: String(row["finalfunc_modify"]),
            combinefunc:
              row["combinefunc"] == null
                ? null
                : (row["combinefunc"] as string),
            serialfunc:
              row["serialfunc"] == null ? null : (row["serialfunc"] as string),
            deserialfunc:
              row["deserialfunc"] == null
                ? null
                : (row["deserialfunc"] as string),
            msfunc: row["msfunc"] == null ? null : (row["msfunc"] as string),
            minvfunc:
              row["minvfunc"] == null ? null : (row["minvfunc"] as string),
            mstype: row["mstype"] == null ? null : (row["mstype"] as string),
            msspace: Number(row["msspace"]),
            mfinalfunc:
              row["mfinalfunc"] == null ? null : (row["mfinalfunc"] as string),
            mfinalfuncExtra: Boolean(row["mfinalfunc_extra"]),
            mfinalfuncModify: String(row["mfinalfunc_modify"]),
            initcond:
              row["initcond"] == null ? null : (row["initcond"] as string),
            minitcond:
              row["minitcond"] == null ? null : (row["minitcond"] as string),
            sortop: row["sortop"] == null ? null : (row["sortop"] as string),
            parallel: String(row["parallel"]),
          },
        },
        row,
        parseAcl(row["acl"]),
      );
      pushMemberEdge(id, row);
      pushOwnerEdge(id, row["owner"]);
    }
  },
};
