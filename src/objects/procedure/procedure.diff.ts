import type { DefaultPrivilegeState } from "../base.default-privileges.ts";
import { diffObjects } from "../base.diff.ts";
import {
  diffPrivileges,
  filterPublicBuiltInDefaults,
  groupPrivilegesByGrantable,
} from "../base.privilege-diff.ts";
import { deepEqual, hasNonAlterableChanges } from "../utils.ts";
import {
  AlterProcedureChangeOwner,
  AlterProcedureSetConfig,
  AlterProcedureSetLeakproof,
  AlterProcedureSetParallel,
  AlterProcedureSetSecurity,
  AlterProcedureSetStrictness,
  AlterProcedureSetVolatility,
} from "./changes/procedure.alter.ts";
import {
  CreateCommentOnProcedure,
  DropCommentOnProcedure,
} from "./changes/procedure.comment.ts";
import { CreateProcedure } from "./changes/procedure.create.ts";
import { DropProcedure } from "./changes/procedure.drop.ts";
import {
  GrantProcedurePrivileges,
  RevokeGrantOptionProcedurePrivileges,
  RevokeProcedurePrivileges,
} from "./changes/procedure.privilege.ts";
import type { ProcedureChange } from "./changes/procedure.types.ts";
import type { Procedure } from "./procedure.model.ts";

