import { sql } from "@ts-safeql/sql-tag";
import type { Pool } from "pg";
import z from "zod";
import { BasePgModel } from "../../base.model.ts";

/**
 * All properties exposed by CREATE USER MAPPING statement are included in diff output.
 * https://www.postgresql.org/docs/17/sql-createusermapping.html
 *
 * ALTER USER MAPPING statement can be generated for changes to the following properties:
 *  - options
 * https://www.postgresql.org/docs/17/sql-alterusermapping.html
 *
 * User mappings are not schema-qualified (no schema property).
 * User can be a role name, CURRENT_USER, PUBLIC, etc.
 */
const userMappingPropsSchema = z.object({
  user: z.string(),
  server: z.string(),
  options: z.array(z.string()).nullable(),
  // Parent FDW handler/validator — filter metadata only, not in dataFields.
  wrapper_handler: z.string().nullable().optional(),
  wrapper_validator: z.string().nullable().optional(),
});

export type UserMappingProps = z.infer<typeof userMappingPropsSchema>;

export class UserMapping extends BasePgModel {
  public readonly user: UserMappingProps["user"];
  public readonly server: UserMappingProps["server"];
  public readonly options: UserMappingProps["options"];
  public readonly wrapper_handler: UserMappingProps["wrapper_handler"];
  public readonly wrapper_validator: UserMappingProps["wrapper_validator"];

  constructor(props: UserMappingProps) {
    super();

    // Identity fields
    this.user = props.user;
    this.server = props.server;

    // Data fields
    this.options = props.options;
    this.wrapper_handler = props.wrapper_handler ?? null;
    this.wrapper_validator = props.wrapper_validator ?? null;
  }

  get stableId(): `userMapping:${string}:${string}` {
    return `userMapping:${this.server}:${this.user}`;
  }

  get identityFields() {
    return {
      user: this.user,
      server: this.server,
    };
  }

  get dataFields() {
    return {
      options: this.options,
    };
  }
}

/**
 * Extract user mappings into `UserMapping` models.
 *
 * Reads from the world-readable `pg_catalog.pg_user_mappings` system view
 * instead of the superuser-only `pg_catalog.pg_user_mapping` catalog, so
 * non-superuser roles (e.g. the `postgres` role on Supabase hosted projects)
 * can extract a catalog — see supabase/cli#5826 / CLI-1919. The view exposes
 * `umoptions` only to privileged readers (superuser, the server owner, or the
 * mapped user with USAGE on the server); for anyone else it returns NULL, which
 * we deliberately degrade to an empty option list rather than erroring.
 *
 * When options **are** visible, the returned models carry them **verbatim**,
 * which means cleartext secrets like `password` are present in memory. Always
 * route through `extractCatalog` (which calls `normalizeCatalog`) before
 * emitting options to any output channel — see CLI-1467 and
 * `packages/pg-delta/src/core/objects/foreign-data-wrapper/sensitive-options.ts`.
 */
export async function extractUserMappings(pool: Pool): Promise<UserMapping[]> {
  const { rows: mappingRows } = await pool.query<UserMappingProps>(sql`
      select
        case
          when um.umuser = 0 then 'PUBLIC'
          else um.umuser::regrole::text
        end as user,
        quote_ident(srv.srvname) as server,
        coalesce(um.umoptions, array[]::text[]) as options,
        case
          when fdw.fdwhandler = 0 then null
          else p_handler.pronamespace::regnamespace::text || '.' || quote_ident(p_handler.proname)
        end as wrapper_handler,
        case
          when fdw.fdwvalidator = 0 then null
          else p_validator.pronamespace::regnamespace::text || '.' || quote_ident(p_validator.proname)
        end as wrapper_validator
      from
        pg_catalog.pg_user_mappings um
        inner join pg_catalog.pg_foreign_server srv on srv.oid = um.srvid
        inner join pg_catalog.pg_foreign_data_wrapper fdw on fdw.oid = srv.srvfdw
        left join pg_catalog.pg_proc p_handler on p_handler.oid = fdw.fdwhandler
        left join pg_catalog.pg_proc p_validator on p_validator.oid = fdw.fdwvalidator
      where
        not fdw.fdwname like any(array['pg\\_%'])
      order by
        srv.srvname, um.umuser
  `);

  // Validate and parse each row using the Zod schema
  const validatedRows = mappingRows.map((row: unknown) => {
    const parsed = userMappingPropsSchema.parse(row);
    // Parse options from PostgreSQL format ['key=value'] to ['key', 'value']
    if (parsed.options && parsed.options.length > 0) {
      const parsedOptions: string[] = [];
      for (const opt of parsed.options) {
        const eqIndex = opt.indexOf("=");
        if (eqIndex > 0) {
          parsedOptions.push(opt.substring(0, eqIndex));
          parsedOptions.push(opt.substring(eqIndex + 1));
        }
      }
      parsed.options = parsedOptions.length > 0 ? parsedOptions : null;
    }
    return parsed;
  });
  return validatedRows.map((row: UserMappingProps) => new UserMapping(row));
}
