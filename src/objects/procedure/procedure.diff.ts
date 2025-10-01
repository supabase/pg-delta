import type { Change } from "../base.change.ts";
import { diffObjects } from "../base.diff.ts";
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
import type { Procedure } from "./procedure.model.ts";

/**
 * Diff two sets of procedures from main and branch catalogs.
 *
 * @param main - The procedures in the main catalog.
 * @param branch - The procedures in the branch catalog.
 * @returns A list of changes to apply to main to make it match branch.
 */
export function diffProcedures(
  main: Record<string, Procedure>,
  branch: Record<string, Procedure>,
): Change[] {
  const { created, dropped, altered } = diffObjects(main, branch);

  const changes: Change[] = [];

  for (const procedureId of created) {
    const proc = branch[procedureId];
    changes.push(new CreateProcedure({ procedure: proc }));
    if (proc.comment !== null) {
      changes.push(new CreateCommentOnProcedure({ procedure: proc }));
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
            main: mainProcedure,
            branch: branchProcedure,
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
            main: mainProcedure,
            branch: branchProcedure,
          }),
        );
      }

      // CONFIG SET/RESET
      const serializeConfig = (cfg?: string[] | null) =>
        (cfg ?? []).slice().sort();
      const mainCfg = serializeConfig(mainProcedure.config);
      const branchCfg = serializeConfig(branchProcedure.config);
      const configChanged =
        mainCfg.length !== branchCfg.length ||
        mainCfg.some((val, idx) => val !== branchCfg[idx]);
      if (configChanged) {
        changes.push(
          new AlterProcedureSetConfig({
            main: mainProcedure,
            branch: branchProcedure,
          }),
        );
      }

      // VOLATILITY
      if (mainProcedure.volatility !== branchProcedure.volatility) {
        changes.push(
          new AlterProcedureSetVolatility({
            main: mainProcedure,
            branch: branchProcedure,
          }),
        );
      }

      // STRICTNESS
      if (mainProcedure.is_strict !== branchProcedure.is_strict) {
        changes.push(
          new AlterProcedureSetStrictness({
            main: mainProcedure,
            branch: branchProcedure,
          }),
        );
      }

      // LEAKPROOF
      if (mainProcedure.leakproof !== branchProcedure.leakproof) {
        changes.push(
          new AlterProcedureSetLeakproof({
            main: mainProcedure,
            branch: branchProcedure,
          }),
        );
      }

      // PARALLEL
      if (mainProcedure.parallel_safety !== branchProcedure.parallel_safety) {
        changes.push(
          new AlterProcedureSetParallel({
            main: mainProcedure,
            branch: branchProcedure,
          }),
        );
      }

      // Note: Procedure renaming would also use ALTER FUNCTION/PROCEDURE ... RENAME TO ...
      // But since our Procedure model uses 'name' as the identity field,
      // a name change would be handled as drop + create by diffObjects()
    }
  }

  return changes;
}
