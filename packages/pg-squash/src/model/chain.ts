import type { Pool } from "pg";
import type { Diagnostic } from "./diagnostics.ts";

export type RunnerSemantics = "per-file-transaction-shared-session";
// reserved, not implemented in v1:
//   | "per-file-transaction-fresh-session"
//   | "single-session"

export type ClusterHandle = {
  admin: Pool;
  pgMajor: number;
  createDatabase(name: string, template: string): Promise<void>;
  dropDatabase(name: string): Promise<void>;
  connect(database: string): Promise<Pool>;
};

export type SquashResult = {
  files: { name: string; sql: string }[];
  manifest: unknown;
  proof: unknown;
  diagnostics: Diagnostic[];
};
