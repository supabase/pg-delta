import type { BasePgModel } from "./base.model.ts";

export function diffObjects<T extends BasePgModel>(
  main: Record<string, T>,
  branch: Record<string, T>,
) {
  const mainIds = new Set(Object.keys(main));
  const branchIds = new Set(Object.keys(branch));

  const created = [...branchIds.difference(mainIds)];
  const dropped = [...mainIds.difference(branchIds)];
  const altered = [...mainIds.intersection(branchIds)].filter((id) => {
    const mainModel = main[id];
    const branchModel = branch[id];

    return !mainModel.equals(branchModel);
  });

  return { created, dropped, altered };
}
