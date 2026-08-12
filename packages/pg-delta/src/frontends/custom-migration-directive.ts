/**
 * The `-- pgdelta-migration:` head-of-file directive
 * (docs/architecture/custom-folder.md §3).
 *
 * A file in `_custom/` has two jobs and mechanically does only the first: it is
 * loaded into the SHADOW (so re-exports preserve it and dependent modeled
 * objects elaborate), while reaching the TARGET remains the operator's job via
 * their own migration channel. The directive records which migration(s)
 * delivered the file, so `schema lint` can check that twin-migration discipline
 * without pg-delta knowing anything about the migration runner:
 *
 *     -- pgdelta-migration: ../../supabase/migrations/20260811120000_add_cast.sql
 *     -- pgdelta-migration: none
 *
 * Parsing is LEXICAL and deliberately dumb — it walks the head comment block
 * (blank lines and `--` line comments before the first non-comment content) and
 * never interprets the SQL body. Nothing here understands SQL, so the "Postgres
 * is the only elaborator" invariant is untouched (precedent: pg-topo's
 * `-- pg-topo:` annotations).
 */

/** The opt-out value: this file deliberately has no migration twin. */
const NONE_VALUE = "none";

/** `-- pgdelta-migration: <value>` inside a single-line comment. The leading
 *  dashes are already stripped; the key is matched case-insensitively so a
 *  capitalized comment still counts. */
const DIRECTIVE = /^\s*pgdelta-migration\s*:(.*)$/i;

export interface CustomMigrationDirectives {
  /** Directive values other than `none`, in file order, trimmed. Paths are
   *  relative to the directory containing the custom file. */
  paths: string[];
  /** Whether at least one `-- pgdelta-migration: none` was declared. */
  hasNone: boolean;
}

/**
 * Read the `-- pgdelta-migration:` directives from `sql`'s head comment block.
 *
 * Only the head block counts: the scan stops at the first line that is neither
 * blank nor a `--` comment, so a directive buried after a statement is inert
 * (it would be invisible to a reader skimming the top of the file, which is the
 * placement the convention promises). An empty value is ignored rather than
 * recorded as a phantom path.
 */
export function parseCustomMigrationDirectives(
  sql: string,
): CustomMigrationDirectives {
  const paths: string[] = [];
  let hasNone = false;
  for (const rawLine of sql.split("\n")) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (line === "") continue;
    if (!line.startsWith("--")) break; // first non-comment content ends the head
    const match = DIRECTIVE.exec(line.replace(/^-+/, ""));
    if (match === null) continue;
    const value = (match[1] ?? "").trim();
    if (value === "") continue;
    if (value.toLowerCase() === NONE_VALUE) {
      hasNone = true;
    } else {
      paths.push(value);
    }
  }
  return { paths, hasNone };
}