/**
 * Diff two sets of procedures from main and branch catalogs.
 *
 * @param ctx - Context containing version, currentUser, and defaultPrivilegeState
 * @param main - The procedures in the main catalog.
 * @param branch - The procedures in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffProcedures(
  ctx: {
    version: number;
    currentUser: string;
    defaultPrivilegeState: DefaultPrivilegeState;
  },
  main: Record<string, Procedure>,
  branch: Record<string, Procedure>,
): ProcedureChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: ProcedureChange[] = [];

  for (const procedureId of created) {
    const proc = branch[procedureId];
    changes.push(new CreateProcedure({ procedure: proc }));
    if (proc.comment !== null) {
      changes.push(new CreateCommentOnProcedure({ procedure: proc }));
    }

    // PRIVILEGES: For created objects, compare against default privileges state
    // The migration script will run ALTER DEFAULT PRIVILEGES before CREATE (via constraint spec),
    // so objects are created with the default privileges state in effect.
    // We compare default privileges against desired privileges to generate REVOKE/GRANT statements
    // needed to reach the final desired state.
    const effectiveDefaults = ctx.defaultPrivilegeState.getEffectiveDefaults(
      ctx.currentUser,
      "procedure",
      proc.schema ?? "",
    );
    // Filter out PUBLIC's built-in default EXECUTE privilege (PostgreSQL grants it automatically)
    // Reference: https://www.postgresql.org/docs/17/ddl-priv.html Table 5.2
    // This prevents generating unnecessary "GRANT EXECUTE TO PUBLIC" statements
    const desiredPrivileges = filterPublicBuiltInDefaults(
      "procedure",
      proc.privileges,
    );
    const privilegeResults = diffPrivileges(
      effectiveDefaults,
      desiredPrivileges,
    );

    // Generate grant changes
    for (const [grantee, result] of privilegeResults) {
      if (result.grants.length > 0) {
        const grantGroups = groupPrivilegesByGrantable(result.grants);
        for (const [grantable, list] of grantGroups) {
          void grantable;
          changes.push(
            new GrantProcedurePrivileges({
              procedure: proc,
              grantee,
              privileges: list,
              version: ctx.version,
            }),
          );
        }
      }

      // Generate revoke changes
      if (result.revokes.length > 0) {
        const revokeGroups = groupPrivilegesByGrantable(result.revokes);
        for (const [grantable, list] of revokeGroups) {
          void grantable;
          changes.push(
            new RevokeProcedurePrivileges({
              procedure: proc,
              grantee,
              privileges: list,
              version: ctx.version,
            }),
          );
        }
      }

      // Generate revoke grant option changes
      if (result.revokeGrantOption.length > 0) {
        changes.push(
          new RevokeGrantOptionProcedurePrivileges({
            procedure: proc,
            grantee,
            privilegeNames: result.revokeGrantOption,
            version: ctx.version,
          }),
        );
      }
    }
  }

  for (const procedureId of dropped) {
    changes.push(new DropProcedure({ procedure: main[procedureId] }));
  }

  for (const procedureId of altered) {
    const mainProcedure = main[procedureId];
    const branchProcedure = branch[procedureId];

    // Check if non-alterable properties have changed
    // These require dropping and recreating the procedure
    const NON_ALTERABLE_FIELDS: Array<keyof Procedure> = [
      "kind",
      "return_type",
      "return_type_schema",
      "language",
      // The following properties are alterable in SQL, but our generator may choose
      // to replace on changes not covered by explicit ALTER actions. Keep them out here
      // to allow ALTER for those we implement below.
      // security_definer,
      // volatility,
      // parallel_safety,
      // is_strict,
      // leakproof,
      // Returns-set is part of the signature and not alterable
      "returns_set",
      "argument_count",
      "argument_default_count",
      "argument_names",
      "argument_types",
      "all_argument_types",
      "argument_modes",
      "argument_defaults",
      "source_code",
      "binary_path",
      "sql_body",
      // config is alterable via SET/RESET
    ];
    const nonAlterablePropsChanged = hasNonAlterableChanges(
      mainProcedure,
      branchProcedure,
      NON_ALTERABLE_FIELDS,
      {
        argument_names: deepEqual,
        argument_types: deepEqual,
        all_argument_types: deepEqual,
        argument_modes: deepEqual,
        config: deepEqual,
      },
    );

    if (nonAlterablePropsChanged) {
      // Replace the entire procedure
      changes.push(
        new CreateProcedure({ procedure: branchProcedure, orReplace: true }),
      );
    } else {
      // Only alterable properties changed - check each one

      // OWNER
      if (mainProcedure.owner !== branchProcedure.owner) {
        changes.push(
          new AlterProcedureChangeOwner({
            procedure: mainProcedure,
            owner: branchProcedure.owner,
          }),
        );
      }

      // COMMENT
      if (mainProcedure.comment !== branchProcedure.comment) {
        if (branchProcedure.comment === null) {
          changes.push(
            new DropCommentOnProcedure({ procedure: mainProcedure }),
          );
        } else {
          changes.push(
            new CreateCommentOnProcedure({ procedure: branchProcedure }),
          );
        }
      }

      // SECURITY DEFINER/INVOKER
      if (mainProcedure.security_definer !== branchProcedure.security_definer) {
        changes.push(
          new AlterProcedureSetSecurity({
            procedure: mainProcedure,
            securityDefiner: branchProcedure.security_definer,
          }),
        );
      }

      // CONFIG SET/RESET
      const toMap = (opts?: string[] | null) => {
        const map = new Map<string, string>();
        for (const opt of opts ?? []) {
          const eq = opt.indexOf("=");
          const key = opt.slice(0, eq).trim();
          const value = opt.slice(eq + 1).trim();
          map.set(key, value);
        }
        return map;
      };
      const mainCfg = toMap(mainProcedure.config);
      const branchCfg = toMap(branchProcedure.config);
      if (branchCfg.size === 0 && mainCfg.size > 0) {
        // Branch has no config at all -> prefer a single RESET ALL
        changes.push(
          new AlterProcedureSetConfig({
            procedure: mainProcedure,
            action: "reset_all",
          }),
        );
      } else {
        for (const [key, oldValue] of mainCfg.entries()) {
          const hasInBranch = branchCfg.has(key);
          const newValue = branchCfg.get(key);
          const changed = hasInBranch ? oldValue !== newValue : true;
          if (changed) {
            changes.push(
              new AlterProcedureSetConfig({
                procedure: mainProcedure,
                action: "reset",
                key,
              }),
            );
          }
        }
        for (const [key, newValue] of branchCfg.entries()) {
          const oldValue = mainCfg.get(key);
          if (oldValue !== newValue) {
            changes.push(
              new AlterProcedureSetConfig({
                procedure: mainProcedure,
                action: "set",
                key,
                value: newValue,
              }),
            );
          }
        }
      }

      // VOLATILITY
      if (mainProcedure.volatility !== branchProcedure.volatility) {
        changes.push(
          new AlterProcedureSetVolatility({
            procedure: mainProcedure,
            volatility: branchProcedure.volatility,
          }),
        );
      }

      // STRICTNESS
      if (mainProcedure.is_strict !== branchProcedure.is_strict) {
        changes.push(
          new AlterProcedureSetStrictness({
            procedure: mainProcedure,
            isStrict: branchProcedure.is_strict,
          }),
        );
      }

      // LEAKPROOF
      if (mainProcedure.leakproof !== branchProcedure.leakproof) {
        changes.push(
          new AlterProcedureSetLeakproof({
            procedure: mainProcedure,
            leakproof: branchProcedure.leakproof,
          }),
        );
      }

      // PARALLEL
      if (mainProcedure.parallel_safety !== branchProcedure.parallel_safety) {
        changes.push(
          new AlterProcedureSetParallel({
            procedure: mainProcedure,
            parallelSafety: branchProcedure.parallel_safety,
          }),
        );
      }

      // Note: Procedure renaming would also use ALTER FUNCTION/PROCEDURE ... RENAME TO ...
      // But since our Procedure model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()

      // PRIVILEGES
      const privilegeResults = diffPrivileges(
        mainProcedure.privileges,
        branchProcedure.privileges,
      );

      for (const [grantee, result] of privilegeResults) {
        // Generate grant changes
        if (result.grants.length > 0) {
          const grantGroups = groupPrivilegesByGrantable(result.grants);
          for (const [grantable, list] of grantGroups) {
            void grantable;
            changes.push(
              new GrantProcedurePrivileges({
                procedure: branchProcedure,
                grantee,
                privileges: list,
                version: ctx.version,
              }),
            );
          }
        }

        // Generate revoke changes
        if (result.revokes.length > 0) {
          const revokeGroups = groupPrivilegesByGrantable(result.revokes);
          for (const [grantable, list] of revokeGroups) {
            void grantable;
            changes.push(
              new RevokeProcedurePrivileges({
                procedure: mainProcedure,
                grantee,
                privileges: list,
                version: ctx.version,
              }),
            );
          }
        }

        // Generate revoke grant option changes
        if (result.revokeGrantOption.length > 0) {
          changes.push(
            new RevokeGrantOptionProcedurePrivileges({
              procedure: mainProcedure,
              grantee,
              privilegeNames: result.revokeGrantOption,
              version: ctx.version,
            }),
          );
        }
      }
    }
  }

  return changes;
}
