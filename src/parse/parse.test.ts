import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { parse } from "./parse.ts";

describe.concurrent("parse", () => {
  test("should parse a schema", async () => {
    const { tree, ctx } = await parse(
      await readFile(
        new URL("../../tests/fixtures/schema.sql", import.meta.url),
        "utf-8",
      ),
    );
    expect(ctx).toMatchInlineSnapshot(`
      {
        "eventTriggers": Map {
          "issue_graphql_placeholder" => {
            "id": "issue_graphql_placeholder",
            "name": "issue_graphql_placeholder",
            "owner": {
              "location": 190997,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "statement": {
              "eventname": "sql_drop",
              "funcname": [
                {
                  "String": {
                    "sval": "extensions",
                  },
                },
                {
                  "String": {
                    "sval": "set_graphql_placeholder",
                  },
                },
              ],
              "trigname": "issue_graphql_placeholder",
              "whenclause": [
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "DROP EXTENSION",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "tag",
                    "location": 190856,
                  },
                },
              ],
            },
          },
          "issue_pg_cron_access" => {
            "id": "issue_pg_cron_access",
            "name": "issue_pg_cron_access",
            "owner": {
              "location": 191316,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "statement": {
              "eventname": "ddl_command_end",
              "funcname": [
                {
                  "String": {
                    "sval": "extensions",
                  },
                },
                {
                  "String": {
                    "sval": "grant_pg_cron_access",
                  },
                },
              ],
              "trigname": "issue_pg_cron_access",
              "whenclause": [
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "CREATE EXTENSION",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "tag",
                    "location": 191181,
                  },
                },
              ],
            },
          },
          "issue_pg_graphql_access" => {
            "id": "issue_pg_graphql_access",
            "name": "issue_pg_graphql_access",
            "owner": {
              "location": 191646,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "statement": {
              "eventname": "ddl_command_end",
              "funcname": [
                {
                  "String": {
                    "sval": "extensions",
                  },
                },
                {
                  "String": {
                    "sval": "grant_pg_graphql_access",
                  },
                },
              ],
              "trigname": "issue_pg_graphql_access",
              "whenclause": [
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "CREATE FUNCTION",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "tag",
                    "location": 191506,
                  },
                },
              ],
            },
          },
          "issue_pg_net_access" => {
            "id": "issue_pg_net_access",
            "name": "issue_pg_net_access",
            "owner": {
              "location": 191961,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "statement": {
              "eventname": "ddl_command_end",
              "funcname": [
                {
                  "String": {
                    "sval": "extensions",
                  },
                },
                {
                  "String": {
                    "sval": "grant_pg_net_access",
                  },
                },
              ],
              "trigname": "issue_pg_net_access",
              "whenclause": [
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "CREATE EXTENSION",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "tag",
                    "location": 191828,
                  },
                },
              ],
            },
          },
          "pgrst_ddl_watch" => {
            "id": "pgrst_ddl_watch",
            "name": "pgrst_ddl_watch",
            "owner": {
              "location": 192218,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "statement": {
              "eventname": "ddl_command_end",
              "funcname": [
                {
                  "String": {
                    "sval": "extensions",
                  },
                },
                {
                  "String": {
                    "sval": "pgrst_ddl_watch",
                  },
                },
              ],
              "trigname": "pgrst_ddl_watch",
            },
          },
          "pgrst_drop_watch" => {
            "id": "pgrst_drop_watch",
            "name": "pgrst_drop_watch",
            "owner": {
              "location": 192472,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "statement": {
              "eventname": "sql_drop",
              "funcname": [
                {
                  "String": {
                    "sval": "extensions",
                  },
                },
                {
                  "String": {
                    "sval": "pgrst_drop_watch",
                  },
                },
              ],
              "trigname": "pgrst_drop_watch",
            },
          },
        },
        "extensions": Map {
          "pg_net" => {
            "id": "pg_net",
            "name": "pg_net",
            "schema": "extensions",
            "statement": {
              "extname": "pg_net",
              "if_not_exists": true,
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "extensions",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "schema",
                    "location": 1301,
                  },
                },
              ],
            },
          },
          "pg_graphql" => {
            "id": "pg_graphql",
            "name": "pg_graphql",
            "schema": "graphql",
            "statement": {
              "extname": "pg_graphql",
              "if_not_exists": true,
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "graphql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "schema",
                    "location": 2295,
                  },
                },
              ],
            },
          },
          "pg_stat_statements" => {
            "id": "pg_stat_statements",
            "name": "pg_stat_statements",
            "schema": "extensions",
            "statement": {
              "extname": "pg_stat_statements",
              "if_not_exists": true,
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "extensions",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "schema",
                    "location": 2581,
                  },
                },
              ],
            },
          },
          "pgcrypto" => {
            "id": "pgcrypto",
            "name": "pgcrypto",
            "schema": "extensions",
            "statement": {
              "extname": "pgcrypto",
              "if_not_exists": true,
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "extensions",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "schema",
                    "location": 2909,
                  },
                },
              ],
            },
          },
          "pgjwt" => {
            "id": "pgjwt",
            "name": "pgjwt",
            "schema": "extensions",
            "statement": {
              "extname": "pgjwt",
              "if_not_exists": true,
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "extensions",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "schema",
                    "location": 3164,
                  },
                },
              ],
            },
          },
          "supabase_vault" => {
            "id": "supabase_vault",
            "name": "supabase_vault",
            "schema": "vault",
            "statement": {
              "extname": "supabase_vault",
              "if_not_exists": true,
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "vault",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "schema",
                    "location": 3441,
                  },
                },
              ],
            },
          },
          "uuid-ossp" => {
            "id": "uuid-ossp",
            "name": "uuid-ossp",
            "schema": "extensions",
            "statement": {
              "extname": "uuid-ossp",
              "if_not_exists": true,
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "extensions",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "schema",
                    "location": 3714,
                  },
                },
              ],
            },
          },
        },
        "functions": Map {
          "auth.email" => {
            "id": "auth.email",
            "name": "email",
            "schema": "auth",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "auth",
                  },
                },
                {
                  "String": {
                    "sval": "email",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "sql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 6593,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "stable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 6606,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
        select 
        coalesce(
          nullif(current_setting('request.jwt.claim.email', true), ''),
          (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
        )::text
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 6617,
                  },
                },
              ],
              "returnType": {
                "location": 6584,
                "names": [
                  {
                    "String": {
                      "sval": "text",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "auth.jwt" => {
            "id": "auth.jwt",
            "name": "jwt",
            "schema": "auth",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "auth",
                  },
                },
                {
                  "String": {
                    "sval": "jwt",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "sql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 7172,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "stable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 7185,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
        select 
          coalesce(
              nullif(current_setting('request.jwt.claim', true), ''),
              nullif(current_setting('request.jwt.claims', true), '')
          )::jsonb
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 7196,
                  },
                },
              ],
              "returnType": {
                "location": 7162,
                "names": [
                  {
                    "String": {
                      "sval": "jsonb",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "auth.role" => {
            "id": "auth.role",
            "name": "role",
            "schema": "auth",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "auth",
                  },
                },
                {
                  "String": {
                    "sval": "role",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "sql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 7556,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "stable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 7569,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
        select 
        coalesce(
          nullif(current_setting('request.jwt.claim.role', true), ''),
          (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
        )::text
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 7580,
                  },
                },
              ],
              "returnType": {
                "location": 7547,
                "names": [
                  {
                    "String": {
                      "sval": "text",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "auth.uid" => {
            "id": "auth.uid",
            "name": "uid",
            "schema": "auth",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "auth",
                  },
                },
                {
                  "String": {
                    "sval": "uid",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "sql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 8128,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "stable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 8141,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
        select 
        coalesce(
          nullif(current_setting('request.jwt.claim.sub', true), ''),
          (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
        )::uuid
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 8152,
                  },
                },
              ],
              "returnType": {
                "location": 8119,
                "names": [
                  {
                    "String": {
                      "sval": "uuid",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "extensions.grant_pg_cron_access" => {
            "id": "extensions.grant_pg_cron_access",
            "name": "grant_pg_cron_access",
            "schema": "extensions",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "extensions",
                  },
                },
                {
                  "String": {
                    "sval": "grant_pg_cron_access",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 8744,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      BEGIN
        IF EXISTS (
          SELECT
          FROM pg_event_trigger_ddl_commands() AS ev
          JOIN pg_extension AS ext
          ON ev.objid = ext.oid
          WHERE ext.extname = 'pg_cron'
        )
        THEN
          grant usage on schema cron to postgres with grant option;

          alter default privileges in schema cron grant all on tables to postgres with grant option;
          alter default privileges in schema cron grant all on functions to postgres with grant option;
          alter default privileges in schema cron grant all on sequences to postgres with grant option;

          alter default privileges for user supabase_admin in schema cron grant all
              on sequences to postgres with grant option;
          alter default privileges for user supabase_admin in schema cron grant all
              on tables to postgres with grant option;
          alter default privileges for user supabase_admin in schema cron grant all
              on functions to postgres with grant option;

          grant all privileges on all tables in schema cron to postgres with grant option;
          revoke all on table cron.job from postgres;
          grant select on table cron.job to postgres with grant option;
        END IF;
      END;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 8765,
                  },
                },
              ],
              "returnType": {
                "location": 8726,
                "names": [
                  {
                    "String": {
                      "sval": "event_trigger",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "extensions.grant_pg_graphql_access" => {
            "id": "extensions.grant_pg_graphql_access",
            "name": "grant_pg_graphql_access",
            "schema": "extensions",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "extensions",
                  },
                },
                {
                  "String": {
                    "sval": "grant_pg_graphql_access",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 10360,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      DECLARE
          func_is_graphql_resolve bool;
      BEGIN
          func_is_graphql_resolve = (
              SELECT n.proname = 'resolve'
              FROM pg_event_trigger_ddl_commands() AS ev
              LEFT JOIN pg_catalog.pg_proc AS n
              ON ev.objid = n.oid
          );

          IF func_is_graphql_resolve
          THEN
              -- Update public wrapper to pass all arguments through to the pg_graphql resolve func
              DROP FUNCTION IF EXISTS graphql_public.graphql;
              create or replace function graphql_public.graphql(
                  "operationName" text default null,
                  query text default null,
                  variables jsonb default null,
                  extensions jsonb default null
              )
                  returns jsonb
                  language sql
              as $$
                  select graphql.resolve(
                      query := query,
                      variables := coalesce(variables, '{}'),
                      "operationName" := "operationName",
                      extensions := extensions
                  );
              $$;

              -- This hook executes when \`graphql.resolve\` is created. That is not necessarily the last
              -- function in the extension so we need to grant permissions on existing entities AND
              -- update default permissions to any others that are created after \`graphql.resolve\`
              grant usage on schema graphql to postgres, anon, authenticated, service_role;
              grant select on all tables in schema graphql to postgres, anon, authenticated, service_role;
              grant execute on all functions in schema graphql to postgres, anon, authenticated, service_role;
              grant all on all sequences in schema graphql to postgres, anon, authenticated, service_role;
              alter default privileges in schema graphql grant all on tables to postgres, anon, authenticated, service_role;
              alter default privileges in schema graphql grant all on functions to postgres, anon, authenticated, service_role;
              alter default privileges in schema graphql grant all on sequences to postgres, anon, authenticated, service_role;

              -- Allow postgres role to allow granting usage on graphql and graphql_public schemas to custom roles
              grant usage on schema graphql_public to postgres with grant option;
              grant usage on schema graphql to postgres with grant option;
          END IF;

      END;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 10381,
                  },
                },
              ],
              "returnType": {
                "location": 10342,
                "names": [
                  {
                    "String": {
                      "sval": "event_trigger",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "extensions.grant_pg_net_access" => {
            "id": "extensions.grant_pg_net_access",
            "name": "grant_pg_net_access",
            "schema": "extensions",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "extensions",
                  },
                },
                {
                  "String": {
                    "sval": "grant_pg_net_access",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 13144,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_event_trigger_ddl_commands() AS ev
          JOIN pg_extension AS ext
          ON ev.objid = ext.oid
          WHERE ext.extname = 'pg_net'
        )
        THEN
          GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

          ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
          ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

          ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
          ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

          REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
          REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

          GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
          GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
        END IF;
      END;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 13165,
                  },
                },
              ],
              "returnType": {
                "location": 13126,
                "names": [
                  {
                    "String": {
                      "sval": "event_trigger",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "extensions.pgrst_ddl_watch" => {
            "id": "extensions.pgrst_ddl_watch",
            "name": "pgrst_ddl_watch",
            "schema": "extensions",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "extensions",
                  },
                },
                {
                  "String": {
                    "sval": "pgrst_ddl_watch",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 15061,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      DECLARE
        cmd record;
      BEGIN
        FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
        LOOP
          IF cmd.command_tag IN (
            'CREATE SCHEMA', 'ALTER SCHEMA'
          , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
          , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
          , 'CREATE VIEW', 'ALTER VIEW'
          , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
          , 'CREATE FUNCTION', 'ALTER FUNCTION'
          , 'CREATE TRIGGER'
          , 'CREATE TYPE', 'ALTER TYPE'
          , 'CREATE RULE'
          , 'COMMENT'
          )
          -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
          AND cmd.schema_name is distinct from 'pg_temp'
          THEN
            NOTIFY pgrst, 'reload schema';
          END IF;
        END LOOP;
      END; ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 15082,
                  },
                },
              ],
              "returnType": {
                "location": 15043,
                "names": [
                  {
                    "String": {
                      "sval": "event_trigger",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "extensions.pgrst_drop_watch" => {
            "id": "extensions.pgrst_drop_watch",
            "name": "pgrst_drop_watch",
            "schema": "extensions",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "extensions",
                  },
                },
                {
                  "String": {
                    "sval": "pgrst_drop_watch",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 16058,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      DECLARE
        obj record;
      BEGIN
        FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
        LOOP
          IF obj.object_type IN (
            'schema'
          , 'table'
          , 'foreign table'
          , 'view'
          , 'materialized view'
          , 'function'
          , 'trigger'
          , 'type'
          , 'rule'
          )
          AND obj.is_temporary IS false -- no pg_temp objects
          THEN
            NOTIFY pgrst, 'reload schema';
          END IF;
        END LOOP;
      END; ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 16079,
                  },
                },
              ],
              "returnType": {
                "location": 16040,
                "names": [
                  {
                    "String": {
                      "sval": "event_trigger",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "extensions.set_graphql_placeholder" => {
            "id": "extensions.set_graphql_placeholder",
            "name": "set_graphql_placeholder",
            "schema": "extensions",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "extensions",
                  },
                },
                {
                  "String": {
                    "sval": "set_graphql_placeholder",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 16753,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
          DECLARE
          graphql_is_dropped bool;
          BEGIN
          graphql_is_dropped = (
              SELECT ev.schema_name = 'graphql_public'
              FROM pg_event_trigger_dropped_objects() AS ev
              WHERE ev.schema_name = 'graphql_public'
          );

          IF graphql_is_dropped
          THEN
              create or replace function graphql_public.graphql(
                  "operationName" text default null,
                  query text default null,
                  variables jsonb default null,
                  extensions jsonb default null
              )
                  returns jsonb
                  language plpgsql
              as $$
                  DECLARE
                      server_version float;
                  BEGIN
                      server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                      IF server_version >= 14 THEN
                          RETURN jsonb_build_object(
                              'errors', jsonb_build_array(
                                  jsonb_build_object(
                                      'message', 'pg_graphql extension is not enabled.'
                                  )
                              )
                          );
                      ELSE
                          RETURN jsonb_build_object(
                              'errors', jsonb_build_array(
                                  jsonb_build_object(
                                      'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                                  )
                              )
                          );
                      END IF;
                  END;
              $$;
          END IF;

          END;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 16774,
                  },
                },
              ],
              "returnType": {
                "location": 16735,
                "names": [
                  {
                    "String": {
                      "sval": "event_trigger",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "pgbouncer.get_auth" => {
            "id": "pgbouncer.get_auth",
            "name": "get_auth",
            "schema": "pgbouncer",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "pgbouncer",
                  },
                },
                {
                  "String": {
                    "sval": "get_auth",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 18827,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "Boolean": {
                        "boolval": true,
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "security",
                    "location": 18844,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      begin
          raise debug 'PgBouncer auth request: %', p_usename;

          return query
          select 
              rolname::text, 
              case when rolvaliduntil < now() 
                  then null 
                  else rolpassword::text 
              end 
          from pg_authid 
          where rolname=$1 and rolcanlogin;
      end;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 18865,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 18773,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "p_usename",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 18802,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "username",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 18817,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "password",
                  },
                },
              ],
              "returnType": {
                "location": 18787,
                "names": [
                  {
                    "String": {
                      "sval": "pg_catalog",
                    },
                  },
                  {
                    "String": {
                      "sval": "record",
                    },
                  },
                ],
                "setof": true,
                "typemod": -1,
              },
            },
          },
          "realtime.apply_rls" => {
            "id": "realtime.apply_rls",
            "name": "apply_rls",
            "schema": "realtime",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "realtime",
                  },
                },
                {
                  "String": {
                    "sval": "apply_rls",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 19475,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      declare
      -- Regclass of the table e.g. public.notes
      entity_ regclass = (quote_ident(wal ->> 'schema') || '.' || quote_ident(wal ->> 'table'))::regclass;

      -- I, U, D, T: insert, update ...
      action realtime.action = (
          case wal ->> 'action'
              when 'I' then 'INSERT'
              when 'U' then 'UPDATE'
              when 'D' then 'DELETE'
              else 'ERROR'
          end
      );

      -- Is row level security enabled for the table
      is_rls_enabled bool = relrowsecurity from pg_class where oid = entity_;

      subscriptions realtime.subscription[] = array_agg(subs)
          from
              realtime.subscription subs
          where
              subs.entity = entity_;

      -- Subscription vars
      roles regrole[] = array_agg(distinct us.claims_role::text)
          from
              unnest(subscriptions) us;

      working_role regrole;
      claimed_role regrole;
      claims jsonb;

      subscription_id uuid;
      subscription_has_access bool;
      visible_to_subscription_ids uuid[] = '{}';

      -- structured info for wal's columns
      columns realtime.wal_column[];
      -- previous identity values for update/delete
      old_columns realtime.wal_column[];

      error_record_exceeds_max_size boolean = octet_length(wal::text) > max_record_bytes;

      -- Primary jsonb output for record
      output jsonb;

      begin
      perform set_config('role', null, true);

      columns =
          array_agg(
              (
                  x->>'name',
                  x->>'type',
                  x->>'typeoid',
                  realtime.cast(
                      (x->'value') #>> '{}',
                      coalesce(
                          (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                          (x->>'type')::regtype
                      )
                  ),
                  (pks ->> 'name') is not null,
                  true
              )::realtime.wal_column
          )
          from
              jsonb_array_elements(wal -> 'columns') x
              left join jsonb_array_elements(wal -> 'pk') pks
                  on (x ->> 'name') = (pks ->> 'name');

      old_columns =
          array_agg(
              (
                  x->>'name',
                  x->>'type',
                  x->>'typeoid',
                  realtime.cast(
                      (x->'value') #>> '{}',
                      coalesce(
                          (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                          (x->>'type')::regtype
                      )
                  ),
                  (pks ->> 'name') is not null,
                  true
              )::realtime.wal_column
          )
          from
              jsonb_array_elements(wal -> 'identity') x
              left join jsonb_array_elements(wal -> 'pk') pks
                  on (x ->> 'name') = (pks ->> 'name');

      for working_role in select * from unnest(roles) loop

          -- Update \`is_selectable\` for columns and old_columns
          columns =
              array_agg(
                  (
                      c.name,
                      c.type_name,
                      c.type_oid,
                      c.value,
                      c.is_pkey,
                      pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                  )::realtime.wal_column
              )
              from
                  unnest(columns) c;

          old_columns =
                  array_agg(
                      (
                          c.name,
                          c.type_name,
                          c.type_oid,
                          c.value,
                          c.is_pkey,
                          pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                      )::realtime.wal_column
                  )
                  from
                      unnest(old_columns) c;

          if action <> 'DELETE' and count(1) = 0 from unnest(columns) c where c.is_pkey then
              return next (
                  jsonb_build_object(
                      'schema', wal ->> 'schema',
                      'table', wal ->> 'table',
                      'type', action
                  ),
                  is_rls_enabled,
                  -- subscriptions is already filtered by entity
                  (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
                  array['Error 400: Bad Request, no primary key']
              )::realtime.wal_rls;

          -- The claims role does not have SELECT permission to the primary key of entity
          elsif action <> 'DELETE' and sum(c.is_selectable::int) <> count(1) from unnest(columns) c where c.is_pkey then
              return next (
                  jsonb_build_object(
                      'schema', wal ->> 'schema',
                      'table', wal ->> 'table',
                      'type', action
                  ),
                  is_rls_enabled,
                  (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
                  array['Error 401: Unauthorized']
              )::realtime.wal_rls;

          else
              output = jsonb_build_object(
                  'schema', wal ->> 'schema',
                  'table', wal ->> 'table',
                  'type', action,
                  'commit_timestamp', to_char(
                      ((wal ->> 'timestamp')::timestamptz at time zone 'utc'),
                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                  ),
                  'columns', (
                      select
                          jsonb_agg(
                              jsonb_build_object(
                                  'name', pa.attname,
                                  'type', pt.typname
                              )
                              order by pa.attnum asc
                          )
                      from
                          pg_attribute pa
                          join pg_type pt
                              on pa.atttypid = pt.oid
                      where
                          attrelid = entity_
                          and attnum > 0
                          and pg_catalog.has_column_privilege(working_role, entity_, pa.attname, 'SELECT')
                  )
              )
              -- Add "record" key for insert and update
              || case
                  when action in ('INSERT', 'UPDATE') then
                      jsonb_build_object(
                          'record',
                          (
                              select
                                  jsonb_object_agg(
                                      -- if unchanged toast, get column name and value from old record
                                      coalesce((c).name, (oc).name),
                                      case
                                          when (c).name is null then (oc).value
                                          else (c).value
                                      end
                                  )
                              from
                                  unnest(columns) c
                                  full outer join unnest(old_columns) oc
                                      on (c).name = (oc).name
                              where
                                  coalesce((c).is_selectable, (oc).is_selectable)
                                  and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                          )
                      )
                  else '{}'::jsonb
              end
              -- Add "old_record" key for update and delete
              || case
                  when action = 'UPDATE' then
                      jsonb_build_object(
                              'old_record',
                              (
                                  select jsonb_object_agg((c).name, (c).value)
                                  from unnest(old_columns) c
                                  where
                                      (c).is_selectable
                                      and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                              )
                          )
                  when action = 'DELETE' then
                      jsonb_build_object(
                          'old_record',
                          (
                              select jsonb_object_agg((c).name, (c).value)
                              from unnest(old_columns) c
                              where
                                  (c).is_selectable
                                  and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                                  and ( not is_rls_enabled or (c).is_pkey ) -- if RLS enabled, we can't secure deletes so filter to pkey
                          )
                      )
                  else '{}'::jsonb
              end;

              -- Create the prepared statement
              if is_rls_enabled and action <> 'DELETE' then
                  if (select 1 from pg_prepared_statements where name = 'walrus_rls_stmt' limit 1) > 0 then
                      deallocate walrus_rls_stmt;
                  end if;
                  execute realtime.build_prepared_statement_sql('walrus_rls_stmt', entity_, columns);
              end if;

              visible_to_subscription_ids = '{}';

              for subscription_id, claims in (
                      select
                          subs.subscription_id,
                          subs.claims
                      from
                          unnest(subscriptions) subs
                      where
                          subs.entity = entity_
                          and subs.claims_role = working_role
                          and (
                              realtime.is_visible_through_filters(columns, subs.filters)
                              or (
                                action = 'DELETE'
                                and realtime.is_visible_through_filters(old_columns, subs.filters)
                              )
                          )
              ) loop

                  if not is_rls_enabled or action = 'DELETE' then
                      visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
                  else
                      -- Check if RLS allows the role to see the record
                      perform
                          -- Trim leading and trailing quotes from working_role because set_config
                          -- doesn't recognize the role as valid if they are included
                          set_config('role', trim(both '"' from working_role::text), true),
                          set_config('request.jwt.claims', claims::text, true);

                      execute 'execute walrus_rls_stmt' into subscription_has_access;

                      if subscription_has_access then
                          visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
                      end if;
                  end if;
              end loop;

              perform set_config('role', null, true);

              return next (
                  output,
                  is_rls_enabled,
                  visible_to_subscription_ids,
                  case
                      when error_record_exceeds_max_size then array['Error 413: Payload Too Large']
                      else '{}'
                  end
              )::realtime.wal_rls;

          end if;
      end loop;

      perform set_config('role', null, true);
      end;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 19496,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 19385,
                      "names": [
                        {
                          "String": {
                            "sval": "jsonb",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "wal",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 19409,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "int4",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "A_Expr": {
                        "kind": "AEXPR_OP",
                        "lexpr": {
                          "A_Const": {
                            "ival": {
                              "ival": 1024,
                            },
                            "location": 19426,
                          },
                        },
                        "location": 19431,
                        "name": [
                          {
                            "String": {
                              "sval": "*",
                            },
                          },
                        ],
                        "rexpr": {
                          "A_Const": {
                            "ival": {
                              "ival": 1024,
                            },
                            "location": 19433,
                          },
                        },
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "max_record_bytes",
                  },
                },
              ],
              "returnType": {
                "location": 19454,
                "names": [
                  {
                    "String": {
                      "sval": "realtime",
                    },
                  },
                  {
                    "String": {
                      "sval": "wal_rls",
                    },
                  },
                ],
                "setof": true,
                "typemod": -1,
              },
            },
          },
          "realtime.broadcast_changes" => {
            "id": "realtime.broadcast_changes",
            "name": "broadcast_changes",
            "schema": "realtime",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "realtime",
                  },
                },
                {
                  "String": {
                    "sval": "broadcast_changes",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 30279,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      DECLARE
          -- Declare a variable to hold the JSONB representation of the row
          row_data jsonb := '{}'::jsonb;
      BEGIN
          IF level = 'STATEMENT' THEN
              RAISE EXCEPTION 'function can only be triggered for each row, not for each statement';
          END IF;
          -- Check the operation type and handle accordingly
          IF operation = 'INSERT' OR operation = 'UPDATE' OR operation = 'DELETE' THEN
              row_data := jsonb_build_object('old_record', OLD, 'record', NEW, 'operation', operation, 'table', table_name, 'schema', table_schema);
              PERFORM realtime.send (row_data, event_name, topic_name);
          ELSE
              RAISE EXCEPTION 'Unexpected operation type: %', operation;
          END IF;
      EXCEPTION
          WHEN OTHERS THEN
              RAISE EXCEPTION 'Failed to process the row: %', SQLERRM;
      END;

      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 30300,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 30131,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "topic_name",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 30148,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "event_name",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 30164,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "operation",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 30181,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "table_name",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 30200,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "table_schema",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 30210,
                      "names": [
                        {
                          "String": {
                            "sval": "record",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "new",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 30222,
                      "names": [
                        {
                          "String": {
                            "sval": "record",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "old",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 30236,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "TypeCast": {
                        "arg": {
                          "A_Const": {
                            "location": 30249,
                            "sval": {
                              "sval": "ROW",
                            },
                          },
                        },
                        "location": 30254,
                        "typeName": {
                          "location": 30256,
                          "names": [
                            {
                              "String": {
                                "sval": "text",
                              },
                            },
                          ],
                          "typemod": -1,
                        },
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "level",
                  },
                },
              ],
              "returnType": {
                "location": 30270,
                "names": [
                  {
                    "String": {
                      "sval": "void",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "realtime.build_prepared_statement_sql" => {
            "id": "realtime.build_prepared_statement_sql",
            "name": "build_prepared_statement_sql",
            "schema": "realtime",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "realtime",
                  },
                },
                {
                  "String": {
                    "sval": "build_prepared_statement_sql",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "sql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 31585,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
            /*
            Builds a sql string that, if executed, creates a prepared statement to
            tests retrive a row from *entity* by its primary key columns.
            Example
                select realtime.build_prepared_statement_sql('public.notes', '{"id"}'::text[], '{"bigint"}'::text[])
            */
                select
            'prepare ' || prepared_statement_name || ' as
                select
                    exists(
                        select
                            1
                        from
                            ' || entity || '
                        where
                            ' || string_agg(quote_ident(pkc.name) || '=' || quote_nullable(pkc.value #>> '{}') , ' and ') || '
                    )'
                from
                    unnest(columns) pkc
                where
                    pkc.is_pkey
                group by
                    entity
            ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 31602,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 31514,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "prepared_statement_name",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 31527,
                      "names": [
                        {
                          "String": {
                            "sval": "regclass",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "entity",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "arrayBounds": [
                        {
                          "Integer": {
                            "ival": -1,
                          },
                        },
                      ],
                      "location": 31545,
                      "names": [
                        {
                          "String": {
                            "sval": "realtime",
                          },
                        },
                        {
                          "String": {
                            "sval": "wal_column",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "columns",
                  },
                },
              ],
              "returnType": {
                "location": 31576,
                "names": [
                  {
                    "String": {
                      "sval": "text",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "realtime.cast" => {
            "id": "realtime.cast",
            "name": "cast",
            "schema": "realtime",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "realtime",
                  },
                },
                {
                  "String": {
                    "sval": "cast",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 32745,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "immutable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 32762,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
          declare
            res jsonb;
          begin
            execute format('select to_jsonb(%L::'|| type_::text || ')', val)  into res;
            return res;
          end
          ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 32776,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 32706,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "val",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 32718,
                      "names": [
                        {
                          "String": {
                            "sval": "regtype",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "type_",
                  },
                },
              ],
              "returnType": {
                "location": 32735,
                "names": [
                  {
                    "String": {
                      "sval": "jsonb",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "realtime.check_equality_op" => {
            "id": "realtime.check_equality_op",
            "name": "check_equality_op",
            "schema": "realtime",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "realtime",
                  },
                },
                {
                  "String": {
                    "sval": "check_equality_op",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 33282,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "immutable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 33299,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
            /*
            Casts *val_1* and *val_2* as type *type_* and check the *op* condition for truthiness
            */
            declare
                op_symbol text = (
                    case
                        when op = 'eq' then '='
                        when op = 'neq' then '!='
                        when op = 'lt' then '<'
                        when op = 'lte' then '<='
                        when op = 'gt' then '>'
                        when op = 'gte' then '>='
                        when op = 'in' then '= any'
                        else 'UNKNOWN OP'
                    end
                );
                res boolean;
            begin
                execute format(
                    'select %L::'|| type_::text || ' ' || op_symbol
                    || ' ( %L::'
                    || (
                        case
                            when op = 'in' then type_::text || '[]'
                            else type_::text end
                    )
                    || ')', val_1, val_2) into res;
                return res;
            end;
            ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 33313,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 33201,
                      "names": [
                        {
                          "String": {
                            "sval": "realtime",
                          },
                        },
                        {
                          "String": {
                            "sval": "equality_op",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "op",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 33229,
                      "names": [
                        {
                          "String": {
                            "sval": "regtype",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "type_",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 33244,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "val_1",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 33256,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "val_2",
                  },
                },
              ],
              "returnType": {
                "location": 33270,
                "names": [
                  {
                    "String": {
                      "sval": "pg_catalog",
                    },
                  },
                  {
                    "String": {
                      "sval": "bool",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "realtime.is_visible_through_filters" => {
            "id": "realtime.is_visible_through_filters",
            "name": "is_visible_through_filters",
            "schema": "realtime",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "realtime",
                  },
                },
                {
                  "String": {
                    "sval": "is_visible_through_filters",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "sql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 34696,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "immutable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 34709,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
          /*
          Should the record be visible (true) or filtered out (false) after *filters* are applied
          */
              select
                  -- Default to allowed when no filters present
                  $2 is null -- no filters. this should not happen because subscriptions has a default
                  or array_length($2, 1) is null -- array length of an empty array is null
                  or bool_and(
                      coalesce(
                          realtime.check_equality_op(
                              op:=f.op,
                              type_:=coalesce(
                                  col.type_oid::regtype, -- null when wal2json version <= 2.4
                                  col.type_name::regtype
                              ),
                              -- cast jsonb to text
                              val_1:=col.value #>> '{}',
                              val_2:=f.value
                          ),
                          false -- if null, filter does not match
                      )
                  )
              from
                  unnest(filters) f
                  join unnest(columns) col
                      on f.column_name = col.name;
          ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 34723,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "arrayBounds": [
                        {
                          "Integer": {
                            "ival": -1,
                          },
                        },
                      ],
                      "location": 34613,
                      "names": [
                        {
                          "String": {
                            "sval": "realtime",
                          },
                        },
                        {
                          "String": {
                            "sval": "wal_column",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "columns",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "arrayBounds": [
                        {
                          "Integer": {
                            "ival": -1,
                          },
                        },
                      ],
                      "location": 34644,
                      "names": [
                        {
                          "String": {
                            "sval": "realtime",
                          },
                        },
                        {
                          "String": {
                            "sval": "user_defined_filter",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "filters",
                  },
                },
              ],
              "returnType": {
                "location": 34684,
                "names": [
                  {
                    "String": {
                      "sval": "pg_catalog",
                    },
                  },
                  {
                    "String": {
                      "sval": "bool",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "realtime.list_changes" => {
            "id": "realtime.list_changes",
            "name": "list_changes",
            "schema": "realtime",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "realtime",
                  },
                },
                {
                  "String": {
                    "sval": "list_changes",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "sql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 36236,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "VariableSetStmt": {
                        "args": [
                          {
                            "A_Const": {
                              "location": 36277,
                              "sval": {
                                "sval": "fatal",
                              },
                            },
                          },
                        ],
                        "kind": "VAR_SET_VALUE",
                        "name": "log_min_messages",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "set",
                    "location": 36253,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
            with pub as (
              select
                concat_ws(
                  ',',
                  case when bool_or(pubinsert) then 'insert' else null end,
                  case when bool_or(pubupdate) then 'update' else null end,
                  case when bool_or(pubdelete) then 'delete' else null end
                ) as w2j_actions,
                coalesce(
                  string_agg(
                    realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
                    ','
                  ) filter (where ppt.tablename is not null and ppt.tablename not like '% %'),
                  ''
                ) w2j_add_tables
              from
                pg_publication pp
                left join pg_publication_tables ppt
                  on pp.pubname = ppt.pubname
              where
                pp.pubname = publication
              group by
                pp.pubname
              limit 1
            ),
            w2j as (
              select
                x.*, pub.w2j_add_tables
              from
                pub,
                pg_logical_slot_get_changes(
                  slot_name, null, max_changes,
                  'include-pk', 'true',
                  'include-transaction', 'false',
                  'include-timestamp', 'true',
                  'include-type-oids', 'true',
                  'format-version', '2',
                  'actions', pub.w2j_actions,
                  'add-tables', pub.w2j_add_tables
                ) x
            )
            select
              xyz.wal,
              xyz.is_rls_enabled,
              xyz.subscription_ids,
              xyz.errors
            from
              w2j,
              realtime.apply_rls(
                wal := w2j.data::jsonb,
                max_record_bytes := max_record_bytes
              ) xyz(wal, is_rls_enabled, subscription_ids, errors)
            where
              w2j.w2j_add_tables <> ''
              and xyz.subscription_ids[1] is not null
          ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 36289,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 36132,
                      "names": [
                        {
                          "String": {
                            "sval": "name",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "publication",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 36148,
                      "names": [
                        {
                          "String": {
                            "sval": "name",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "slot_name",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 36166,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "int4",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "max_changes",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 36192,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "int4",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "max_record_bytes",
                  },
                },
              ],
              "returnType": {
                "location": 36215,
                "names": [
                  {
                    "String": {
                      "sval": "realtime",
                    },
                  },
                  {
                    "String": {
                      "sval": "wal_rls",
                    },
                  },
                ],
                "setof": true,
                "typemod": -1,
              },
            },
          },
          "realtime.quote_wal2json" => {
            "id": "realtime.quote_wal2json",
            "name": "quote_wal2json",
            "schema": "realtime",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "realtime",
                  },
                },
                {
                  "String": {
                    "sval": "quote_wal2json",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "sql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 38321,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "immutable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 38334,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "Boolean": {
                        "boolval": true,
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "strict",
                    "location": 38344,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
            select
              (
                select string_agg('' || ch,'')
                from unnest(string_to_array(nsp.nspname::text, null)) with ordinality x(ch, idx)
                where
                  not (x.idx = 1 and x.ch = '"')
                  and not (
                    x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
                    and x.ch = '"'
                  )
              )
              || '.'
              || (
                select string_agg('' || ch,'')
                from unnest(string_to_array(pc.relname::text, null)) with ordinality x(ch, idx)
                where
                  not (x.idx = 1 and x.ch = '"')
                  and not (
                    x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
                    and x.ch = '"'
                  )
                )
            from
              pg_class pc
              join pg_namespace nsp
                on pc.relnamespace = nsp.oid
            where
              pc.oid = entity
          ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 38355,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 38294,
                      "names": [
                        {
                          "String": {
                            "sval": "regclass",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "entity",
                  },
                },
              ],
              "returnType": {
                "location": 38312,
                "names": [
                  {
                    "String": {
                      "sval": "text",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "realtime.send" => {
            "id": "realtime.send",
            "name": "send",
            "schema": "realtime",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "realtime",
                  },
                },
                {
                  "String": {
                    "sval": "send",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 39555,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      BEGIN
        BEGIN
          -- Set the topic configuration
          EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

          -- Attempt to insert the message
          INSERT INTO realtime.messages (payload, event, topic, private, extension)
          VALUES (payload, event, topic, private, 'broadcast');
        EXCEPTION
          WHEN OTHERS THEN
            -- Capture and notify the error
            PERFORM pg_notify(
                'realtime:system',
                jsonb_build_object(
                    'error', SQLERRM,
                    'function', 'realtime.send',
                    'event', event,
                    'topic', topic,
                    'private', private
                )::text
            );
        END;
      END;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 39576,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 39477,
                      "names": [
                        {
                          "String": {
                            "sval": "jsonb",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "payload",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 39490,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "event",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 39502,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "topic",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 39516,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "bool",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "A_Const": {
                        "boolval": {
                          "boolval": true,
                        },
                        "location": 39532,
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "private",
                  },
                },
              ],
              "returnType": {
                "location": 39546,
                "names": [
                  {
                    "String": {
                      "sval": "void",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "realtime.subscription_check_filters" => {
            "id": "realtime.subscription_check_filters",
            "name": "subscription_check_filters",
            "schema": "realtime",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "realtime",
                  },
                },
                {
                  "String": {
                    "sval": "subscription_check_filters",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 40521,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
          /*
          Validates that the user defined filters for a subscription:
          - refer to valid columns that the claimed role may access
          - values are coercable to the correct column type
          */
          declare
              col_names text[] = coalesce(
                      array_agg(c.column_name order by c.ordinal_position),
                      '{}'::text[]
                  )
                  from
                      information_schema.columns c
                  where
                      format('%I.%I', c.table_schema, c.table_name)::regclass = new.entity
                      and pg_catalog.has_column_privilege(
                          (new.claims ->> 'role'),
                          format('%I.%I', c.table_schema, c.table_name)::regclass,
                          c.column_name,
                          'SELECT'
                      );
              filter realtime.user_defined_filter;
              col_type regtype;

              in_val jsonb;
          begin
              for filter in select * from unnest(new.filters) loop
                  -- Filtered column is valid
                  if not filter.column_name = any(col_names) then
                      raise exception 'invalid column for filter %', filter.column_name;
                  end if;

                  -- Type is sanitized and safe for string interpolation
                  col_type = (
                      select atttypid::regtype
                      from pg_catalog.pg_attribute
                      where attrelid = new.entity
                            and attname = filter.column_name
                  );
                  if col_type is null then
                      raise exception 'failed to lookup type for column %', filter.column_name;
                  end if;

                  -- Set maximum number of entries for in filter
                  if filter.op = 'in'::realtime.equality_op then
                      in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
                      if coalesce(jsonb_array_length(in_val), 0) > 100 then
                          raise exception 'too many values for \`in\` filter. Maximum 100';
                      end if;
                  else
                      -- raises an exception if value is not coercable to type
                      perform realtime.cast(filter.value, col_type);
                  end if;

              end loop;

              -- Apply consistent order to filters so the unique constraint on
              -- (subscription_id, entity, filters) can't be tricked by a different filter order
              new.filters = coalesce(
                  array_agg(f order by f.column_name, f.op, f.value),
                  '{}'
              ) from unnest(new.filters) f;

              return new;
          end;
          ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 40542,
                  },
                },
              ],
              "returnType": {
                "location": 40509,
                "names": [
                  {
                    "String": {
                      "sval": "trigger",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "realtime.to_regrole" => {
            "id": "realtime.to_regrole",
            "name": "to_regrole",
            "schema": "realtime",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "realtime",
                  },
                },
                {
                  "String": {
                    "sval": "to_regrole",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "sql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 43310,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "immutable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 43323,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": " select role_name::regrole ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 43337,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 43284,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "role_name",
                  },
                },
              ],
              "returnType": {
                "location": 43298,
                "names": [
                  {
                    "String": {
                      "sval": "regrole",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "realtime.topic" => {
            "id": "realtime.topic",
            "name": "topic",
            "schema": "realtime",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "realtime",
                  },
                },
                {
                  "String": {
                    "sval": "topic",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "sql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 43592,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "stable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 43605,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      select nullif(current_setting('realtime.topic', true), '')::text;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 43616,
                  },
                },
              ],
              "returnType": {
                "location": 43583,
                "names": [
                  {
                    "String": {
                      "sval": "text",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "storage.add_prefixes" => {
            "id": "storage.add_prefixes",
            "name": "add_prefixes",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "add_prefixes",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 43949,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "Boolean": {
                        "boolval": true,
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "security",
                    "location": 43966,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      DECLARE
          prefixes text[];
      BEGIN
          prefixes := "storage"."get_prefixes"("_name");

          IF array_length(prefixes, 1) > 0 THEN
              INSERT INTO storage.prefixes (name, bucket_id)
              SELECT UNNEST(prefixes) as name, "_bucket_id" ON CONFLICT DO NOTHING;
          END IF;
      END;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 43987,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 43914,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "_bucket_id",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 43926,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "_name",
                  },
                },
              ],
              "returnType": {
                "location": 43940,
                "names": [
                  {
                    "String": {
                      "sval": "void",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "storage.can_insert_object" => {
            "id": "storage.can_insert_object",
            "name": "can_insert_object",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "can_insert_object",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 44613,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      BEGIN
        INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
        -- hack to rollback the successful insert
        RAISE sqlstate 'PT200' using
        message = 'ROLLBACK',
        detail = 'rollback successful insert';
      END
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 44634,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 44551,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "bucketid",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 44562,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "name",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 44574,
                      "names": [
                        {
                          "String": {
                            "sval": "uuid",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "owner",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 44589,
                      "names": [
                        {
                          "String": {
                            "sval": "jsonb",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "metadata",
                  },
                },
              ],
              "returnType": {
                "location": 44604,
                "names": [
                  {
                    "String": {
                      "sval": "void",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "storage.delete_prefix" => {
            "id": "storage.delete_prefix",
            "name": "delete_prefix",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "delete_prefix",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 45237,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "Boolean": {
                        "boolval": true,
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "security",
                    "location": 45254,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      BEGIN
          -- Check if we can delete the prefix
          IF EXISTS(
              SELECT FROM "storage"."prefixes"
              WHERE "prefixes"."bucket_id" = "_bucket_id"
                AND level = "storage"."get_level"("_name") + 1
                AND "prefixes"."name" COLLATE "C" LIKE "_name" || '/%'
              LIMIT 1
          )
          OR EXISTS(
              SELECT FROM "storage"."objects"
              WHERE "objects"."bucket_id" = "_bucket_id"
                AND "storage"."get_level"("objects"."name") = "storage"."get_level"("_name") + 1
                AND "objects"."name" COLLATE "C" LIKE "_name" || '/%'
              LIMIT 1
          ) THEN
          -- There are sub-objects, skip deletion
          RETURN false;
          ELSE
              DELETE FROM "storage"."prefixes"
              WHERE "prefixes"."bucket_id" = "_bucket_id"
                AND level = "storage"."get_level"("_name")
                AND "prefixes"."name" = "_name";
              RETURN true;
          END IF;
      END;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 45275,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 45199,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "_bucket_id",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 45211,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "_name",
                  },
                },
              ],
              "returnType": {
                "location": 45225,
                "names": [
                  {
                    "String": {
                      "sval": "pg_catalog",
                    },
                  },
                  {
                    "String": {
                      "sval": "bool",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "storage.delete_prefix_hierarchy_trigger" => {
            "id": "storage.delete_prefix_hierarchy_trigger",
            "name": "delete_prefix_hierarchy_trigger",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "delete_prefix_hierarchy_trigger",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 46464,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      DECLARE
          prefix text;
      BEGIN
          prefix := "storage"."get_prefix"(OLD."name");

          IF coalesce(prefix, '') != '' THEN
              PERFORM "storage"."delete_prefix"(OLD."bucket_id", prefix);
          END IF;

          RETURN OLD;
      END;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 46485,
                  },
                },
              ],
              "returnType": {
                "location": 46452,
                "names": [
                  {
                    "String": {
                      "sval": "trigger",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "storage.enforce_bucket_name_length" => {
            "id": "storage.enforce_bucket_name_length",
            "name": "enforce_bucket_name_length",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "enforce_bucket_name_length",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 46993,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      begin
          if length(new.name) > 100 then
              raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
          end if;
          return new;
      end;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 47014,
                  },
                },
              ],
              "returnType": {
                "location": 46981,
                "names": [
                  {
                    "String": {
                      "sval": "trigger",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "storage.extension" => {
            "id": "storage.extension",
            "name": "extension",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "extension",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 47455,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "immutable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 47472,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      DECLARE
          _parts text[];
          _filename text;
      BEGIN
          SELECT string_to_array(name, '/') INTO _parts;
          SELECT _parts[array_length(_parts,1)] INTO _filename;
          RETURN reverse(split_part(reverse(_filename), '.', 1));
      END
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 47486,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 47432,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "name",
                  },
                },
              ],
              "returnType": {
                "location": 47446,
                "names": [
                  {
                    "String": {
                      "sval": "text",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "storage.filename" => {
            "id": "storage.filename",
            "name": "filename",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "filename",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 47958,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      DECLARE
      _parts text[];
      BEGIN
      	select string_to_array(name, '/') into _parts;
      	return _parts[array_length(_parts,1)];
      END
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 47979,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 47935,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "name",
                  },
                },
              ],
              "returnType": {
                "location": 47949,
                "names": [
                  {
                    "String": {
                      "sval": "text",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "storage.foldername" => {
            "id": "storage.foldername",
            "name": "foldername",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "foldername",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 48351,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "immutable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 48368,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      DECLARE
          _parts text[];
      BEGIN
          -- Split on "/" to get path segments
          SELECT string_to_array(name, '/') INTO _parts;
          -- Return everything except the last segment
          RETURN _parts[1 : array_length(_parts,1) - 1];
      END
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 48382,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 48326,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "name",
                  },
                },
              ],
              "returnType": {
                "arrayBounds": [
                  {
                    "Integer": {
                      "ival": -1,
                    },
                  },
                ],
                "location": 48340,
                "names": [
                  {
                    "String": {
                      "sval": "text",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "storage.get_level" => {
            "id": "storage.get_level",
            "name": "get_level",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "get_level",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "sql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 48863,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "immutable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 48876,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "Boolean": {
                        "boolval": true,
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "strict",
                    "location": 48886,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      SELECT array_length(string_to_array("name", '/'), 1);
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 48897,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 48837,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "name",
                  },
                },
              ],
              "returnType": {
                "location": 48851,
                "names": [
                  {
                    "String": {
                      "sval": "pg_catalog",
                    },
                  },
                  {
                    "String": {
                      "sval": "int4",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "storage.get_prefix" => {
            "id": "storage.get_prefix",
            "name": "get_prefix",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "get_prefix",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "sql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 49201,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "immutable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 49214,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "Boolean": {
                        "boolval": true,
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "strict",
                    "location": 49224,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      SELECT
          CASE WHEN strpos("name", '/') > 0 THEN
                   regexp_replace("name", '[\\/]{1}[^\\/]+\\/?$', '')
               ELSE
                   ''
              END;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 49235,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 49178,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "name",
                  },
                },
              ],
              "returnType": {
                "location": 49192,
                "names": [
                  {
                    "String": {
                      "sval": "text",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "storage.get_prefixes" => {
            "id": "storage.get_prefixes",
            "name": "get_prefixes",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "get_prefixes",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 49648,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "immutable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 49665,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "Boolean": {
                        "boolval": true,
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "strict",
                    "location": 49675,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      DECLARE
          parts text[];
          prefixes text[];
          prefix text;
      BEGIN
          -- Split the name into parts by '/'
          parts := string_to_array("name", '/');
          prefixes := '{}';

          -- Construct the prefixes, stopping one level below the last part
          FOR i IN 1..array_length(parts, 1) - 1 LOOP
                  prefix := array_to_string(parts[1:i], '/');
                  prefixes := array_append(prefixes, prefix);
          END LOOP;

          RETURN prefixes;
      END;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 49686,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 49623,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "name",
                  },
                },
              ],
              "returnType": {
                "arrayBounds": [
                  {
                    "Integer": {
                      "ival": -1,
                    },
                  },
                ],
                "location": 49637,
                "names": [
                  {
                    "String": {
                      "sval": "text",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "storage.get_size_by_bucket" => {
            "id": "storage.get_size_by_bucket",
            "name": "get_size_by_bucket",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "get_size_by_bucket",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 50419,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "stable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 50436,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      BEGIN
          return query
              select sum((metadata->>'size')::bigint) as size, obj.bucket_id
              from "storage".objects as obj
              group by obj.bucket_id;
      END
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 50447,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 50391,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "int8",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "size",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 50409,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "bucket_id",
                  },
                },
              ],
              "returnType": {
                "location": 50380,
                "names": [
                  {
                    "String": {
                      "sval": "pg_catalog",
                    },
                  },
                  {
                    "String": {
                      "sval": "record",
                    },
                  },
                ],
                "setof": true,
                "typemod": -1,
              },
            },
          },
          "storage.list_multipart_uploads_with_delimiter" => {
            "id": "storage.list_multipart_uploads_with_delimiter",
            "name": "list_multipart_uploads_with_delimiter",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "list_multipart_uploads_with_delimiter",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 51164,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      BEGIN
          RETURN QUERY EXECUTE
              'SELECT DISTINCT ON(key COLLATE "C") * from (
                  SELECT
                      CASE
                          WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                              substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                          ELSE
                              key
                      END AS key, id, created_at
                  FROM
                      storage.s3_multipart_uploads
                  WHERE
                      bucket_id = $5 AND
                      key ILIKE $1 || ''%'' AND
                      CASE
                          WHEN $4 != '''' AND $6 = '''' THEN
                              CASE
                                  WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                      substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                                  ELSE
                                      key COLLATE "C" > $4
                                  END
                          ELSE
                              true
                      END AND
                      CASE
                          WHEN $6 != '''' THEN
                              id COLLATE "C" > $6
                          ELSE
                              true
                          END
                  ORDER BY
                      key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
              USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
      END;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 51185,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 50934,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "bucket_id",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 50953,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "prefix_param",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 50975,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "delimiter_param",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 50990,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "int4",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "A_Const": {
                        "ival": {
                          "ival": 100,
                        },
                        "location": 51006,
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "max_keys",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 51026,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "TypeCast": {
                        "arg": {
                          "A_Const": {
                            "location": 51039,
                            "sval": {
                              "sval": "",
                            },
                          },
                        },
                        "location": 51041,
                        "typeName": {
                          "location": 51043,
                          "names": [
                            {
                              "String": {
                                "sval": "text",
                              },
                            },
                          ],
                          "typemod": -1,
                        },
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "next_key_token",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 51067,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "TypeCast": {
                        "arg": {
                          "A_Const": {
                            "location": 51080,
                            "sval": {
                              "sval": "",
                            },
                          },
                        },
                        "location": 51082,
                        "typeName": {
                          "location": 51084,
                          "names": [
                            {
                              "String": {
                                "sval": "text",
                              },
                            },
                          ],
                          "typemod": -1,
                        },
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "next_upload_token",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 51108,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "key",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 51117,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "id",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 51134,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "timestamptz",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "created_at",
                  },
                },
              ],
              "returnType": {
                "location": 51098,
                "names": [
                  {
                    "String": {
                      "sval": "pg_catalog",
                    },
                  },
                  {
                    "String": {
                      "sval": "record",
                    },
                  },
                ],
                "setof": true,
                "typemod": -1,
              },
            },
          },
          "storage.list_objects_with_delimiter" => {
            "id": "storage.list_objects_with_delimiter",
            "name": "list_objects_with_delimiter",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "list_objects_with_delimiter",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 53374,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      BEGIN
          RETURN QUERY EXECUTE
              'SELECT DISTINCT ON(name COLLATE "C") * from (
                  SELECT
                      CASE
                          WHEN position($2 IN substring(name from length($1) + 1)) > 0 THEN
                              substring(name from 1 for length($1) + position($2 IN substring(name from length($1) + 1)))
                          ELSE
                              name
                      END AS name, id, metadata, updated_at
                  FROM
                      storage.objects
                  WHERE
                      bucket_id = $5 AND
                      name ILIKE $1 || ''%'' AND
                      CASE
                          WHEN $6 != '''' THEN
                          name COLLATE "C" > $6
                      ELSE true END
                      AND CASE
                          WHEN $4 != '''' THEN
                              CASE
                                  WHEN position($2 IN substring(name from length($1) + 1)) > 0 THEN
                                      substring(name from 1 for length($1) + position($2 IN substring(name from length($1) + 1))) COLLATE "C" > $4
                                  ELSE
                                      name COLLATE "C" > $4
                                  END
                          ELSE
                              true
                      END
                  ORDER BY
                      name COLLATE "C" ASC) as e order by name COLLATE "C" LIMIT $3'
              USING prefix_param, delimiter_param, max_keys, next_token, bucket_id, start_after;
      END;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 53395,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 53137,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "bucket_id",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 53156,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "prefix_param",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 53178,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "delimiter_param",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 53193,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "int4",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "A_Const": {
                        "ival": {
                          "ival": 100,
                        },
                        "location": 53209,
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "max_keys",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 53226,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "TypeCast": {
                        "arg": {
                          "A_Const": {
                            "location": 53239,
                            "sval": {
                              "sval": "",
                            },
                          },
                        },
                        "location": 53241,
                        "typeName": {
                          "location": 53243,
                          "names": [
                            {
                              "String": {
                                "sval": "text",
                              },
                            },
                          ],
                          "typemod": -1,
                        },
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "start_after",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 53260,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "TypeCast": {
                        "arg": {
                          "A_Const": {
                            "location": 53273,
                            "sval": {
                              "sval": "",
                            },
                          },
                        },
                        "location": 53275,
                        "typeName": {
                          "location": 53277,
                          "names": [
                            {
                              "String": {
                                "sval": "text",
                              },
                            },
                          ],
                          "typemod": -1,
                        },
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "next_token",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 53302,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "name",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 53311,
                      "names": [
                        {
                          "String": {
                            "sval": "uuid",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "id",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 53326,
                      "names": [
                        {
                          "String": {
                            "sval": "jsonb",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "metadata",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 53344,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "timestamptz",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "updated_at",
                  },
                },
              ],
              "returnType": {
                "location": 53291,
                "names": [
                  {
                    "String": {
                      "sval": "pg_catalog",
                    },
                  },
                  {
                    "String": {
                      "sval": "record",
                    },
                  },
                ],
                "setof": true,
                "typemod": -1,
              },
            },
          },
          "storage.objects_insert_prefix_trigger" => {
            "id": "storage.objects_insert_prefix_trigger",
            "name": "objects_insert_prefix_trigger",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "objects_insert_prefix_trigger",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 55226,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      BEGIN
          PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
          NEW.level := "storage"."get_level"(NEW."name");

          RETURN NEW;
      END;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 55247,
                  },
                },
              ],
              "returnType": {
                "location": 55214,
                "names": [
                  {
                    "String": {
                      "sval": "trigger",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "storage.objects_update_prefix_trigger" => {
            "id": "storage.objects_update_prefix_trigger",
            "name": "objects_update_prefix_trigger",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "objects_update_prefix_trigger",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 55683,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      DECLARE
          old_prefixes TEXT[];
      BEGIN
          -- Ensure this is an update operation and the name has changed
          IF TG_OP = 'UPDATE' AND (NEW."name" <> OLD."name" OR NEW."bucket_id" <> OLD."bucket_id") THEN
              -- Retrieve old prefixes
              old_prefixes := "storage"."get_prefixes"(OLD."name");

              -- Remove old prefixes that are only used by this object
              WITH all_prefixes as (
                  SELECT unnest(old_prefixes) as prefix
              ),
              can_delete_prefixes as (
                   SELECT prefix
                   FROM all_prefixes
                   WHERE NOT EXISTS (
                       SELECT 1 FROM "storage"."objects"
                       WHERE "bucket_id" = OLD."bucket_id"
                         AND "name" <> OLD."name"
                         AND "name" LIKE (prefix || '%')
                   )
               )
              DELETE FROM "storage"."prefixes" WHERE name IN (SELECT prefix FROM can_delete_prefixes);

              -- Add new prefixes
              PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
          END IF;
          -- Set the new level
          NEW."level" := "storage"."get_level"(NEW."name");

          RETURN NEW;
      END;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 55704,
                  },
                },
              ],
              "returnType": {
                "location": 55671,
                "names": [
                  {
                    "String": {
                      "sval": "trigger",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "storage.operation" => {
            "id": "storage.operation",
            "name": "operation",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "operation",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 57065,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "stable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 57082,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      BEGIN
          RETURN current_setting('storage.operation', true);
      END;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 57093,
                  },
                },
              ],
              "returnType": {
                "location": 57056,
                "names": [
                  {
                    "String": {
                      "sval": "text",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "storage.prefixes_insert_trigger" => {
            "id": "storage.prefixes_insert_trigger",
            "name": "prefixes_insert_trigger",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "prefixes_insert_trigger",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 57416,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      BEGIN
          PERFORM "storage"."add_prefixes"(NEW."bucket_id", NEW."name");
          RETURN NEW;
      END;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 57437,
                  },
                },
              ],
              "returnType": {
                "location": 57404,
                "names": [
                  {
                    "String": {
                      "sval": "trigger",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "storage.search" => {
            "id": "storage.search",
            "name": "search",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "search",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 58187,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      declare
          can_bypass_rls BOOLEAN;
      begin
          SELECT rolbypassrls
          INTO can_bypass_rls
          FROM pg_roles
          WHERE rolname = coalesce(nullif(current_setting('role', true), 'none'), current_user);

          IF can_bypass_rls THEN
              RETURN QUERY SELECT * FROM storage.search_v1_optimised(prefix, bucketname, limits, levels, offsets, search, sortcolumn, sortorder);
          ELSE
              RETURN QUERY SELECT * FROM storage.search_legacy_v1(prefix, bucketname, limits, levels, offsets, search, sortcolumn, sortorder);
          END IF;
      end;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 58208,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 57808,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "prefix",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 57825,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "bucketname",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 57838,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "int4",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "A_Const": {
                        "ival": {
                          "ival": 100,
                        },
                        "location": 57854,
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "limits",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 57866,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "int4",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "A_Const": {
                        "ival": {
                          "ival": 1,
                        },
                        "location": 57882,
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "levels",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 57893,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "int4",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "A_Const": {
                        "ival": {},
                        "location": 57909,
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "offsets",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 57919,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "TypeCast": {
                        "arg": {
                          "A_Const": {
                            "location": 57932,
                            "sval": {
                              "sval": "",
                            },
                          },
                        },
                        "location": 57934,
                        "typeName": {
                          "location": 57936,
                          "names": [
                            {
                              "String": {
                                "sval": "text",
                              },
                            },
                          ],
                          "typemod": -1,
                        },
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "search",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 57953,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "TypeCast": {
                        "arg": {
                          "A_Const": {
                            "location": 57966,
                            "sval": {
                              "sval": "name",
                            },
                          },
                        },
                        "location": 57972,
                        "typeName": {
                          "location": 57974,
                          "names": [
                            {
                              "String": {
                                "sval": "text",
                              },
                            },
                          ],
                          "typemod": -1,
                        },
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "sortcolumn",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 57990,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "TypeCast": {
                        "arg": {
                          "A_Const": {
                            "location": 58003,
                            "sval": {
                              "sval": "asc",
                            },
                          },
                        },
                        "location": 58008,
                        "typeName": {
                          "location": 58010,
                          "names": [
                            {
                              "String": {
                                "sval": "text",
                              },
                            },
                          ],
                          "typemod": -1,
                        },
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "sortorder",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 58035,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "name",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 58044,
                      "names": [
                        {
                          "String": {
                            "sval": "uuid",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "id",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 58061,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "timestamptz",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "updated_at",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 58098,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "timestamptz",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "created_at",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 58141,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "timestamptz",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "last_accessed_at",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 58176,
                      "names": [
                        {
                          "String": {
                            "sval": "jsonb",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "metadata",
                  },
                },
              ],
              "returnType": {
                "location": 58024,
                "names": [
                  {
                    "String": {
                      "sval": "pg_catalog",
                    },
                  },
                  {
                    "String": {
                      "sval": "record",
                    },
                  },
                ],
                "setof": true,
                "typemod": -1,
              },
            },
          },
          "storage.search_legacy_v1" => {
            "id": "storage.search_legacy_v1",
            "name": "search_legacy_v1",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "search_legacy_v1",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 59520,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "stable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 59537,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      declare
          v_order_by text;
          v_sort_order text;
      begin
          case
              when sortcolumn = 'name' then
                  v_order_by = 'name';
              when sortcolumn = 'updated_at' then
                  v_order_by = 'updated_at';
              when sortcolumn = 'created_at' then
                  v_order_by = 'created_at';
              when sortcolumn = 'last_accessed_at' then
                  v_order_by = 'last_accessed_at';
              else
                  v_order_by = 'name';
              end case;

          case
              when sortorder = 'asc' then
                  v_sort_order = 'asc';
              when sortorder = 'desc' then
                  v_sort_order = 'desc';
              else
                  v_sort_order = 'asc';
              end case;

          v_order_by = v_order_by || ' ' || v_sort_order;

          return query execute
              'with folders as (
                 select path_tokens[$1] as folder
                 from storage.objects
                   where objects.name ilike $2 || $3 || ''%''
                     and bucket_id = $4
                     and array_length(objects.path_tokens, 1) <> $1
                 group by folder
                 order by folder ' || v_sort_order || '
           )
           (select folder as "name",
                  null as id,
                  null as updated_at,
                  null as created_at,
                  null as last_accessed_at,
                  null as metadata from folders)
           union all
           (select path_tokens[$1] as "name",
                  id,
                  updated_at,
                  created_at,
                  last_accessed_at,
                  metadata
           from storage.objects
           where objects.name ilike $2 || $3 || ''%''
             and bucket_id = $4
             and array_length(objects.path_tokens, 1) = $1
           order by ' || v_order_by || ')
           limit $5
           offset $6' using levels, prefix, search, bucketname, limits, offsets;
      end;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 59548,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 59141,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "prefix",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 59158,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "bucketname",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 59171,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "int4",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "A_Const": {
                        "ival": {
                          "ival": 100,
                        },
                        "location": 59187,
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "limits",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 59199,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "int4",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "A_Const": {
                        "ival": {
                          "ival": 1,
                        },
                        "location": 59215,
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "levels",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 59226,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "int4",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "A_Const": {
                        "ival": {},
                        "location": 59242,
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "offsets",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 59252,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "TypeCast": {
                        "arg": {
                          "A_Const": {
                            "location": 59265,
                            "sval": {
                              "sval": "",
                            },
                          },
                        },
                        "location": 59267,
                        "typeName": {
                          "location": 59269,
                          "names": [
                            {
                              "String": {
                                "sval": "text",
                              },
                            },
                          ],
                          "typemod": -1,
                        },
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "search",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 59286,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "TypeCast": {
                        "arg": {
                          "A_Const": {
                            "location": 59299,
                            "sval": {
                              "sval": "name",
                            },
                          },
                        },
                        "location": 59305,
                        "typeName": {
                          "location": 59307,
                          "names": [
                            {
                              "String": {
                                "sval": "text",
                              },
                            },
                          ],
                          "typemod": -1,
                        },
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "sortcolumn",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 59323,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "TypeCast": {
                        "arg": {
                          "A_Const": {
                            "location": 59336,
                            "sval": {
                              "sval": "asc",
                            },
                          },
                        },
                        "location": 59341,
                        "typeName": {
                          "location": 59343,
                          "names": [
                            {
                              "String": {
                                "sval": "text",
                              },
                            },
                          ],
                          "typemod": -1,
                        },
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "sortorder",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 59368,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "name",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 59377,
                      "names": [
                        {
                          "String": {
                            "sval": "uuid",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "id",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 59394,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "timestamptz",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "updated_at",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 59431,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "timestamptz",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "created_at",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 59474,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "timestamptz",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "last_accessed_at",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 59509,
                      "names": [
                        {
                          "String": {
                            "sval": "jsonb",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "metadata",
                  },
                },
              ],
              "returnType": {
                "location": 59357,
                "names": [
                  {
                    "String": {
                      "sval": "pg_catalog",
                    },
                  },
                  {
                    "String": {
                      "sval": "record",
                    },
                  },
                ],
                "setof": true,
                "typemod": -1,
              },
            },
          },
          "storage.search_v1_optimised" => {
            "id": "storage.search_v1_optimised",
            "name": "search_v1_optimised",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "search_v1_optimised",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 62099,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "stable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 62116,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      declare
          v_order_by text;
          v_sort_order text;
      begin
          case
              when sortcolumn = 'name' then
                  v_order_by = 'name';
              when sortcolumn = 'updated_at' then
                  v_order_by = 'updated_at';
              when sortcolumn = 'created_at' then
                  v_order_by = 'created_at';
              when sortcolumn = 'last_accessed_at' then
                  v_order_by = 'last_accessed_at';
              else
                  v_order_by = 'name';
              end case;

          case
              when sortorder = 'asc' then
                  v_sort_order = 'asc';
              when sortorder = 'desc' then
                  v_sort_order = 'desc';
              else
                  v_sort_order = 'asc';
              end case;

          v_order_by = v_order_by || ' ' || v_sort_order;

          return query execute
              'with folders as (
                 select (string_to_array(name, ''/''))[level] as name
                 from storage.prefixes
                   where lower(prefixes.name) like lower($2 || $3) || ''%''
                     and bucket_id = $4
                     and level = $1
                 order by name ' || v_sort_order || '
           )
           (select name,
                  null as id,
                  null as updated_at,
                  null as created_at,
                  null as last_accessed_at,
                  null as metadata from folders)
           union all
           (select path_tokens[level] as "name",
                  id,
                  updated_at,
                  created_at,
                  last_accessed_at,
                  metadata
           from storage.objects
           where lower(objects.name) like lower($2 || $3) || ''%''
             and bucket_id = $4
             and level = $1
           order by ' || v_order_by || ')
           limit $5
           offset $6' using levels, prefix, search, bucketname, limits, offsets;
      end;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 62127,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 61720,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "prefix",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 61737,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "bucketname",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 61750,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "int4",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "A_Const": {
                        "ival": {
                          "ival": 100,
                        },
                        "location": 61766,
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "limits",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 61778,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "int4",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "A_Const": {
                        "ival": {
                          "ival": 1,
                        },
                        "location": 61794,
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "levels",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 61805,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "int4",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "A_Const": {
                        "ival": {},
                        "location": 61821,
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "offsets",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 61831,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "TypeCast": {
                        "arg": {
                          "A_Const": {
                            "location": 61844,
                            "sval": {
                              "sval": "",
                            },
                          },
                        },
                        "location": 61846,
                        "typeName": {
                          "location": 61848,
                          "names": [
                            {
                              "String": {
                                "sval": "text",
                              },
                            },
                          ],
                          "typemod": -1,
                        },
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "search",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 61865,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "TypeCast": {
                        "arg": {
                          "A_Const": {
                            "location": 61878,
                            "sval": {
                              "sval": "name",
                            },
                          },
                        },
                        "location": 61884,
                        "typeName": {
                          "location": 61886,
                          "names": [
                            {
                              "String": {
                                "sval": "text",
                              },
                            },
                          ],
                          "typemod": -1,
                        },
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "sortcolumn",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 61902,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "TypeCast": {
                        "arg": {
                          "A_Const": {
                            "location": 61915,
                            "sval": {
                              "sval": "asc",
                            },
                          },
                        },
                        "location": 61920,
                        "typeName": {
                          "location": 61922,
                          "names": [
                            {
                              "String": {
                                "sval": "text",
                              },
                            },
                          ],
                          "typemod": -1,
                        },
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "sortorder",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 61947,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "name",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 61956,
                      "names": [
                        {
                          "String": {
                            "sval": "uuid",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "id",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 61973,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "timestamptz",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "updated_at",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 62010,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "timestamptz",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "created_at",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 62053,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "timestamptz",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "last_accessed_at",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 62088,
                      "names": [
                        {
                          "String": {
                            "sval": "jsonb",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "metadata",
                  },
                },
              ],
              "returnType": {
                "location": 61936,
                "names": [
                  {
                    "String": {
                      "sval": "pg_catalog",
                    },
                  },
                  {
                    "String": {
                      "sval": "record",
                    },
                  },
                ],
                "setof": true,
                "typemod": -1,
              },
            },
          },
          "storage.search_v2" => {
            "id": "storage.search_v2",
            "name": "search_v2",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "search_v2",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 64459,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "stable",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "volatility",
                    "location": 64476,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      BEGIN
          RETURN query EXECUTE
              $sql$
              SELECT * FROM (
                  (
                      SELECT
                          split_part(name, '/', $4) AS key,
                          name || '/' AS name,
                          NULL::uuid AS id,
                          NULL::timestamptz AS updated_at,
                          NULL::timestamptz AS created_at,
                          NULL::jsonb AS metadata
                      FROM storage.prefixes
                      WHERE name COLLATE "C" LIKE $1 || '%'
                      AND bucket_id = $2
                      AND level = $4
                      AND name COLLATE "C" > $5
                      ORDER BY prefixes.name COLLATE "C" LIMIT $3
                  )
                  UNION ALL
                  (SELECT split_part(name, '/', $4) AS key,
                      name,
                      id,
                      updated_at,
                      created_at,
                      metadata
                  FROM storage.objects
                  WHERE name COLLATE "C" LIKE $1 || '%'
                      AND bucket_id = $2
                      AND level = $4
                      AND name COLLATE "C" > $5
                  ORDER BY name COLLATE "C" LIMIT $3)
              ) obj
              ORDER BY name COLLATE "C" LIMIT $3;
              $sql$
              USING prefix, bucket_name, limits, levels, start_after;
      END;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 64487,
                  },
                },
              ],
              "parameters": [
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 64208,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "prefix",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 64226,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "bucket_name",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 64239,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "int4",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "A_Const": {
                        "ival": {
                          "ival": 100,
                        },
                        "location": 64255,
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "limits",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 64267,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "int4",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "A_Const": {
                        "ival": {
                          "ival": 1,
                        },
                        "location": 64283,
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "levels",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 64298,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "defexpr": {
                      "TypeCast": {
                        "arg": {
                          "A_Const": {
                            "location": 64311,
                            "sval": {
                              "sval": "",
                            },
                          },
                        },
                        "location": 64313,
                        "typeName": {
                          "location": 64315,
                          "names": [
                            {
                              "String": {
                                "sval": "text",
                              },
                            },
                          ],
                          "typemod": -1,
                        },
                      },
                    },
                    "mode": "FUNC_PARAM_DEFAULT",
                    "name": "start_after",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 64339,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "key",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 64350,
                      "names": [
                        {
                          "String": {
                            "sval": "text",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "name",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 64359,
                      "names": [
                        {
                          "String": {
                            "sval": "uuid",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "id",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 64376,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "timestamptz",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "updated_at",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 64413,
                      "names": [
                        {
                          "String": {
                            "sval": "pg_catalog",
                          },
                        },
                        {
                          "String": {
                            "sval": "timestamptz",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "created_at",
                  },
                },
                {
                  "FunctionParameter": {
                    "argType": {
                      "location": 64448,
                      "names": [
                        {
                          "String": {
                            "sval": "jsonb",
                          },
                        },
                      ],
                      "typemod": -1,
                    },
                    "mode": "FUNC_PARAM_TABLE",
                    "name": "metadata",
                  },
                },
              ],
              "returnType": {
                "location": 64329,
                "names": [
                  {
                    "String": {
                      "sval": "pg_catalog",
                    },
                  },
                  {
                    "String": {
                      "sval": "record",
                    },
                  },
                ],
                "setof": true,
                "typemod": -1,
              },
            },
          },
          "storage.update_updated_at_column" => {
            "id": "storage.update_updated_at_column",
            "name": "update_updated_at_column",
            "schema": "storage",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "storage",
                  },
                },
                {
                  "String": {
                    "sval": "update_updated_at_column",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 66069,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
      BEGIN
          NEW.updated_at = now();
          RETURN NEW; 
      END;
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 66090,
                  },
                },
              ],
              "returnType": {
                "location": 66057,
                "names": [
                  {
                    "String": {
                      "sval": "trigger",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
          "supabase_functions.http_request" => {
            "id": "supabase_functions.http_request",
            "name": "http_request",
            "schema": "supabase_functions",
            "statement": {
              "funcname": [
                {
                  "String": {
                    "sval": "supabase_functions",
                  },
                },
                {
                  "String": {
                    "sval": "http_request",
                  },
                },
              ],
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "plpgsql",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "language",
                    "location": 66420,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "Boolean": {
                        "boolval": true,
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "security",
                    "location": 66437,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "VariableSetStmt": {
                        "args": [
                          {
                            "A_Const": {
                              "location": 66477,
                              "sval": {
                                "sval": "supabase_functions",
                              },
                            },
                          },
                        ],
                        "kind": "VAR_SET_VALUE",
                        "name": "search_path",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "set",
                    "location": 66458,
                  },
                },
                {
                  "DefElem": {
                    "arg": {
                      "List": {
                        "items": [
                          {
                            "String": {
                              "sval": "
        DECLARE
          request_id bigint;
          payload jsonb;
          url text := TG_ARGV[0]::text;
          method text := TG_ARGV[1]::text;
          headers jsonb DEFAULT '{}'::jsonb;
          params jsonb DEFAULT '{}'::jsonb;
          timeout_ms integer DEFAULT 1000;
        BEGIN
          IF url IS NULL OR url = 'null' THEN
            RAISE EXCEPTION 'url argument is missing';
          END IF;

          IF method IS NULL OR method = 'null' THEN
            RAISE EXCEPTION 'method argument is missing';
          END IF;

          IF TG_ARGV[2] IS NULL OR TG_ARGV[2] = 'null' THEN
            headers = '{"Content-Type": "application/json"}'::jsonb;
          ELSE
            headers = TG_ARGV[2]::jsonb;
          END IF;

          IF TG_ARGV[3] IS NULL OR TG_ARGV[3] = 'null' THEN
            params = '{}'::jsonb;
          ELSE
            params = TG_ARGV[3]::jsonb;
          END IF;

          IF TG_ARGV[4] IS NULL OR TG_ARGV[4] = 'null' THEN
            timeout_ms = 1000;
          ELSE
            timeout_ms = TG_ARGV[4]::integer;
          END IF;

          CASE
            WHEN method = 'GET' THEN
              SELECT http_get INTO request_id FROM net.http_get(
                url,
                params,
                headers,
                timeout_ms
              );
            WHEN method = 'POST' THEN
              payload = jsonb_build_object(
                'old_record', OLD,
                'record', NEW,
                'type', TG_OP,
                'table', TG_TABLE_NAME,
                'schema', TG_TABLE_SCHEMA
              );

              SELECT http_post INTO request_id FROM net.http_post(
                url,
                payload,
                params,
                headers,
                timeout_ms
              );
            ELSE
              RAISE EXCEPTION 'method argument % is invalid', method;
          END CASE;

          INSERT INTO supabase_functions.hooks
            (hook_table_id, hook_name, request_id)
          VALUES
            (TG_RELID, TG_NAME, request_id);

          RETURN NEW;
        END
      ",
                            },
                          },
                        ],
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "as",
                    "location": 66502,
                  },
                },
              ],
              "returnType": {
                "location": 66408,
                "names": [
                  {
                    "String": {
                      "sval": "trigger",
                    },
                  },
                ],
                "typemod": -1,
              },
            },
          },
        },
        "publications": Map {
          "supabase_realtime" => {
            "id": "supabase_realtime",
            "name": "supabase_realtime",
            "owner": {
              "location": 126936,
              "rolename": "postgres",
              "roletype": "ROLESPEC_CSTRING",
            },
            "statement": {
              "options": [
                {
                  "DefElem": {
                    "arg": {
                      "String": {
                        "sval": "insert, update, delete, truncate",
                      },
                    },
                    "defaction": "DEFELEM_UNSPEC",
                    "defname": "publish",
                    "location": 126842,
                  },
                },
              ],
              "pubname": "supabase_realtime",
            },
          },
        },
        "schemas": Map {
          "_realtime" => {
            "id": "_realtime",
            "name": "_realtime",
            "owner": {
              "location": 601,
              "rolename": "postgres",
              "roletype": "ROLESPEC_CSTRING",
            },
            "statement": {
              "schemaname": "_realtime",
            },
          },
          "auth" => {
            "id": "auth",
            "name": "auth",
            "owner": {
              "location": 730,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "statement": {
              "schemaname": "auth",
            },
          },
          "extensions" => {
            "id": "extensions",
            "name": "extensions",
            "owner": {
              "location": 877,
              "rolename": "postgres",
              "roletype": "ROLESPEC_CSTRING",
            },
            "statement": {
              "schemaname": "extensions",
            },
          },
          "graphql" => {
            "id": "graphql",
            "name": "graphql",
            "owner": {
              "location": 1015,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "statement": {
              "schemaname": "graphql",
            },
          },
          "graphql_public" => {
            "id": "graphql_public",
            "name": "graphql_public",
            "owner": {
              "location": 1180,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "statement": {
              "schemaname": "graphql_public",
            },
          },
          "pgbouncer" => {
            "id": "pgbouncer",
            "name": "pgbouncer",
            "owner": {
              "location": 1565,
              "rolename": "pgbouncer",
              "roletype": "ROLESPEC_CSTRING",
            },
            "statement": {
              "schemaname": "pgbouncer",
            },
          },
          "realtime" => {
            "id": "realtime",
            "name": "realtime",
            "owner": {
              "location": 1707,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "statement": {
              "schemaname": "realtime",
            },
          },
          "storage" => {
            "id": "storage",
            "name": "storage",
            "owner": {
              "location": 1851,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "statement": {
              "schemaname": "storage",
            },
          },
          "supabase_functions" => {
            "id": "supabase_functions",
            "name": "supabase_functions",
            "owner": {
              "location": 2028,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "statement": {
              "schemaname": "supabase_functions",
            },
          },
          "vault" => {
            "id": "vault",
            "name": "vault",
            "owner": {
              "location": 2166,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "statement": {
              "schemaname": "vault",
            },
          },
        },
        "tables": Map {
          "_realtime.extensions" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 68538,
                    },
                  },
                ],
                "is_local": true,
                "location": 68530,
                "typeName": {
                  "location": 68533,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "type",
                "is_local": true,
                "location": 68552,
                "typeName": {
                  "location": 68557,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "settings",
                "is_local": true,
                "location": 68567,
                "typeName": {
                  "location": 68576,
                  "names": [
                    {
                      "String": {
                        "sval": "jsonb",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "tenant_external_id",
                "is_local": true,
                "location": 68587,
                "typeName": {
                  "location": 68606,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "inserted_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 68659,
                    },
                  },
                ],
                "is_local": true,
                "location": 68616,
                "typeName": {
                  "location": 68628,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {},
                        "location": 68638,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "updated_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 68715,
                    },
                  },
                ],
                "is_local": true,
                "location": 68673,
                "typeName": {
                  "location": 68684,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {},
                        "location": 68694,
                      },
                    },
                  ],
                },
              },
            ],
            "constraints": [],
            "id": "_realtime.extensions",
            "name": "extensions",
            "schema": "_realtime",
          },
          "_realtime.schema_migrations" => {
            "columns": [
              {
                "colname": "version",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 68939,
                    },
                  },
                ],
                "is_local": true,
                "location": 68924,
                "typeName": {
                  "location": 68932,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int8",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "inserted_at",
                "is_local": true,
                "location": 68953,
                "typeName": {
                  "location": 68965,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {},
                        "location": 68975,
                      },
                    },
                  ],
                },
              },
            ],
            "constraints": [],
            "id": "_realtime.schema_migrations",
            "name": "schema_migrations",
            "schema": "_realtime",
          },
          "_realtime.tenants" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 69191,
                    },
                  },
                ],
                "is_local": true,
                "location": 69183,
                "typeName": {
                  "location": 69186,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "name",
                "is_local": true,
                "location": 69205,
                "typeName": {
                  "location": 69210,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "external_id",
                "is_local": true,
                "location": 69220,
                "typeName": {
                  "location": 69232,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "jwt_secret",
                "is_local": true,
                "location": 69242,
                "typeName": {
                  "location": 69253,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "max_concurrent_users",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 69292,
                      "raw_expr": {
                        "A_Const": {
                          "ival": {
                            "ival": 200,
                          },
                          "location": 69300,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 69304,
                    },
                  },
                ],
                "is_local": true,
                "location": 69263,
                "typeName": {
                  "location": 69284,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int4",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "inserted_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 69361,
                    },
                  },
                ],
                "is_local": true,
                "location": 69318,
                "typeName": {
                  "location": 69330,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {},
                        "location": 69340,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "updated_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 69417,
                    },
                  },
                ],
                "is_local": true,
                "location": 69375,
                "typeName": {
                  "location": 69386,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {},
                        "location": 69396,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "max_events_per_second",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 69461,
                      "raw_expr": {
                        "A_Const": {
                          "ival": {
                            "ival": 100,
                          },
                          "location": 69469,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 69473,
                    },
                  },
                ],
                "is_local": true,
                "location": 69431,
                "typeName": {
                  "location": 69453,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int4",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "postgres_cdc_default",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 69513,
                      "raw_expr": {
                        "TypeCast": {
                          "arg": {
                            "A_Const": {
                              "location": 69521,
                              "sval": {
                                "sval": "postgres_cdc_rls",
                              },
                            },
                          },
                          "location": 69539,
                          "typeName": {
                            "location": 69541,
                            "names": [
                              {
                                "String": {
                                  "sval": "text",
                                },
                              },
                            ],
                            "typemod": -1,
                          },
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 69487,
                "typeName": {
                  "location": 69508,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "max_bytes_per_second",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 69580,
                      "raw_expr": {
                        "A_Const": {
                          "ival": {
                            "ival": 100000,
                          },
                          "location": 69588,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 69595,
                    },
                  },
                ],
                "is_local": true,
                "location": 69551,
                "typeName": {
                  "location": 69572,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int4",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "max_channels_per_client",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 69641,
                      "raw_expr": {
                        "A_Const": {
                          "ival": {
                            "ival": 100,
                          },
                          "location": 69649,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 69653,
                    },
                  },
                ],
                "is_local": true,
                "location": 69609,
                "typeName": {
                  "location": 69633,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int4",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "max_joins_per_second",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 69696,
                      "raw_expr": {
                        "A_Const": {
                          "ival": {
                            "ival": 500,
                          },
                          "location": 69704,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 69708,
                    },
                  },
                ],
                "is_local": true,
                "location": 69667,
                "typeName": {
                  "location": 69688,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int4",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "suspend",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 69738,
                      "raw_expr": {
                        "A_Const": {
                          "boolval": {},
                          "location": 69746,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 69722,
                "typeName": {
                  "location": 69730,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "bool",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "jwt_jwks",
                "is_local": true,
                "location": 69757,
                "typeName": {
                  "location": 69766,
                  "names": [
                    {
                      "String": {
                        "sval": "jsonb",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "notify_private_alpha",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 69806,
                      "raw_expr": {
                        "A_Const": {
                          "boolval": {},
                          "location": 69814,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 69777,
                "typeName": {
                  "location": 69798,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "bool",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "private_only",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 69846,
                      "raw_expr": {
                        "A_Const": {
                          "boolval": {},
                          "location": 69854,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 69860,
                    },
                  },
                ],
                "is_local": true,
                "location": 69825,
                "typeName": {
                  "location": 69838,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "bool",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "migrations_ran",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 69897,
                      "raw_expr": {
                        "A_Const": {
                          "ival": {},
                          "location": 69905,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 69874,
                "typeName": {
                  "location": 69889,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int4",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "_realtime.tenants",
            "name": "tenants",
            "schema": "_realtime",
          },
          "auth.audit_log_entries" => {
            "columns": [
              {
                "colname": "instance_id",
                "is_local": true,
                "location": 70099,
                "typeName": {
                  "location": 70111,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 70129,
                    },
                  },
                ],
                "is_local": true,
                "location": 70121,
                "typeName": {
                  "location": 70124,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "payload",
                "is_local": true,
                "location": 70143,
                "typeName": {
                  "location": 70151,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "json",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "is_local": true,
                "location": 70161,
                "typeName": {
                  "location": 70172,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "ip_address",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 70235,
                      "raw_expr": {
                        "TypeCast": {
                          "arg": {
                            "A_Const": {
                              "location": 70243,
                              "sval": {
                                "sval": "",
                              },
                            },
                          },
                          "location": 70245,
                          "typeName": {
                            "location": 70247,
                            "names": [
                              {
                                "String": {
                                  "sval": "pg_catalog",
                                },
                              },
                              {
                                "String": {
                                  "sval": "varchar",
                                },
                              },
                            ],
                            "typemod": -1,
                          },
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 70265,
                    },
                  },
                ],
                "is_local": true,
                "location": 70202,
                "typeName": {
                  "location": 70213,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "varchar",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {
                          "ival": 64,
                        },
                        "location": 70231,
                      },
                    },
                  ],
                },
              },
            ],
            "constraints": [],
            "id": "auth.audit_log_entries",
            "name": "audit_log_entries",
            "schema": "auth",
          },
          "auth.flow_state" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 70651,
                    },
                  },
                ],
                "is_local": true,
                "location": 70643,
                "typeName": {
                  "location": 70646,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "user_id",
                "is_local": true,
                "location": 70665,
                "typeName": {
                  "location": 70673,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "auth_code",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 70698,
                    },
                  },
                ],
                "is_local": true,
                "location": 70683,
                "typeName": {
                  "location": 70693,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "code_challenge_method",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 70761,
                    },
                  },
                ],
                "is_local": true,
                "location": 70712,
                "typeName": {
                  "location": 70734,
                  "names": [
                    {
                      "String": {
                        "sval": "auth",
                      },
                    },
                    {
                      "String": {
                        "sval": "code_challenge_method",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "code_challenge",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 70795,
                    },
                  },
                ],
                "is_local": true,
                "location": 70775,
                "typeName": {
                  "location": 70790,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "provider_type",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 70828,
                    },
                  },
                ],
                "is_local": true,
                "location": 70809,
                "typeName": {
                  "location": 70823,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "provider_access_token",
                "is_local": true,
                "location": 70842,
                "typeName": {
                  "location": 70864,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "provider_refresh_token",
                "is_local": true,
                "location": 70874,
                "typeName": {
                  "location": 70897,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "is_local": true,
                "location": 70907,
                "typeName": {
                  "location": 70918,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "is_local": true,
                "location": 70948,
                "typeName": {
                  "location": 70959,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "authentication_method",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 71016,
                    },
                  },
                ],
                "is_local": true,
                "location": 70989,
                "typeName": {
                  "location": 71011,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "auth_code_issued_at",
                "is_local": true,
                "location": 71030,
                "typeName": {
                  "location": 71050,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "auth.flow_state",
            "name": "flow_state",
            "schema": "auth",
          },
          "auth.identities" => {
            "columns": [
              {
                "colname": "provider_id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 71436,
                    },
                  },
                ],
                "is_local": true,
                "location": 71419,
                "typeName": {
                  "location": 71431,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "user_id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 71463,
                    },
                  },
                ],
                "is_local": true,
                "location": 71450,
                "typeName": {
                  "location": 71458,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "identity_data",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 71497,
                    },
                  },
                ],
                "is_local": true,
                "location": 71477,
                "typeName": {
                  "location": 71491,
                  "names": [
                    {
                      "String": {
                        "sval": "jsonb",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "provider",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 71525,
                    },
                  },
                ],
                "is_local": true,
                "location": 71511,
                "typeName": {
                  "location": 71520,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "last_sign_in_at",
                "is_local": true,
                "location": 71539,
                "typeName": {
                  "location": 71555,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "is_local": true,
                "location": 71585,
                "typeName": {
                  "location": 71596,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "is_local": true,
                "location": 71626,
                "typeName": {
                  "location": 71637,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "email",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_GENERATED",
                      "generated_when": "a",
                      "location": 71678,
                      "raw_expr": {
                        "FuncCall": {
                          "args": [
                            {
                              "A_Expr": {
                                "kind": "AEXPR_OP",
                                "lexpr": {
                                  "ColumnRef": {
                                    "fields": [
                                      {
                                        "String": {
                                          "sval": "identity_data",
                                        },
                                      },
                                    ],
                                    "location": 71706,
                                  },
                                },
                                "location": 71720,
                                "name": [
                                  {
                                    "String": {
                                      "sval": "->>",
                                    },
                                  },
                                ],
                                "rexpr": {
                                  "TypeCast": {
                                    "arg": {
                                      "A_Const": {
                                        "location": 71724,
                                        "sval": {
                                          "sval": "email",
                                        },
                                      },
                                    },
                                    "location": 71731,
                                    "typeName": {
                                      "location": 71733,
                                      "names": [
                                        {
                                          "String": {
                                            "sval": "text",
                                          },
                                        },
                                      ],
                                      "typemod": -1,
                                    },
                                  },
                                },
                              },
                            },
                          ],
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "lower",
                              },
                            },
                          ],
                          "location": 71699,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 71667,
                "typeName": {
                  "location": 71673,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 71761,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "gen_random_uuid",
                              },
                            },
                          ],
                          "location": 71769,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 71787,
                    },
                  },
                ],
                "is_local": true,
                "location": 71753,
                "typeName": {
                  "location": 71756,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "auth.identities",
            "name": "identities",
            "schema": "auth",
          },
          "auth.instances" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 72404,
                    },
                  },
                ],
                "is_local": true,
                "location": 72396,
                "typeName": {
                  "location": 72399,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "uuid",
                "is_local": true,
                "location": 72418,
                "typeName": {
                  "location": 72423,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "raw_base_config",
                "is_local": true,
                "location": 72433,
                "typeName": {
                  "location": 72449,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "is_local": true,
                "location": 72459,
                "typeName": {
                  "location": 72470,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "is_local": true,
                "location": 72500,
                "typeName": {
                  "location": 72511,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "auth.instances",
            "name": "instances",
            "schema": "auth",
          },
          "auth.mfa_amr_claims" => {
            "columns": [
              {
                "colname": "session_id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 72912,
                    },
                  },
                ],
                "is_local": true,
                "location": 72896,
                "typeName": {
                  "location": 72907,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 72962,
                    },
                  },
                ],
                "is_local": true,
                "location": 72926,
                "typeName": {
                  "location": 72937,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 73012,
                    },
                  },
                ],
                "is_local": true,
                "location": 72976,
                "typeName": {
                  "location": 72987,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "authentication_method",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 73053,
                    },
                  },
                ],
                "is_local": true,
                "location": 73026,
                "typeName": {
                  "location": 73048,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 73075,
                    },
                  },
                ],
                "is_local": true,
                "location": 73067,
                "typeName": {
                  "location": 73070,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "auth.mfa_amr_claims",
            "name": "mfa_amr_claims",
            "schema": "auth",
          },
          "auth.mfa_challenges" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 73507,
                    },
                  },
                ],
                "is_local": true,
                "location": 73499,
                "typeName": {
                  "location": 73502,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "factor_id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 73536,
                    },
                  },
                ],
                "is_local": true,
                "location": 73521,
                "typeName": {
                  "location": 73531,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 73586,
                    },
                  },
                ],
                "is_local": true,
                "location": 73550,
                "typeName": {
                  "location": 73561,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "verified_at",
                "is_local": true,
                "location": 73600,
                "typeName": {
                  "location": 73612,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "ip_address",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 73658,
                    },
                  },
                ],
                "is_local": true,
                "location": 73642,
                "typeName": {
                  "location": 73653,
                  "names": [
                    {
                      "String": {
                        "sval": "inet",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "otp_code",
                "is_local": true,
                "location": 73672,
                "typeName": {
                  "location": 73681,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "web_authn_session_data",
                "is_local": true,
                "location": 73691,
                "typeName": {
                  "location": 73714,
                  "names": [
                    {
                      "String": {
                        "sval": "jsonb",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "auth.mfa_challenges",
            "name": "mfa_challenges",
            "schema": "auth",
          },
          "auth.mfa_factors" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 74106,
                    },
                  },
                ],
                "is_local": true,
                "location": 74098,
                "typeName": {
                  "location": 74101,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "user_id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 74133,
                    },
                  },
                ],
                "is_local": true,
                "location": 74120,
                "typeName": {
                  "location": 74128,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "friendly_name",
                "is_local": true,
                "location": 74147,
                "typeName": {
                  "location": 74161,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "factor_type",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 74200,
                    },
                  },
                ],
                "is_local": true,
                "location": 74171,
                "typeName": {
                  "location": 74183,
                  "names": [
                    {
                      "String": {
                        "sval": "auth",
                      },
                    },
                    {
                      "String": {
                        "sval": "factor_type",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "status",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 74240,
                    },
                  },
                ],
                "is_local": true,
                "location": 74214,
                "typeName": {
                  "location": 74221,
                  "names": [
                    {
                      "String": {
                        "sval": "auth",
                      },
                    },
                    {
                      "String": {
                        "sval": "factor_status",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 74290,
                    },
                  },
                ],
                "is_local": true,
                "location": 74254,
                "typeName": {
                  "location": 74265,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 74340,
                    },
                  },
                ],
                "is_local": true,
                "location": 74304,
                "typeName": {
                  "location": 74315,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "secret",
                "is_local": true,
                "location": 74354,
                "typeName": {
                  "location": 74361,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "phone",
                "is_local": true,
                "location": 74371,
                "typeName": {
                  "location": 74377,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "last_challenged_at",
                "is_local": true,
                "location": 74387,
                "typeName": {
                  "location": 74406,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "web_authn_credential",
                "is_local": true,
                "location": 74436,
                "typeName": {
                  "location": 74457,
                  "names": [
                    {
                      "String": {
                        "sval": "jsonb",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "web_authn_aaguid",
                "is_local": true,
                "location": 74468,
                "typeName": {
                  "location": 74485,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "auth.mfa_factors",
            "name": "mfa_factors",
            "schema": "auth",
          },
          "auth.one_time_tokens" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 74859,
                    },
                  },
                ],
                "is_local": true,
                "location": 74851,
                "typeName": {
                  "location": 74854,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "user_id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 74886,
                    },
                  },
                ],
                "is_local": true,
                "location": 74873,
                "typeName": {
                  "location": 74881,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "token_type",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 74936,
                    },
                  },
                ],
                "is_local": true,
                "location": 74900,
                "typeName": {
                  "location": 74911,
                  "names": [
                    {
                      "String": {
                        "sval": "auth",
                      },
                    },
                    {
                      "String": {
                        "sval": "one_time_token_type",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "token_hash",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 74966,
                    },
                  },
                ],
                "is_local": true,
                "location": 74950,
                "typeName": {
                  "location": 74961,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "relates_to",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 74996,
                    },
                  },
                ],
                "is_local": true,
                "location": 74980,
                "typeName": {
                  "location": 74991,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 75049,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 75057,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 75063,
                    },
                  },
                ],
                "is_local": true,
                "location": 75010,
                "typeName": {
                  "location": 75021,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 75116,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 75124,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 75130,
                    },
                  },
                ],
                "is_local": true,
                "location": 75077,
                "typeName": {
                  "location": 75088,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [
              {
                "conname": "one_time_tokens_token_hash_check",
                "contype": "CONSTR_CHECK",
                "initially_valid": true,
                "location": 75144,
                "raw_expr": {
                  "A_Expr": {
                    "kind": "AEXPR_OP",
                    "lexpr": {
                      "FuncCall": {
                        "args": [
                          {
                            "ColumnRef": {
                              "fields": [
                                {
                                  "String": {
                                    "sval": "token_hash",
                                  },
                                },
                              ],
                              "location": 75208,
                            },
                          },
                        ],
                        "funcformat": "COERCE_EXPLICIT_CALL",
                        "funcname": [
                          {
                            "String": {
                              "sval": "char_length",
                            },
                          },
                        ],
                        "location": 75196,
                      },
                    },
                    "location": 75220,
                    "name": [
                      {
                        "String": {
                          "sval": ">",
                        },
                      },
                    ],
                    "rexpr": {
                      "A_Const": {
                        "ival": {},
                        "location": 75222,
                      },
                    },
                  },
                },
              },
            ],
            "id": "auth.one_time_tokens",
            "name": "one_time_tokens",
            "schema": "auth",
          },
          "auth.refresh_tokens" => {
            "columns": [
              {
                "colname": "instance_id",
                "is_local": true,
                "location": 75420,
                "typeName": {
                  "location": 75432,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 75452,
                    },
                  },
                ],
                "is_local": true,
                "location": 75442,
                "typeName": {
                  "location": 75445,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int8",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "token",
                "is_local": true,
                "location": 75466,
                "typeName": {
                  "location": 75472,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "varchar",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {
                          "ival": 255,
                        },
                        "location": 75490,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "user_id",
                "is_local": true,
                "location": 75500,
                "typeName": {
                  "location": 75508,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "varchar",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {
                          "ival": 255,
                        },
                        "location": 75526,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "revoked",
                "is_local": true,
                "location": 75536,
                "typeName": {
                  "location": 75544,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "bool",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "is_local": true,
                "location": 75557,
                "typeName": {
                  "location": 75568,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "is_local": true,
                "location": 75598,
                "typeName": {
                  "location": 75609,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "parent",
                "is_local": true,
                "location": 75639,
                "typeName": {
                  "location": 75646,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "varchar",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {
                          "ival": 255,
                        },
                        "location": 75664,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "session_id",
                "is_local": true,
                "location": 75674,
                "typeName": {
                  "location": 75685,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "auth.refresh_tokens",
            "name": "refresh_tokens",
            "schema": "auth",
          },
          "auth.saml_providers" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 76574,
                    },
                  },
                ],
                "is_local": true,
                "location": 76566,
                "typeName": {
                  "location": 76569,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "sso_provider_id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 76609,
                    },
                  },
                ],
                "is_local": true,
                "location": 76588,
                "typeName": {
                  "location": 76604,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "entity_id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 76638,
                    },
                  },
                ],
                "is_local": true,
                "location": 76623,
                "typeName": {
                  "location": 76633,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "metadata_xml",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 76670,
                    },
                  },
                ],
                "is_local": true,
                "location": 76652,
                "typeName": {
                  "location": 76665,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "metadata_url",
                "is_local": true,
                "location": 76684,
                "typeName": {
                  "location": 76697,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "attribute_mapping",
                "is_local": true,
                "location": 76707,
                "typeName": {
                  "location": 76725,
                  "names": [
                    {
                      "String": {
                        "sval": "jsonb",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "is_local": true,
                "location": 76736,
                "typeName": {
                  "location": 76747,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "is_local": true,
                "location": 76777,
                "typeName": {
                  "location": 76788,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "name_id_format",
                "is_local": true,
                "location": 76818,
                "typeName": {
                  "location": 76833,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [
              {
                "conname": "entity_id not empty",
                "contype": "CONSTR_CHECK",
                "initially_valid": true,
                "location": 76843,
                "raw_expr": {
                  "A_Expr": {
                    "kind": "AEXPR_OP",
                    "lexpr": {
                      "FuncCall": {
                        "args": [
                          {
                            "ColumnRef": {
                              "fields": [
                                {
                                  "String": {
                                    "sval": "entity_id",
                                  },
                                },
                              ],
                              "location": 76896,
                            },
                          },
                        ],
                        "funcformat": "COERCE_EXPLICIT_CALL",
                        "funcname": [
                          {
                            "String": {
                              "sval": "char_length",
                            },
                          },
                        ],
                        "location": 76884,
                      },
                    },
                    "location": 76907,
                    "name": [
                      {
                        "String": {
                          "sval": ">",
                        },
                      },
                    ],
                    "rexpr": {
                      "A_Const": {
                        "ival": {},
                        "location": 76909,
                      },
                    },
                  },
                },
              },
              {
                "conname": "metadata_url not empty",
                "contype": "CONSTR_CHECK",
                "initially_valid": true,
                "location": 76918,
                "raw_expr": {
                  "BoolExpr": {
                    "args": [
                      {
                        "A_Expr": {
                          "kind": "AEXPR_OP",
                          "lexpr": {
                            "ColumnRef": {
                              "fields": [
                                {
                                  "String": {
                                    "sval": "metadata_url",
                                  },
                                },
                              ],
                              "location": 76963,
                            },
                          },
                          "location": 76976,
                          "name": [
                            {
                              "String": {
                                "sval": "=",
                              },
                            },
                          ],
                          "rexpr": {
                            "TypeCast": {
                              "arg": {
                                "A_Const": {
                                  "isnull": true,
                                  "location": 76978,
                                },
                              },
                              "location": 76982,
                              "typeName": {
                                "location": 76984,
                                "names": [
                                  {
                                    "String": {
                                      "sval": "text",
                                    },
                                  },
                                ],
                                "typemod": -1,
                              },
                            },
                          },
                        },
                      },
                      {
                        "A_Expr": {
                          "kind": "AEXPR_OP",
                          "lexpr": {
                            "FuncCall": {
                              "args": [
                                {
                                  "ColumnRef": {
                                    "fields": [
                                      {
                                        "String": {
                                          "sval": "metadata_url",
                                        },
                                      },
                                    ],
                                    "location": 77006,
                                  },
                                },
                              ],
                              "funcformat": "COERCE_EXPLICIT_CALL",
                              "funcname": [
                                {
                                  "String": {
                                    "sval": "char_length",
                                  },
                                },
                              ],
                              "location": 76994,
                            },
                          },
                          "location": 77020,
                          "name": [
                            {
                              "String": {
                                "sval": ">",
                              },
                            },
                          ],
                          "rexpr": {
                            "A_Const": {
                              "ival": {},
                              "location": 77022,
                            },
                          },
                        },
                      },
                    ],
                    "boolop": "OR_EXPR",
                    "location": 76990,
                  },
                },
              },
              {
                "conname": "metadata_xml not empty",
                "contype": "CONSTR_CHECK",
                "initially_valid": true,
                "location": 77032,
                "raw_expr": {
                  "A_Expr": {
                    "kind": "AEXPR_OP",
                    "lexpr": {
                      "FuncCall": {
                        "args": [
                          {
                            "ColumnRef": {
                              "fields": [
                                {
                                  "String": {
                                    "sval": "metadata_xml",
                                  },
                                },
                              ],
                              "location": 77088,
                            },
                          },
                        ],
                        "funcformat": "COERCE_EXPLICIT_CALL",
                        "funcname": [
                          {
                            "String": {
                              "sval": "char_length",
                            },
                          },
                        ],
                        "location": 77076,
                      },
                    },
                    "location": 77102,
                    "name": [
                      {
                        "String": {
                          "sval": ">",
                        },
                      },
                    ],
                    "rexpr": {
                      "A_Const": {
                        "ival": {},
                        "location": 77104,
                      },
                    },
                  },
                },
              },
            ],
            "id": "auth.saml_providers",
            "name": "saml_providers",
            "schema": "auth",
          },
          "auth.saml_relay_states" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 77504,
                    },
                  },
                ],
                "is_local": true,
                "location": 77496,
                "typeName": {
                  "location": 77499,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "sso_provider_id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 77539,
                    },
                  },
                ],
                "is_local": true,
                "location": 77518,
                "typeName": {
                  "location": 77534,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "request_id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 77569,
                    },
                  },
                ],
                "is_local": true,
                "location": 77553,
                "typeName": {
                  "location": 77564,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "for_email",
                "is_local": true,
                "location": 77583,
                "typeName": {
                  "location": 77593,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "redirect_to",
                "is_local": true,
                "location": 77603,
                "typeName": {
                  "location": 77615,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "is_local": true,
                "location": 77625,
                "typeName": {
                  "location": 77636,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "is_local": true,
                "location": 77666,
                "typeName": {
                  "location": 77677,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "flow_state_id",
                "is_local": true,
                "location": 77707,
                "typeName": {
                  "location": 77721,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [
              {
                "conname": "request_id not empty",
                "contype": "CONSTR_CHECK",
                "initially_valid": true,
                "location": 77731,
                "raw_expr": {
                  "A_Expr": {
                    "kind": "AEXPR_OP",
                    "lexpr": {
                      "FuncCall": {
                        "args": [
                          {
                            "ColumnRef": {
                              "fields": [
                                {
                                  "String": {
                                    "sval": "request_id",
                                  },
                                },
                              ],
                              "location": 77785,
                            },
                          },
                        ],
                        "funcformat": "COERCE_EXPLICIT_CALL",
                        "funcname": [
                          {
                            "String": {
                              "sval": "char_length",
                            },
                          },
                        ],
                        "location": 77773,
                      },
                    },
                    "location": 77797,
                    "name": [
                      {
                        "String": {
                          "sval": ">",
                        },
                      },
                    ],
                    "rexpr": {
                      "A_Const": {
                        "ival": {},
                        "location": 77799,
                      },
                    },
                  },
                },
              },
            ],
            "id": "auth.saml_relay_states",
            "name": "saml_relay_states",
            "schema": "auth",
          },
          "auth.schema_migrations" => {
            "columns": [
              {
                "colname": "version",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 78268,
                    },
                  },
                ],
                "is_local": true,
                "location": 78237,
                "typeName": {
                  "location": 78245,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "varchar",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {
                          "ival": 255,
                        },
                        "location": 78263,
                      },
                    },
                  ],
                },
              },
            ],
            "constraints": [],
            "id": "auth.schema_migrations",
            "name": "schema_migrations",
            "schema": "auth",
          },
          "auth.sessions" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 78656,
                    },
                  },
                ],
                "is_local": true,
                "location": 78648,
                "typeName": {
                  "location": 78651,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "user_id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 78683,
                    },
                  },
                ],
                "is_local": true,
                "location": 78670,
                "typeName": {
                  "location": 78678,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "is_local": true,
                "location": 78697,
                "typeName": {
                  "location": 78708,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "is_local": true,
                "location": 78738,
                "typeName": {
                  "location": 78749,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "factor_id",
                "is_local": true,
                "location": 78779,
                "typeName": {
                  "location": 78789,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "aal",
                "is_local": true,
                "location": 78799,
                "typeName": {
                  "location": 78803,
                  "names": [
                    {
                      "String": {
                        "sval": "auth",
                      },
                    },
                    {
                      "String": {
                        "sval": "aal_level",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "not_after",
                "is_local": true,
                "location": 78823,
                "typeName": {
                  "location": 78833,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "refreshed_at",
                "is_local": true,
                "location": 78863,
                "typeName": {
                  "location": 78876,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "user_agent",
                "is_local": true,
                "location": 78909,
                "typeName": {
                  "location": 78920,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "ip",
                "is_local": true,
                "location": 78930,
                "typeName": {
                  "location": 78933,
                  "names": [
                    {
                      "String": {
                        "sval": "inet",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "tag",
                "is_local": true,
                "location": 78943,
                "typeName": {
                  "location": 78947,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "auth.sessions",
            "name": "sessions",
            "schema": "auth",
          },
          "auth.sso_domains" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 79583,
                    },
                  },
                ],
                "is_local": true,
                "location": 79575,
                "typeName": {
                  "location": 79578,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "sso_provider_id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 79618,
                    },
                  },
                ],
                "is_local": true,
                "location": 79597,
                "typeName": {
                  "location": 79613,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "domain",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 79644,
                    },
                  },
                ],
                "is_local": true,
                "location": 79632,
                "typeName": {
                  "location": 79639,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "is_local": true,
                "location": 79658,
                "typeName": {
                  "location": 79669,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "is_local": true,
                "location": 79699,
                "typeName": {
                  "location": 79710,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [
              {
                "conname": "domain not empty",
                "contype": "CONSTR_CHECK",
                "initially_valid": true,
                "location": 79740,
                "raw_expr": {
                  "A_Expr": {
                    "kind": "AEXPR_OP",
                    "lexpr": {
                      "FuncCall": {
                        "args": [
                          {
                            "ColumnRef": {
                              "fields": [
                                {
                                  "String": {
                                    "sval": "domain",
                                  },
                                },
                              ],
                              "location": 79790,
                            },
                          },
                        ],
                        "funcformat": "COERCE_EXPLICIT_CALL",
                        "funcname": [
                          {
                            "String": {
                              "sval": "char_length",
                            },
                          },
                        ],
                        "location": 79778,
                      },
                    },
                    "location": 79798,
                    "name": [
                      {
                        "String": {
                          "sval": ">",
                        },
                      },
                    ],
                    "rexpr": {
                      "A_Const": {
                        "ival": {},
                        "location": 79800,
                      },
                    },
                  },
                },
              },
            ],
            "id": "auth.sso_domains",
            "name": "sso_domains",
            "schema": "auth",
          },
          "auth.sso_providers" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 80209,
                    },
                  },
                ],
                "is_local": true,
                "location": 80201,
                "typeName": {
                  "location": 80204,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "resource_id",
                "is_local": true,
                "location": 80223,
                "typeName": {
                  "location": 80235,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "is_local": true,
                "location": 80245,
                "typeName": {
                  "location": 80256,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "is_local": true,
                "location": 80286,
                "typeName": {
                  "location": 80297,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [
              {
                "conname": "resource_id not empty",
                "contype": "CONSTR_CHECK",
                "initially_valid": true,
                "location": 80327,
                "raw_expr": {
                  "BoolExpr": {
                    "args": [
                      {
                        "A_Expr": {
                          "kind": "AEXPR_OP",
                          "lexpr": {
                            "ColumnRef": {
                              "fields": [
                                {
                                  "String": {
                                    "sval": "resource_id",
                                  },
                                },
                              ],
                              "location": 80371,
                            },
                          },
                          "location": 80383,
                          "name": [
                            {
                              "String": {
                                "sval": "=",
                              },
                            },
                          ],
                          "rexpr": {
                            "TypeCast": {
                              "arg": {
                                "A_Const": {
                                  "isnull": true,
                                  "location": 80385,
                                },
                              },
                              "location": 80389,
                              "typeName": {
                                "location": 80391,
                                "names": [
                                  {
                                    "String": {
                                      "sval": "text",
                                    },
                                  },
                                ],
                                "typemod": -1,
                              },
                            },
                          },
                        },
                      },
                      {
                        "A_Expr": {
                          "kind": "AEXPR_OP",
                          "lexpr": {
                            "FuncCall": {
                              "args": [
                                {
                                  "ColumnRef": {
                                    "fields": [
                                      {
                                        "String": {
                                          "sval": "resource_id",
                                        },
                                      },
                                    ],
                                    "location": 80413,
                                  },
                                },
                              ],
                              "funcformat": "COERCE_EXPLICIT_CALL",
                              "funcname": [
                                {
                                  "String": {
                                    "sval": "char_length",
                                  },
                                },
                              ],
                              "location": 80401,
                            },
                          },
                          "location": 80426,
                          "name": [
                            {
                              "String": {
                                "sval": ">",
                              },
                            },
                          ],
                          "rexpr": {
                            "A_Const": {
                              "ival": {},
                              "location": 80428,
                            },
                          },
                        },
                      },
                    ],
                    "boolop": "OR_EXPR",
                    "location": 80397,
                  },
                },
              },
            ],
            "id": "auth.sso_providers",
            "name": "sso_providers",
            "schema": "auth",
          },
          "auth.users" => {
            "columns": [
              {
                "colname": "instance_id",
                "is_local": true,
                "location": 81119,
                "typeName": {
                  "location": 81131,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 81149,
                    },
                  },
                ],
                "is_local": true,
                "location": 81141,
                "typeName": {
                  "location": 81144,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "aud",
                "is_local": true,
                "location": 81163,
                "typeName": {
                  "location": 81167,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "varchar",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {
                          "ival": 255,
                        },
                        "location": 81185,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "role",
                "is_local": true,
                "location": 81195,
                "typeName": {
                  "location": 81200,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "varchar",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {
                          "ival": 255,
                        },
                        "location": 81218,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "email",
                "is_local": true,
                "location": 81228,
                "typeName": {
                  "location": 81234,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "varchar",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {
                          "ival": 255,
                        },
                        "location": 81252,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "encrypted_password",
                "is_local": true,
                "location": 81262,
                "typeName": {
                  "location": 81281,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "varchar",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {
                          "ival": 255,
                        },
                        "location": 81299,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "email_confirmed_at",
                "is_local": true,
                "location": 81309,
                "typeName": {
                  "location": 81328,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "invited_at",
                "is_local": true,
                "location": 81358,
                "typeName": {
                  "location": 81369,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "confirmation_token",
                "is_local": true,
                "location": 81399,
                "typeName": {
                  "location": 81418,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "varchar",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {
                          "ival": 255,
                        },
                        "location": 81436,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "confirmation_sent_at",
                "is_local": true,
                "location": 81446,
                "typeName": {
                  "location": 81467,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "recovery_token",
                "is_local": true,
                "location": 81497,
                "typeName": {
                  "location": 81512,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "varchar",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {
                          "ival": 255,
                        },
                        "location": 81530,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "recovery_sent_at",
                "is_local": true,
                "location": 81540,
                "typeName": {
                  "location": 81557,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "email_change_token_new",
                "is_local": true,
                "location": 81587,
                "typeName": {
                  "location": 81610,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "varchar",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {
                          "ival": 255,
                        },
                        "location": 81628,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "email_change",
                "is_local": true,
                "location": 81638,
                "typeName": {
                  "location": 81651,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "varchar",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {
                          "ival": 255,
                        },
                        "location": 81669,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "email_change_sent_at",
                "is_local": true,
                "location": 81679,
                "typeName": {
                  "location": 81700,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "last_sign_in_at",
                "is_local": true,
                "location": 81730,
                "typeName": {
                  "location": 81746,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "raw_app_meta_data",
                "is_local": true,
                "location": 81776,
                "typeName": {
                  "location": 81794,
                  "names": [
                    {
                      "String": {
                        "sval": "jsonb",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "raw_user_meta_data",
                "is_local": true,
                "location": 81805,
                "typeName": {
                  "location": 81824,
                  "names": [
                    {
                      "String": {
                        "sval": "jsonb",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "is_super_admin",
                "is_local": true,
                "location": 81835,
                "typeName": {
                  "location": 81850,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "bool",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "is_local": true,
                "location": 81863,
                "typeName": {
                  "location": 81874,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "is_local": true,
                "location": 81904,
                "typeName": {
                  "location": 81915,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "phone",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 81956,
                      "raw_expr": {
                        "TypeCast": {
                          "arg": {
                            "A_Const": {
                              "isnull": true,
                              "location": 81964,
                            },
                          },
                          "location": 81968,
                          "typeName": {
                            "location": 81970,
                            "names": [
                              {
                                "String": {
                                  "sval": "pg_catalog",
                                },
                              },
                              {
                                "String": {
                                  "sval": "varchar",
                                },
                              },
                            ],
                            "typemod": -1,
                          },
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 81945,
                "typeName": {
                  "location": 81951,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "phone_confirmed_at",
                "is_local": true,
                "location": 81993,
                "typeName": {
                  "location": 82012,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "phone_change",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 82060,
                      "raw_expr": {
                        "TypeCast": {
                          "arg": {
                            "A_Const": {
                              "location": 82068,
                              "sval": {
                                "sval": "",
                              },
                            },
                          },
                          "location": 82070,
                          "typeName": {
                            "location": 82072,
                            "names": [
                              {
                                "String": {
                                  "sval": "pg_catalog",
                                },
                              },
                              {
                                "String": {
                                  "sval": "varchar",
                                },
                              },
                            ],
                            "typemod": -1,
                          },
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 82042,
                "typeName": {
                  "location": 82055,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "phone_change_token",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 82137,
                      "raw_expr": {
                        "TypeCast": {
                          "arg": {
                            "A_Const": {
                              "location": 82145,
                              "sval": {
                                "sval": "",
                              },
                            },
                          },
                          "location": 82147,
                          "typeName": {
                            "location": 82149,
                            "names": [
                              {
                                "String": {
                                  "sval": "pg_catalog",
                                },
                              },
                              {
                                "String": {
                                  "sval": "varchar",
                                },
                              },
                            ],
                            "typemod": -1,
                          },
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 82095,
                "typeName": {
                  "location": 82114,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "varchar",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {
                          "ival": 255,
                        },
                        "location": 82132,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "phone_change_sent_at",
                "is_local": true,
                "location": 82172,
                "typeName": {
                  "location": 82193,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "confirmed_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_GENERATED",
                      "generated_when": "a",
                      "location": 82261,
                      "raw_expr": {
                        "MinMaxExpr": {
                          "args": [
                            {
                              "ColumnRef": {
                                "fields": [
                                  {
                                    "String": {
                                      "sval": "email_confirmed_at",
                                    },
                                  },
                                ],
                                "location": 82288,
                              },
                            },
                            {
                              "ColumnRef": {
                                "fields": [
                                  {
                                    "String": {
                                      "sval": "phone_confirmed_at",
                                    },
                                  },
                                ],
                                "location": 82308,
                              },
                            },
                          ],
                          "location": 82282,
                          "op": "IS_LEAST",
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 82223,
                "typeName": {
                  "location": 82236,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "email_change_token_current",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 82391,
                      "raw_expr": {
                        "TypeCast": {
                          "arg": {
                            "A_Const": {
                              "location": 82399,
                              "sval": {
                                "sval": "",
                              },
                            },
                          },
                          "location": 82401,
                          "typeName": {
                            "location": 82403,
                            "names": [
                              {
                                "String": {
                                  "sval": "pg_catalog",
                                },
                              },
                              {
                                "String": {
                                  "sval": "varchar",
                                },
                              },
                            ],
                            "typemod": -1,
                          },
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 82341,
                "typeName": {
                  "location": 82368,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "varchar",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {
                          "ival": 255,
                        },
                        "location": 82386,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "email_change_confirm_status",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 82463,
                      "raw_expr": {
                        "A_Const": {
                          "ival": {},
                          "location": 82471,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 82426,
                "typeName": {
                  "location": 82454,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int2",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "banned_until",
                "is_local": true,
                "location": 82478,
                "typeName": {
                  "location": 82491,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "reauthentication_token",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 82567,
                      "raw_expr": {
                        "TypeCast": {
                          "arg": {
                            "A_Const": {
                              "location": 82575,
                              "sval": {
                                "sval": "",
                              },
                            },
                          },
                          "location": 82577,
                          "typeName": {
                            "location": 82579,
                            "names": [
                              {
                                "String": {
                                  "sval": "pg_catalog",
                                },
                              },
                              {
                                "String": {
                                  "sval": "varchar",
                                },
                              },
                            ],
                            "typemod": -1,
                          },
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 82521,
                "typeName": {
                  "location": 82544,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "varchar",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {
                          "ival": 255,
                        },
                        "location": 82562,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "reauthentication_sent_at",
                "is_local": true,
                "location": 82602,
                "typeName": {
                  "location": 82627,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "is_sso_user",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 82677,
                      "raw_expr": {
                        "A_Const": {
                          "boolval": {},
                          "location": 82685,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 82691,
                    },
                  },
                ],
                "is_local": true,
                "location": 82657,
                "typeName": {
                  "location": 82669,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "bool",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "deleted_at",
                "is_local": true,
                "location": 82705,
                "typeName": {
                  "location": 82716,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "is_anonymous",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 82767,
                      "raw_expr": {
                        "A_Const": {
                          "boolval": {},
                          "location": 82775,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 82781,
                    },
                  },
                ],
                "is_local": true,
                "location": 82746,
                "typeName": {
                  "location": 82759,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "bool",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [
              {
                "conname": "users_email_change_confirm_status_check",
                "contype": "CONSTR_CHECK",
                "initially_valid": true,
                "location": 82795,
                "raw_expr": {
                  "BoolExpr": {
                    "args": [
                      {
                        "A_Expr": {
                          "kind": "AEXPR_OP",
                          "lexpr": {
                            "ColumnRef": {
                              "fields": [
                                {
                                  "String": {
                                    "sval": "email_change_confirm_status",
                                  },
                                },
                              ],
                              "location": 82855,
                            },
                          },
                          "location": 82883,
                          "name": [
                            {
                              "String": {
                                "sval": ">=",
                              },
                            },
                          ],
                          "rexpr": {
                            "A_Const": {
                              "ival": {},
                              "location": 82886,
                            },
                          },
                        },
                      },
                      {
                        "A_Expr": {
                          "kind": "AEXPR_OP",
                          "lexpr": {
                            "ColumnRef": {
                              "fields": [
                                {
                                  "String": {
                                    "sval": "email_change_confirm_status",
                                  },
                                },
                              ],
                              "location": 82894,
                            },
                          },
                          "location": 82922,
                          "name": [
                            {
                              "String": {
                                "sval": "<=",
                              },
                            },
                          ],
                          "rexpr": {
                            "A_Const": {
                              "ival": {
                                "ival": 2,
                              },
                              "location": 82925,
                            },
                          },
                        },
                      },
                    ],
                    "boolop": "AND_EXPR",
                    "location": 82889,
                  },
                },
              },
            ],
            "id": "auth.users",
            "name": "users",
            "schema": "auth",
          },
          "realtime.messages" => {
            "columns": [
              {
                "colname": "topic",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 83551,
                    },
                  },
                ],
                "is_local": true,
                "location": 83540,
                "typeName": {
                  "location": 83546,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "extension",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 83580,
                    },
                  },
                ],
                "is_local": true,
                "location": 83565,
                "typeName": {
                  "location": 83575,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "payload",
                "is_local": true,
                "location": 83594,
                "typeName": {
                  "location": 83602,
                  "names": [
                    {
                      "String": {
                        "sval": "jsonb",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "event",
                "is_local": true,
                "location": 83613,
                "typeName": {
                  "location": 83619,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "private",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 83645,
                      "raw_expr": {
                        "A_Const": {
                          "boolval": {},
                          "location": 83653,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 83629,
                "typeName": {
                  "location": 83637,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "bool",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 83703,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 83711,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 83717,
                    },
                  },
                ],
                "is_local": true,
                "location": 83664,
                "typeName": {
                  "location": 83675,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "inserted_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 83771,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 83779,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 83785,
                    },
                  },
                ],
                "is_local": true,
                "location": 83731,
                "typeName": {
                  "location": 83743,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 83807,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "gen_random_uuid",
                              },
                            },
                          ],
                          "location": 83815,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 83833,
                    },
                  },
                ],
                "is_local": true,
                "location": 83799,
                "typeName": {
                  "location": 83802,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "realtime.messages",
            "name": "messages",
            "schema": "realtime",
          },
          "realtime.messages_2025_06_02" => {
            "columns": [
              {
                "colname": "topic",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 84094,
                    },
                  },
                ],
                "is_local": true,
                "location": 84083,
                "typeName": {
                  "location": 84089,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "extension",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 84123,
                    },
                  },
                ],
                "is_local": true,
                "location": 84108,
                "typeName": {
                  "location": 84118,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "payload",
                "is_local": true,
                "location": 84137,
                "typeName": {
                  "location": 84145,
                  "names": [
                    {
                      "String": {
                        "sval": "jsonb",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "event",
                "is_local": true,
                "location": 84156,
                "typeName": {
                  "location": 84162,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "private",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 84188,
                      "raw_expr": {
                        "A_Const": {
                          "boolval": {},
                          "location": 84196,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 84172,
                "typeName": {
                  "location": 84180,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "bool",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 84246,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 84254,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 84260,
                    },
                  },
                ],
                "is_local": true,
                "location": 84207,
                "typeName": {
                  "location": 84218,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "inserted_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 84314,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 84322,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 84328,
                    },
                  },
                ],
                "is_local": true,
                "location": 84274,
                "typeName": {
                  "location": 84286,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 84350,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "gen_random_uuid",
                              },
                            },
                          ],
                          "location": 84358,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 84376,
                    },
                  },
                ],
                "is_local": true,
                "location": 84342,
                "typeName": {
                  "location": 84345,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "realtime.messages_2025_06_02",
            "name": "messages_2025_06_02",
            "schema": "realtime",
          },
          "realtime.messages_2025_06_03" => {
            "columns": [
              {
                "colname": "topic",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 84606,
                    },
                  },
                ],
                "is_local": true,
                "location": 84595,
                "typeName": {
                  "location": 84601,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "extension",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 84635,
                    },
                  },
                ],
                "is_local": true,
                "location": 84620,
                "typeName": {
                  "location": 84630,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "payload",
                "is_local": true,
                "location": 84649,
                "typeName": {
                  "location": 84657,
                  "names": [
                    {
                      "String": {
                        "sval": "jsonb",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "event",
                "is_local": true,
                "location": 84668,
                "typeName": {
                  "location": 84674,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "private",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 84700,
                      "raw_expr": {
                        "A_Const": {
                          "boolval": {},
                          "location": 84708,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 84684,
                "typeName": {
                  "location": 84692,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "bool",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 84758,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 84766,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 84772,
                    },
                  },
                ],
                "is_local": true,
                "location": 84719,
                "typeName": {
                  "location": 84730,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "inserted_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 84826,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 84834,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 84840,
                    },
                  },
                ],
                "is_local": true,
                "location": 84786,
                "typeName": {
                  "location": 84798,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 84862,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "gen_random_uuid",
                              },
                            },
                          ],
                          "location": 84870,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 84888,
                    },
                  },
                ],
                "is_local": true,
                "location": 84854,
                "typeName": {
                  "location": 84857,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "realtime.messages_2025_06_03",
            "name": "messages_2025_06_03",
            "schema": "realtime",
          },
          "realtime.messages_2025_06_04" => {
            "columns": [
              {
                "colname": "topic",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 85118,
                    },
                  },
                ],
                "is_local": true,
                "location": 85107,
                "typeName": {
                  "location": 85113,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "extension",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 85147,
                    },
                  },
                ],
                "is_local": true,
                "location": 85132,
                "typeName": {
                  "location": 85142,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "payload",
                "is_local": true,
                "location": 85161,
                "typeName": {
                  "location": 85169,
                  "names": [
                    {
                      "String": {
                        "sval": "jsonb",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "event",
                "is_local": true,
                "location": 85180,
                "typeName": {
                  "location": 85186,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "private",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 85212,
                      "raw_expr": {
                        "A_Const": {
                          "boolval": {},
                          "location": 85220,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 85196,
                "typeName": {
                  "location": 85204,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "bool",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 85270,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 85278,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 85284,
                    },
                  },
                ],
                "is_local": true,
                "location": 85231,
                "typeName": {
                  "location": 85242,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "inserted_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 85338,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 85346,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 85352,
                    },
                  },
                ],
                "is_local": true,
                "location": 85298,
                "typeName": {
                  "location": 85310,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 85374,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "gen_random_uuid",
                              },
                            },
                          ],
                          "location": 85382,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 85400,
                    },
                  },
                ],
                "is_local": true,
                "location": 85366,
                "typeName": {
                  "location": 85369,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "realtime.messages_2025_06_04",
            "name": "messages_2025_06_04",
            "schema": "realtime",
          },
          "realtime.messages_2025_06_05" => {
            "columns": [
              {
                "colname": "topic",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 85630,
                    },
                  },
                ],
                "is_local": true,
                "location": 85619,
                "typeName": {
                  "location": 85625,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "extension",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 85659,
                    },
                  },
                ],
                "is_local": true,
                "location": 85644,
                "typeName": {
                  "location": 85654,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "payload",
                "is_local": true,
                "location": 85673,
                "typeName": {
                  "location": 85681,
                  "names": [
                    {
                      "String": {
                        "sval": "jsonb",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "event",
                "is_local": true,
                "location": 85692,
                "typeName": {
                  "location": 85698,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "private",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 85724,
                      "raw_expr": {
                        "A_Const": {
                          "boolval": {},
                          "location": 85732,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 85708,
                "typeName": {
                  "location": 85716,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "bool",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 85782,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 85790,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 85796,
                    },
                  },
                ],
                "is_local": true,
                "location": 85743,
                "typeName": {
                  "location": 85754,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "inserted_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 85850,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 85858,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 85864,
                    },
                  },
                ],
                "is_local": true,
                "location": 85810,
                "typeName": {
                  "location": 85822,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 85886,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "gen_random_uuid",
                              },
                            },
                          ],
                          "location": 85894,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 85912,
                    },
                  },
                ],
                "is_local": true,
                "location": 85878,
                "typeName": {
                  "location": 85881,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "realtime.messages_2025_06_05",
            "name": "messages_2025_06_05",
            "schema": "realtime",
          },
          "realtime.messages_2025_06_06" => {
            "columns": [
              {
                "colname": "topic",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 86142,
                    },
                  },
                ],
                "is_local": true,
                "location": 86131,
                "typeName": {
                  "location": 86137,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "extension",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 86171,
                    },
                  },
                ],
                "is_local": true,
                "location": 86156,
                "typeName": {
                  "location": 86166,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "payload",
                "is_local": true,
                "location": 86185,
                "typeName": {
                  "location": 86193,
                  "names": [
                    {
                      "String": {
                        "sval": "jsonb",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "event",
                "is_local": true,
                "location": 86204,
                "typeName": {
                  "location": 86210,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "private",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 86236,
                      "raw_expr": {
                        "A_Const": {
                          "boolval": {},
                          "location": 86244,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 86220,
                "typeName": {
                  "location": 86228,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "bool",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 86294,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 86302,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 86308,
                    },
                  },
                ],
                "is_local": true,
                "location": 86255,
                "typeName": {
                  "location": 86266,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "inserted_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 86362,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 86370,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 86376,
                    },
                  },
                ],
                "is_local": true,
                "location": 86322,
                "typeName": {
                  "location": 86334,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 86398,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "gen_random_uuid",
                              },
                            },
                          ],
                          "location": 86406,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 86424,
                    },
                  },
                ],
                "is_local": true,
                "location": 86390,
                "typeName": {
                  "location": 86393,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "realtime.messages_2025_06_06",
            "name": "messages_2025_06_06",
            "schema": "realtime",
          },
          "realtime.schema_migrations" => {
            "columns": [
              {
                "colname": "version",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 86654,
                    },
                  },
                ],
                "is_local": true,
                "location": 86639,
                "typeName": {
                  "location": 86647,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int8",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "inserted_at",
                "is_local": true,
                "location": 86668,
                "typeName": {
                  "location": 86680,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {},
                        "location": 86690,
                      },
                    },
                  ],
                },
              },
            ],
            "constraints": [],
            "id": "realtime.schema_migrations",
            "name": "schema_migrations",
            "schema": "realtime",
          },
          "realtime.subscription" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 86915,
                    },
                  },
                ],
                "is_local": true,
                "location": 86905,
                "typeName": {
                  "location": 86908,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int8",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "subscription_id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 86950,
                    },
                  },
                ],
                "is_local": true,
                "location": 86929,
                "typeName": {
                  "location": 86945,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "entity",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 86980,
                    },
                  },
                ],
                "is_local": true,
                "location": 86964,
                "typeName": {
                  "location": 86971,
                  "names": [
                    {
                      "String": {
                        "sval": "regclass",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "filters",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 87033,
                      "raw_expr": {
                        "TypeCast": {
                          "arg": {
                            "A_Const": {
                              "location": 87041,
                              "sval": {
                                "sval": "{}",
                              },
                            },
                          },
                          "location": 87045,
                          "typeName": {
                            "arrayBounds": [
                              {
                                "Integer": {
                                  "ival": -1,
                                },
                              },
                            ],
                            "location": 87047,
                            "names": [
                              {
                                "String": {
                                  "sval": "realtime",
                                },
                              },
                              {
                                "String": {
                                  "sval": "user_defined_filter",
                                },
                              },
                            ],
                            "typemod": -1,
                          },
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 87078,
                    },
                  },
                ],
                "is_local": true,
                "location": 86994,
                "typeName": {
                  "arrayBounds": [
                    {
                      "Integer": {
                        "ival": -1,
                      },
                    },
                  ],
                  "location": 87002,
                  "names": [
                    {
                      "String": {
                        "sval": "realtime",
                      },
                    },
                    {
                      "String": {
                        "sval": "user_defined_filter",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "claims",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 87105,
                    },
                  },
                ],
                "is_local": true,
                "location": 87092,
                "typeName": {
                  "location": 87099,
                  "names": [
                    {
                      "String": {
                        "sval": "jsonb",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "claims_role",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_GENERATED",
                      "generated_when": "a",
                      "location": 87139,
                      "raw_expr": {
                        "FuncCall": {
                          "args": [
                            {
                              "A_Expr": {
                                "kind": "AEXPR_OP",
                                "lexpr": {
                                  "ColumnRef": {
                                    "fields": [
                                      {
                                        "String": {
                                          "sval": "claims",
                                        },
                                      },
                                    ],
                                    "location": 87181,
                                  },
                                },
                                "location": 87188,
                                "name": [
                                  {
                                    "String": {
                                      "sval": "->>",
                                    },
                                  },
                                ],
                                "rexpr": {
                                  "TypeCast": {
                                    "arg": {
                                      "A_Const": {
                                        "location": 87192,
                                        "sval": {
                                          "sval": "role",
                                        },
                                      },
                                    },
                                    "location": 87198,
                                    "typeName": {
                                      "location": 87200,
                                      "names": [
                                        {
                                          "String": {
                                            "sval": "text",
                                          },
                                        },
                                      ],
                                      "typemod": -1,
                                    },
                                  },
                                },
                              },
                            },
                          ],
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "realtime",
                              },
                            },
                            {
                              "String": {
                                "sval": "to_regrole",
                              },
                            },
                          ],
                          "location": 87160,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 87215,
                    },
                  },
                ],
                "is_local": true,
                "location": 87119,
                "typeName": {
                  "location": 87131,
                  "names": [
                    {
                      "String": {
                        "sval": "regrole",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 87268,
                      "raw_expr": {
                        "FuncCall": {
                          "args": [
                            {
                              "TypeCast": {
                                "arg": {
                                  "A_Const": {
                                    "location": 87285,
                                    "sval": {
                                      "sval": "utc",
                                    },
                                  },
                                },
                                "location": 87290,
                                "typeName": {
                                  "location": 87292,
                                  "names": [
                                    {
                                      "String": {
                                        "sval": "text",
                                      },
                                    },
                                  ],
                                  "typemod": -1,
                                },
                              },
                            },
                            {
                              "FuncCall": {
                                "funcformat": "COERCE_EXPLICIT_CALL",
                                "funcname": [
                                  {
                                    "String": {
                                      "sval": "now",
                                    },
                                  },
                                ],
                                "location": 87298,
                              },
                            },
                          ],
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "timezone",
                              },
                            },
                          ],
                          "location": 87276,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 87305,
                    },
                  },
                ],
                "is_local": true,
                "location": 87229,
                "typeName": {
                  "location": 87240,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "realtime.subscription",
            "name": "subscription",
            "schema": "realtime",
          },
          "storage.buckets" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 87817,
                    },
                  },
                ],
                "is_local": true,
                "location": 87809,
                "typeName": {
                  "location": 87812,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "name",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 87841,
                    },
                  },
                ],
                "is_local": true,
                "location": 87831,
                "typeName": {
                  "location": 87836,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "owner",
                "is_local": true,
                "location": 87855,
                "typeName": {
                  "location": 87861,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 87907,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 87915,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 87871,
                "typeName": {
                  "location": 87882,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 87962,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 87970,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 87926,
                "typeName": {
                  "location": 87937,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "public",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 87996,
                      "raw_expr": {
                        "A_Const": {
                          "boolval": {},
                          "location": 88004,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 87981,
                "typeName": {
                  "location": 87988,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "bool",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "avif_autodetection",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 88042,
                      "raw_expr": {
                        "A_Const": {
                          "boolval": {},
                          "location": 88050,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 88015,
                "typeName": {
                  "location": 88034,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "bool",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "file_size_limit",
                "is_local": true,
                "location": 88061,
                "typeName": {
                  "location": 88077,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int8",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "allowed_mime_types",
                "is_local": true,
                "location": 88089,
                "typeName": {
                  "arrayBounds": [
                    {
                      "Integer": {
                        "ival": -1,
                      },
                    },
                  ],
                  "location": 88108,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "owner_id",
                "is_local": true,
                "location": 88120,
                "typeName": {
                  "location": 88129,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "storage.buckets",
            "name": "buckets",
            "schema": "storage",
          },
          "storage.migrations" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 88528,
                    },
                  },
                ],
                "is_local": true,
                "location": 88517,
                "typeName": {
                  "location": 88520,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int4",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "name",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 88570,
                    },
                  },
                ],
                "is_local": true,
                "location": 88542,
                "typeName": {
                  "location": 88547,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "varchar",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {
                          "ival": 100,
                        },
                        "location": 88565,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "hash",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 88611,
                    },
                  },
                ],
                "is_local": true,
                "location": 88584,
                "typeName": {
                  "location": 88589,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "varchar",
                      },
                    },
                  ],
                  "typemod": -1,
                  "typmods": [
                    {
                      "A_Const": {
                        "ival": {
                          "ival": 40,
                        },
                        "location": 88607,
                      },
                    },
                  ],
                },
              },
              {
                "colname": "executed_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 88665,
                      "raw_expr": {
                        "SQLValueFunction": {
                          "location": 88673,
                          "op": "SVFOP_CURRENT_TIMESTAMP",
                          "typmod": -1,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 88625,
                "typeName": {
                  "location": 88637,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamp",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "storage.migrations",
            "name": "migrations",
            "schema": "storage",
          },
          "storage.objects" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 88889,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "gen_random_uuid",
                              },
                            },
                          ],
                          "location": 88897,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 88915,
                    },
                  },
                ],
                "is_local": true,
                "location": 88881,
                "typeName": {
                  "location": 88884,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "bucket_id",
                "is_local": true,
                "location": 88929,
                "typeName": {
                  "location": 88939,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "name",
                "is_local": true,
                "location": 88949,
                "typeName": {
                  "location": 88954,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "owner",
                "is_local": true,
                "location": 88964,
                "typeName": {
                  "location": 88970,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 89016,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 89024,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 88980,
                "typeName": {
                  "location": 88991,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 89071,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 89079,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 89035,
                "typeName": {
                  "location": 89046,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "last_accessed_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 89132,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 89140,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 89090,
                "typeName": {
                  "location": 89107,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "metadata",
                "is_local": true,
                "location": 89151,
                "typeName": {
                  "location": 89160,
                  "names": [
                    {
                      "String": {
                        "sval": "jsonb",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "path_tokens",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_GENERATED",
                      "generated_when": "a",
                      "location": 89190,
                      "raw_expr": {
                        "FuncCall": {
                          "args": [
                            {
                              "ColumnRef": {
                                "fields": [
                                  {
                                    "String": {
                                      "sval": "name",
                                    },
                                  },
                                ],
                                "location": 89227,
                              },
                            },
                            {
                              "TypeCast": {
                                "arg": {
                                  "A_Const": {
                                    "location": 89233,
                                    "sval": {
                                      "sval": "/",
                                    },
                                  },
                                },
                                "location": 89236,
                                "typeName": {
                                  "location": 89238,
                                  "names": [
                                    {
                                      "String": {
                                        "sval": "text",
                                      },
                                    },
                                  ],
                                  "typemod": -1,
                                },
                              },
                            },
                          ],
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "string_to_array",
                              },
                            },
                          ],
                          "location": 89211,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 89171,
                "typeName": {
                  "arrayBounds": [
                    {
                      "Integer": {
                        "ival": -1,
                      },
                    },
                  ],
                  "location": 89183,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "version",
                "is_local": true,
                "location": 89257,
                "typeName": {
                  "location": 89265,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "owner_id",
                "is_local": true,
                "location": 89275,
                "typeName": {
                  "location": 89284,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "user_metadata",
                "is_local": true,
                "location": 89294,
                "typeName": {
                  "location": 89308,
                  "names": [
                    {
                      "String": {
                        "sval": "jsonb",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "level",
                "is_local": true,
                "location": 89319,
                "typeName": {
                  "location": 89325,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int4",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "storage.objects",
            "name": "objects",
            "schema": "storage",
          },
          "storage.prefixes" => {
            "columns": [
              {
                "colname": "bucket_id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 89727,
                    },
                  },
                ],
                "is_local": true,
                "location": 89712,
                "typeName": {
                  "location": 89722,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "collClause": {
                  "collname": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "C",
                      },
                    },
                  ],
                  "location": 89760,
                },
                "colname": "name",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 89751,
                    },
                  },
                ],
                "is_local": true,
                "location": 89741,
                "typeName": {
                  "location": 89746,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "level",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_GENERATED",
                      "generated_when": "a",
                      "location": 89802,
                      "raw_expr": {
                        "FuncCall": {
                          "args": [
                            {
                              "ColumnRef": {
                                "fields": [
                                  {
                                    "String": {
                                      "sval": "name",
                                    },
                                  },
                                ],
                                "location": 89841,
                              },
                            },
                          ],
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "storage",
                              },
                            },
                            {
                              "String": {
                                "sval": "get_level",
                              },
                            },
                          ],
                          "location": 89823,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 89855,
                    },
                  },
                ],
                "is_local": true,
                "location": 89788,
                "typeName": {
                  "location": 89794,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int4",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 89905,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 89913,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 89869,
                "typeName": {
                  "location": 89880,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "updated_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 89960,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 89968,
                        },
                      },
                    },
                  },
                ],
                "is_local": true,
                "location": 89924,
                "typeName": {
                  "location": 89935,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "storage.prefixes",
            "name": "prefixes",
            "schema": "storage",
          },
          "storage.s3_multipart_uploads" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 90196,
                    },
                  },
                ],
                "is_local": true,
                "location": 90188,
                "typeName": {
                  "location": 90191,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "in_progress_size",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 90234,
                      "raw_expr": {
                        "A_Const": {
                          "ival": {},
                          "location": 90242,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 90244,
                    },
                  },
                ],
                "is_local": true,
                "location": 90210,
                "typeName": {
                  "location": 90227,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int8",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "upload_signature",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 90280,
                    },
                  },
                ],
                "is_local": true,
                "location": 90258,
                "typeName": {
                  "location": 90275,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "bucket_id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 90309,
                    },
                  },
                ],
                "is_local": true,
                "location": 90294,
                "typeName": {
                  "location": 90304,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "collClause": {
                  "collname": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "C",
                      },
                    },
                  ],
                  "location": 90341,
                },
                "colname": "key",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 90332,
                    },
                  },
                ],
                "is_local": true,
                "location": 90323,
                "typeName": {
                  "location": 90327,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "version",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 90382,
                    },
                  },
                ],
                "is_local": true,
                "location": 90369,
                "typeName": {
                  "location": 90377,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "owner_id",
                "is_local": true,
                "location": 90396,
                "typeName": {
                  "location": 90405,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 90451,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 90459,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 90465,
                    },
                  },
                ],
                "is_local": true,
                "location": 90415,
                "typeName": {
                  "location": 90426,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "user_metadata",
                "is_local": true,
                "location": 90479,
                "typeName": {
                  "location": 90493,
                  "names": [
                    {
                      "String": {
                        "sval": "jsonb",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "storage.s3_multipart_uploads",
            "name": "s3_multipart_uploads",
            "schema": "storage",
          },
          "storage.s3_multipart_uploads_parts" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 90745,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "gen_random_uuid",
                              },
                            },
                          ],
                          "location": 90753,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 90771,
                    },
                  },
                ],
                "is_local": true,
                "location": 90737,
                "typeName": {
                  "location": 90740,
                  "names": [
                    {
                      "String": {
                        "sval": "uuid",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "upload_id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 90800,
                    },
                  },
                ],
                "is_local": true,
                "location": 90785,
                "typeName": {
                  "location": 90795,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "size",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 90826,
                      "raw_expr": {
                        "A_Const": {
                          "ival": {},
                          "location": 90834,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 90836,
                    },
                  },
                ],
                "is_local": true,
                "location": 90814,
                "typeName": {
                  "location": 90819,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int8",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "part_number",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 90870,
                    },
                  },
                ],
                "is_local": true,
                "location": 90850,
                "typeName": {
                  "location": 90862,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int4",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "bucket_id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 90899,
                    },
                  },
                ],
                "is_local": true,
                "location": 90884,
                "typeName": {
                  "location": 90894,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "collClause": {
                  "collname": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "C",
                      },
                    },
                  ],
                  "location": 90931,
                },
                "colname": "key",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 90922,
                    },
                  },
                ],
                "is_local": true,
                "location": 90913,
                "typeName": {
                  "location": 90917,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "etag",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 90969,
                    },
                  },
                ],
                "is_local": true,
                "location": 90959,
                "typeName": {
                  "location": 90964,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "owner_id",
                "is_local": true,
                "location": 90983,
                "typeName": {
                  "location": 90992,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "version",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 91015,
                    },
                  },
                ],
                "is_local": true,
                "location": 91002,
                "typeName": {
                  "location": 91010,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 91065,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 91073,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 91079,
                    },
                  },
                ],
                "is_local": true,
                "location": 91029,
                "typeName": {
                  "location": 91040,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "storage.s3_multipart_uploads_parts",
            "name": "s3_multipart_uploads_parts",
            "schema": "storage",
          },
          "supabase_functions.hooks" => {
            "columns": [
              {
                "colname": "id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 91324,
                    },
                  },
                ],
                "is_local": true,
                "location": 91314,
                "typeName": {
                  "location": 91317,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int8",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "hook_table_id",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 91360,
                    },
                  },
                ],
                "is_local": true,
                "location": 91338,
                "typeName": {
                  "location": 91352,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int4",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "hook_name",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 91389,
                    },
                  },
                ],
                "is_local": true,
                "location": 91374,
                "typeName": {
                  "location": 91384,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "created_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 91439,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 91447,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 91453,
                    },
                  },
                ],
                "is_local": true,
                "location": 91403,
                "typeName": {
                  "location": 91414,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "request_id",
                "is_local": true,
                "location": 91467,
                "typeName": {
                  "location": 91478,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "int8",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "supabase_functions.hooks",
            "name": "hooks",
            "schema": "supabase_functions",
          },
          "supabase_functions.migrations" => {
            "columns": [
              {
                "colname": "version",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 92461,
                    },
                  },
                ],
                "is_local": true,
                "location": 92448,
                "typeName": {
                  "location": 92456,
                  "names": [
                    {
                      "String": {
                        "sval": "text",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
              {
                "colname": "inserted_at",
                "constraints": [
                  {
                    "Constraint": {
                      "contype": "CONSTR_DEFAULT",
                      "location": 92512,
                      "raw_expr": {
                        "FuncCall": {
                          "funcformat": "COERCE_EXPLICIT_CALL",
                          "funcname": [
                            {
                              "String": {
                                "sval": "now",
                              },
                            },
                          ],
                          "location": 92520,
                        },
                      },
                    },
                  },
                  {
                    "Constraint": {
                      "contype": "CONSTR_NOTNULL",
                      "location": 92526,
                    },
                  },
                ],
                "is_local": true,
                "location": 92475,
                "typeName": {
                  "location": 92487,
                  "names": [
                    {
                      "String": {
                        "sval": "pg_catalog",
                      },
                    },
                    {
                      "String": {
                        "sval": "timestamptz",
                      },
                    },
                  ],
                  "typemod": -1,
                },
              },
            ],
            "constraints": [],
            "id": "supabase_functions.migrations",
            "name": "migrations",
            "schema": "supabase_functions",
          },
        },
        "types": Map {
          "auth.aal_level" => {
            "id": "auth.aal_level",
            "kind": "enum",
            "name": "aal_level",
            "owner": {
              "location": 4089,
              "rolename": "supabase_auth_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "schema": "auth",
            "statement": {
              "typeName": [
                {
                  "String": {
                    "sval": "auth",
                  },
                },
                {
                  "String": {
                    "sval": "aal_level",
                  },
                },
              ],
              "vals": [
                {
                  "String": {
                    "sval": "aal1",
                  },
                },
                {
                  "String": {
                    "sval": "aal2",
                  },
                },
                {
                  "String": {
                    "sval": "aal3",
                  },
                },
              ],
            },
          },
          "auth.code_challenge_method" => {
            "id": "auth.code_challenge_method",
            "kind": "enum",
            "name": "code_challenge_method",
            "owner": {
              "location": 4328,
              "rolename": "supabase_auth_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "schema": "auth",
            "statement": {
              "typeName": [
                {
                  "String": {
                    "sval": "auth",
                  },
                },
                {
                  "String": {
                    "sval": "code_challenge_method",
                  },
                },
              ],
              "vals": [
                {
                  "String": {
                    "sval": "s256",
                  },
                },
                {
                  "String": {
                    "sval": "plain",
                  },
                },
              ],
            },
          },
          "auth.factor_status" => {
            "id": "auth.factor_status",
            "kind": "enum",
            "name": "factor_status",
            "owner": {
              "location": 4552,
              "rolename": "supabase_auth_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "schema": "auth",
            "statement": {
              "typeName": [
                {
                  "String": {
                    "sval": "auth",
                  },
                },
                {
                  "String": {
                    "sval": "factor_status",
                  },
                },
              ],
              "vals": [
                {
                  "String": {
                    "sval": "unverified",
                  },
                },
                {
                  "String": {
                    "sval": "verified",
                  },
                },
              ],
            },
          },
          "auth.factor_type" => {
            "id": "auth.factor_type",
            "kind": "enum",
            "name": "factor_type",
            "owner": {
              "location": 4777,
              "rolename": "supabase_auth_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "schema": "auth",
            "statement": {
              "typeName": [
                {
                  "String": {
                    "sval": "auth",
                  },
                },
                {
                  "String": {
                    "sval": "factor_type",
                  },
                },
              ],
              "vals": [
                {
                  "String": {
                    "sval": "totp",
                  },
                },
                {
                  "String": {
                    "sval": "webauthn",
                  },
                },
                {
                  "String": {
                    "sval": "phone",
                  },
                },
              ],
            },
          },
          "auth.one_time_token_type" => {
            "id": "auth.one_time_token_type",
            "kind": "enum",
            "name": "one_time_token_type",
            "owner": {
              "location": 5153,
              "rolename": "supabase_auth_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "schema": "auth",
            "statement": {
              "typeName": [
                {
                  "String": {
                    "sval": "auth",
                  },
                },
                {
                  "String": {
                    "sval": "one_time_token_type",
                  },
                },
              ],
              "vals": [
                {
                  "String": {
                    "sval": "confirmation_token",
                  },
                },
                {
                  "String": {
                    "sval": "reauthentication_token",
                  },
                },
                {
                  "String": {
                    "sval": "recovery_token",
                  },
                },
                {
                  "String": {
                    "sval": "email_change_token_new",
                  },
                },
                {
                  "String": {
                    "sval": "email_change_token_current",
                  },
                },
                {
                  "String": {
                    "sval": "phone_change_token",
                  },
                },
              ],
            },
          },
          "realtime.action" => {
            "id": "realtime.action",
            "kind": "enum",
            "name": "action",
            "owner": {
              "location": 5400,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "schema": "realtime",
            "statement": {
              "typeName": [
                {
                  "String": {
                    "sval": "realtime",
                  },
                },
                {
                  "String": {
                    "sval": "action",
                  },
                },
              ],
              "vals": [
                {
                  "String": {
                    "sval": "INSERT",
                  },
                },
                {
                  "String": {
                    "sval": "UPDATE",
                  },
                },
                {
                  "String": {
                    "sval": "DELETE",
                  },
                },
                {
                  "String": {
                    "sval": "TRUNCATE",
                  },
                },
                {
                  "String": {
                    "sval": "ERROR",
                  },
                },
              ],
            },
          },
          "realtime.equality_op" => {
            "id": "realtime.equality_op",
            "kind": "enum",
            "name": "equality_op",
            "owner": {
              "location": 5659,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "schema": "realtime",
            "statement": {
              "typeName": [
                {
                  "String": {
                    "sval": "realtime",
                  },
                },
                {
                  "String": {
                    "sval": "equality_op",
                  },
                },
              ],
              "vals": [
                {
                  "String": {
                    "sval": "eq",
                  },
                },
                {
                  "String": {
                    "sval": "neq",
                  },
                },
                {
                  "String": {
                    "sval": "lt",
                  },
                },
                {
                  "String": {
                    "sval": "lte",
                  },
                },
                {
                  "String": {
                    "sval": "gt",
                  },
                },
                {
                  "String": {
                    "sval": "gte",
                  },
                },
                {
                  "String": {
                    "sval": "in",
                  },
                },
              ],
            },
          },
        },
      }
    `);
  });
});
