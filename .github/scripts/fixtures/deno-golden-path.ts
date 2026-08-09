import { formatSqlStatements } from "@supabase/pg-delta/sql-format";
import { analyzeAndSort } from "@supabase/pg-topo";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const topoResult = await analyzeAndSort([
  "create view public.user_names as select name from public.users;",
  "create table public.users(id int primary key, name text not null);",
]);

assert(
  topoResult.ordered.length === 2,
  "pg-topo should return 2 ordered statements",
);
assert(
  topoResult.diagnostics.length === 0,
  "pg-topo should have no diagnostics on golden path",
);
assert(
  topoResult.ordered[0]?.sql.toLowerCase().startsWith("create table"),
  "pg-topo should order table creation before dependent view",
);

const [formatted] = formatSqlStatements(["create table public.t(id int);"]);
assert(
  /create table\s+public\.t/i.test(formatted),
  "pg-delta SQL formatter should emit CREATE TABLE statement",
);
assert(
  /id\s+(int|integer)/i.test(formatted),
  "pg-delta SQL formatter should emit column definition",
);

console.log("Deno golden-path e2e passed.");
