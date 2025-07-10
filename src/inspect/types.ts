import type { InspectedCollation } from "./objects/collations.ts";
import type { InspectedCompositeType } from "./objects/composite-types.ts";
import type { InspectedConstraint } from "./objects/constraints.ts";
import type { InspectedDomain } from "./objects/domains.ts";
import type { InspectedEnum } from "./objects/enums.ts";
import type { InspectedExtension } from "./objects/extensions.ts";
import type { InspectedFunction } from "./objects/functions.ts";
import type { InspectedIndex } from "./objects/indexes.ts";
import type { InspectedMaterializedView } from "./objects/materialized-views.ts";
import type { InspectedPrivilege } from "./objects/privileges.ts";
import type { InspectedRlsPolicy } from "./objects/rls-policies.ts";
import type { InspectedSchema } from "./objects/schemas.ts";
import type { InspectedSequence } from "./objects/sequences.ts";
import type { InspectedTable } from "./objects/tables.ts";
import type { InspectedTrigger } from "./objects/triggers.ts";
import type { InspectedType } from "./objects/types.ts";
import type { InspectedView } from "./objects/views.ts";

export type InspectionMap = {
  [k: `collation:${string}`]: InspectedCollation;
  [k: `compositeType:${string}`]: InspectedCompositeType;
  [k: `constraint:${string}`]: InspectedConstraint;
  [k: `domain:${string}`]: InspectedDomain;
  [k: `enum:${string}`]: InspectedEnum;
  [k: `extension:${string}`]: InspectedExtension;
  [k: `function:${string}`]: InspectedFunction;
  [k: `index:${string}`]: InspectedIndex;
  [k: `materializedView:${string}`]: InspectedMaterializedView;
  [k: `privilege:${string}`]: InspectedPrivilege;
  [k: `rlsPolicy:${string}`]: InspectedRlsPolicy;
  [k: `schema:${string}`]: InspectedSchema;
  [k: `sequence:${string}`]: InspectedSequence;
  [k: `table:${string}`]: InspectedTable;
  [k: `trigger:${string}`]: InspectedTrigger;
  [k: `type:${string}`]: InspectedType;
  [k: `view:${string}`]: InspectedView;
};

export interface DependentDatabaseObject {
  dependent_on: string[];
  dependents: string[];
}
