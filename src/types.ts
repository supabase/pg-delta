import type { PGliteInterface } from "@electric-sql/pglite";

export interface PGClient {
  query: PGliteInterface["query"];
  sql: PGliteInterface["sql"];
}
