import { diffObjects } from "../base.diff.ts";
import {
  diffPrivileges,
  emitObjectPrivilegeChanges,
  withPublicBuiltInDefault,
} from "../base.privilege-diff.ts";
import type { ObjectDiffContext } from "../diff-context.ts";
import { diffSecurityLabels } from "../security-label.types.ts";
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
import {
  CreateSecurityLabelOnProcedure,
  DropSecurityLabelOnProcedure,
} from "./changes/procedure.security-label.ts";
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
  ctx: Pick<
    ObjectDiffContext,
    "version" | "currentUser" | "defaultPrivilegeState"
  >,
  main: Record<string, Procedure>,
  branch: Record<string, Procedure>,
): ProcedureChange[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: ProcedureChange[] = [];

  const appendCreateProcedureChanges = (proc: Procedure) => {
    changes.push(new CreateProcedure({ procedure: proc }));

    // OWNER: If the procedure should be owned by someone other than the current user,
    // emit ALTER FUNCTION/PROCEDURE ... OWNER TO after creation
    if (proc.owner !== ctx.currentUser) {
      changes.push(
        new AlterProcedureChangeOwner({
          procedure: proc,
          owner: proc.owner,
        }),
      );
    }

    if (proc.comment !== null) {
      changes.push(new CreateCommentOnProcedure({ procedure: proc }));
    }
    for (const label of proc.security_labels) {
      changes.push(
        new CreateSecurityLabelOnProcedure({
          procedure: proc,
          securityLabel: label,
        }),
      );
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
    const creatorFilteredDefaults =
      proc.owner !== ctx.currentUser
        ? effectiveDefaults.filter((p) => p.grantee !== ctx.currentUser)
        : effectiveDefaults;
    // proc.privileges is the desired object's real ACL, which already
    // reflects PostgreSQL's implicit PUBLIC EXECUTE default (or its absence,
    // if explicitly revoked). Compare it unfiltered against the defaults side
    // with that same built-in default added back in, so both sides are
    // symmetric.
    const desiredPrivileges = proc.privileges;
    // Filter out owner privileges - owner always has ALL privileges implicitly
    // and shouldn't be compared. Note: we use the final owner (proc.owner), not the
    // current user, because ownership change happens before privilege diffing.
    const privilegeResults = diffPrivileges(
      withPublicBuiltInDefault("procedure", creatorFilteredDefaults),
      desiredPrivileges,
      proc.owner,
    );

    changes.push(
      ...(emitObjectPrivilegeChanges(
        privilegeResults,
        proc,
        proc,
        "procedure",
        {
          Grant: GrantProcedurePrivileges,
          Revoke: RevokeProcedurePrivileges,
          RevokeGrantOption: RevokeGrantOptionProcedurePrivileges,
        },
        ctx.version,
      ) as ProcedureChange[]),
    );
  };

  for (const procedureId of created) {
    appendCreateProcedureChanges(branch[procedureId]);
  }

  for (const procedureId of dropped) {
    changes.push(new DropProcedure({ procedure: main[procedureId] }));
  }

  for (const procedureId of altered) {
    const mainProcedure = main[procedureId];
    const branchProcedure = branch[procedureId];

    // Fields that are part of the function's identity/signature. PostgreSQL
    // rejects `CREATE OR REPLACE FUNCTION` for any of these changes with
    // errors such as:
    //   - cannot change return type of existing function
    //   - cannot change name of input parameter "..."
    //   - cannot change whether a procedure has output parameters
    //   - cannot remove parameter defaults from existing function
    // These require `DROP FUNCTION` followed by `CREATE FUNCTION`.
    const SIGNATURE_BREAKING_FIELDS: Array<keyof Procedure> = [
      "kind",
      "return_type",
      "return_type_schema",
      "returns_set",
      "argument_count",
      "argument_default_count",
      "argument_names",
      "argument_types",
      "all_argument_types",
      "argument_modes",
      "argument_defaults",
    ];
    // Fields where `CREATE OR REPLACE` is sufficient - body replacement only.
    // Other fields (security_definer, volatility, parallel_safety, is_strict,
    // leakproof, config) are alterable via dedicated ALTER actions below.
    const OR_REPLACEABLE_NON_ALTERABLE_FIELDS: Array<keyof Procedure> = [
      "language",
      "source_code",
      "binary_path",
      "sql_body",
    ];
    const signatureChanged = hasNonAlterableChanges(
      mainProcedure,
      branchProcedure,
      SIGNATURE_BREAKING_FIELDS,
      {
        argument_names: deepEqual,
        argument_types: deepEqual,
        all_argument_types: deepEqual,
        argument_modes: deepEqual,
      },
    );
    const nonAlterablePropsChanged =
      signatureChanged ||
      hasNonAlterableChanges(
        mainProcedure,
        branchProcedure,
        OR_REPLACEABLE_NON_ALTERABLE_FIELDS,
      );

    if (signatureChanged) {
      // PostgreSQL cannot change an existing function's signature via
      // `CREATE OR REPLACE`. Drop the old signature, then recreate.
      // `expandReplaceDependencies` will cascade the replacement to dependent
      // objects (views, triggers, column defaults) via pg_depend edges.
      changes.push(new DropProcedure({ procedure: mainProcedure }));
      appendCreateProcedureChanges(branchProcedure);
    } else if (nonAlterablePropsChanged) {
      // Body-only non-alterable change - `CREATE OR REPLACE` preserves the
      // function OID and keeps dependent objects attached.
      changes.push(
        new CreateProcedure({ procedure: branchProcedure, orReplace: true }),
      );

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

      // SECURITY LABELS
      changes.push(
        ...diffSecurityLabels<
          CreateSecurityLabelOnProcedure | DropSecurityLabelOnProcedure
        >(
          mainProcedure.security_labels,
          branchProcedure.security_labels,
          (securityLabel) =>
            new CreateSecurityLabelOnProcedure({
              procedure: branchProcedure,
              securityLabel,
            }),
          (securityLabel) =>
            new DropSecurityLabelOnProcedure({
              procedure: mainProcedure,
              securityLabel,
            }),
        ),
      );

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
      // Both mainProcedure.privileges and branchProcedure.privileges are
      // extracted via COALESCE(<acl-column>, acldefault(...)), so PostgreSQL's
      // implicit PUBLIC EXECUTE default is already correctly represented (or
      // absent, if explicitly revoked) on both sides. Diff them unfiltered.
      // Filter out owner privileges - owner always has ALL privileges implicitly
      // and shouldn't be compared. Use branch owner as the reference.
      const privilegeResults = diffPrivileges(
        mainProcedure.privileges,
        branchProcedure.privileges,
        branchProcedure.owner,
      );

      changes.push(
        ...(emitObjectPrivilegeChanges(
          privilegeResults,
          branchProcedure,
          mainProcedure,
          "procedure",
          {
            Grant: GrantProcedurePrivileges,
            Revoke: RevokeProcedurePrivileges,
            RevokeGrantOption: RevokeGrantOptionProcedurePrivileges,
          },
          ctx.version,
        ) as ProcedureChange[]),
      );
    }
  }

  return changes;
}
