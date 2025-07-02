import type { InspectedCollation } from "./objects2/collations.ts";
import type { InspectedCompositeType } from "./objects2/composite-types.ts";
import type { InspectedConstraint } from "./objects2/constraints.ts";
import type { InspectedDomain } from "./objects2/domains.ts";
import type { InspectedEnum } from "./objects2/enums.ts";
import type { InspectedExtension } from "./objects2/extensions.ts";
import type { InspectedFunction } from "./objects2/functions.ts";
import type { InspectedIndex } from "./objects2/indexes.ts";
import type { InspectedMaterializedView } from "./objects2/materialized-views.ts";
import type { InspectedPrivilege } from "./objects2/privileges.ts";
import type { InspectedRlsPolicy } from "./objects2/rls-policies.ts";
import type { InspectedSchema } from "./objects2/schemas.ts";
import type { InspectedSequence } from "./objects2/sequences.ts";
import type { InspectedTable } from "./objects2/tables.ts";
import type { InspectedTrigger } from "./objects2/triggers.ts";
import type { InspectedType } from "./objects2/types.ts";
import type { InspectedView } from "./objects2/views.ts";

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

export type InspectionResult = {
  collations: Map<string, InspectedCollation>;
  compositeTypes: Map<string, InspectedCompositeType>;
  constraints: Map<string, InspectedConstraint>;
  domains: Map<string, InspectedDomain>;
  enums: Map<string, InspectedEnum[]>;
  extensions: Map<string, InspectedExtension>;
  functions: Map<string, InspectedFunction>;
  indexes: Map<string, InspectedIndex>;
  materializedViews: Map<string, InspectedMaterializedView>;
  privileges: Map<string, InspectedPrivilege>;
  rlsPolicies: Map<string, InspectedRlsPolicy>;
  schemas: Map<string, InspectedSchema>;
  sequences: Map<string, InspectedSequence>;
  tables: Map<string, InspectedTable>;
  triggers: Map<string, InspectedTrigger>;
  types: Map<string, InspectedType>;
  views: Map<string, InspectedView>;
};

export interface DependentDatabaseObject {
  dependent_on: string[];
  dependents: string[];
}
