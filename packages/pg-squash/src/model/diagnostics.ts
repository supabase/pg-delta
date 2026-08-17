import type { SourceRef } from "./statement.ts";

export type DiagnosticCode =
  | "opaque-file"
  | "refused-statement"
  | "repair-split"
  | "parse-error"
  | "barrier-runtime"
  | "explicit-txn-floor";

export type Diagnostic = {
  code: DiagnosticCode;
  message: string;
  source?: SourceRef;
};
