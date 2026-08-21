import type { StatementClass } from "../classify/classify-statement.ts";

export const OBJECT_KINDS = [
  "schema",
  "language",
  "extension",
  "foreign_data_wrapper",
  "foreign_server",
  "access_method",
  "type",
  "domain",
  "collation",
  "sequence",
  "table",
  "constraint",
  "index",
  "operator",
  "operator_class",
  "operator_family",
  "function",
  "procedure",
  "aggregate",
  "view",
  "materialized_view",
  "trigger",
  "rule",
  "event_trigger",
  "policy",
  "publication",
  "subscription",
  "role",
] as const;

export type ObjectKind = (typeof OBJECT_KINDS)[number];

export type PhaseTag =
  | "bootstrap"
  | "pre_data"
  | "data_structures"
  | "routines"
  | "post_data"
  | "privileges";

export type StatementId = {
  filePath: string;
  statementIndex: number;
  /** Character offset (UTF-16 code units) in original source content (for line:column resolution). */
  sourceOffset?: number;
};

export interface AnalyzeOptions {
  externalProviders?: ObjectRef[];
}

export type ObjectRef = {
  kind: ObjectKind;
  schema?: string;
  name: string;
  signature?: string;
  exactKind?: boolean;
  exactSignature?: boolean;
  omitIfNoLocalProducer?: boolean;
  alternativeKey?: string;
  implicitProvider?: boolean;
  explicitSchema?: boolean;
};

export type AnnotationHints = {
  phase?: PhaseTag;
  dependsOn: ObjectRef[];
  requires: ObjectRef[];
  provides: ObjectRef[];
};

export type StatementNode = {
  id: StatementId;
  sql: string;
  statementClass: StatementClass;
  provides: ObjectRef[];
  requires: ObjectRef[];
  phase: PhaseTag;
  annotations: AnnotationHints;
};

export type DiagnosticCode =
  | "PARSE_ERROR"
  | "DISCOVERY_ERROR"
  | "UNKNOWN_STATEMENT_CLASS"
  | "UNRESOLVED_DEPENDENCY"
  | "DUPLICATE_PRODUCER"
  | "CYCLE_DETECTED"
  | "CYCLE_EDGE_SKIPPED"
  | "INVALID_ANNOTATION";

export type Diagnostic = {
  code: DiagnosticCode;
  message: string;
  statementId?: StatementId;
  objectRefs?: ObjectRef[];
  suggestedFix?: string;
  details?: Record<string, unknown>;
};

export type GraphEdgeReason =
  | "requires"
  | "requires_constraint_key"
  | "requires_compatible";

export type GraphEdge = {
  from: StatementId;
  to: StatementId;
  reason: GraphEdgeReason;
  objectRef?: ObjectRef;
};

export type GraphReport = {
  nodeCount: number;
  edges: GraphEdge[];
  cycleGroups: StatementId[][];
};

export type AnalyzeResult = {
  ordered: StatementNode[];
  diagnostics: Diagnostic[];
  graph: GraphReport;
};
