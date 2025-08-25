import type { Catalog } from "./catalog.model.ts";
import type { Change } from "./objects/base.change.ts";
import { diffDomains } from "./objects/domain/domain.diff.ts";
import { diffSchemas } from "./objects/schema/schema.diff.ts";
import { diffCompositeTypes } from "./objects/type/composite-type/composite-type.diff.ts";

export function diffCatalogs(main: Catalog, branch: Catalog) {
  const changes: Change[] = [];

  changes.push(...diffDomains(main.domains, branch.domains));
  changes.push(
    ...diffCompositeTypes(main.compositeTypes, branch.compositeTypes),
  );
  changes.push(...diffSchemas(main.schemas, branch.schemas));
  return changes;
}
