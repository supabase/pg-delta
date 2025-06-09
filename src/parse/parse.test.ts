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
        "schemas": Map {
          "_realtime" => {
            "authrole": {
              "location": 601,
              "rolename": "postgres",
              "roletype": "ROLESPEC_CSTRING",
            },
            "schemaname": "_realtime",
          },
          "auth" => {
            "authrole": {
              "location": 730,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "schemaname": "auth",
          },
          "extensions" => {
            "authrole": {
              "location": 877,
              "rolename": "postgres",
              "roletype": "ROLESPEC_CSTRING",
            },
            "schemaname": "extensions",
          },
          "graphql" => {
            "authrole": {
              "location": 1015,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "schemaname": "graphql",
          },
          "graphql_public" => {
            "authrole": {
              "location": 1180,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "schemaname": "graphql_public",
          },
          "pgbouncer" => {
            "authrole": {
              "location": 1565,
              "rolename": "pgbouncer",
              "roletype": "ROLESPEC_CSTRING",
            },
            "schemaname": "pgbouncer",
          },
          "realtime" => {
            "authrole": {
              "location": 1707,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "schemaname": "realtime",
          },
          "storage" => {
            "authrole": {
              "location": 1851,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "schemaname": "storage",
          },
          "supabase_functions" => {
            "authrole": {
              "location": 2028,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "schemaname": "supabase_functions",
          },
          "vault" => {
            "authrole": {
              "location": 2166,
              "rolename": "supabase_admin",
              "roletype": "ROLESPEC_CSTRING",
            },
            "schemaname": "vault",
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
      }
    `);
  });
});
