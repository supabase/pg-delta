/** UTF-8 byte offsets. Never JS string indices (supabase/pg-toolbelt#369). */
export type ByteRange = { start: number; end: number };

export type SourceRef = {
  file: string;
  statementIndex: number;
  bytes: ByteRange;
};

export type TxnKind =
  | "begin"
  | "commit"
  | "rollback"
  | "savepoint"
  | "rollback_to"
  | "release";

export type SquashStatement = {
  text: string;
  source: SourceRef;
  txn?: TxnKind;
};

export type Segment =
  | { type: "txn"; statements: SquashStatement[] }
  | { type: "barrier"; statement: SquashStatement }
  | { type: "opaqueFile"; file: string; sql: string };
