import { BaseChange } from "../../base.change.ts";
import type { MaterializedView } from "../materialized-view.model.ts";

abstract class BaseMaterializedViewChange extends BaseChange {
  abstract readonly materializedView: MaterializedView;
  abstract readonly scope: "object" | "comment" | "privilege";
  readonly objectType: "materialized_view" = "materialized_view";
}

export abstract class CreateMaterializedViewChange extends BaseMaterializedViewChange {
  readonly operation = "create" as const;
}

export abstract class AlterMaterializedViewChange extends BaseMaterializedViewChange {
  readonly operation = "alter" as const;
}

export abstract class DropMaterializedViewChange extends BaseMaterializedViewChange {
  readonly operation = "drop" as const;
}
