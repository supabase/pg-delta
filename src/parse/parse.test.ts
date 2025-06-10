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
    expect(ctx.sequences).toMatchInlineSnapshot(`
      Map {
        "auth.refresh_tokens_id_seq" => {
          "id": "auth.refresh_tokens_id_seq",
          "name": "refresh_tokens_id_seq",
          "owner": {
            "location": 76237,
            "rolename": "supabase_auth_admin",
            "roletype": "ROLESPEC_CSTRING",
          },
          "schema": "auth",
          "statement": {
            "options": [
              {
                "DefElem": {
                  "arg": {
                    "Integer": {
                      "ival": 1,
                    },
                  },
                  "defaction": "DEFELEM_UNSPEC",
                  "defname": "start",
                  "location": 76107,
                },
              },
              {
                "DefElem": {
                  "arg": {
                    "Integer": {
                      "ival": 1,
                    },
                  },
                  "defaction": "DEFELEM_UNSPEC",
                  "defname": "increment",
                  "location": 76124,
                },
              },
              {
                "DefElem": {
                  "defaction": "DEFELEM_UNSPEC",
                  "defname": "minvalue",
                  "location": 76143,
                },
              },
              {
                "DefElem": {
                  "defaction": "DEFELEM_UNSPEC",
                  "defname": "maxvalue",
                  "location": 76159,
                },
              },
              {
                "DefElem": {
                  "arg": {
                    "Integer": {
                      "ival": 1,
                    },
                  },
                  "defaction": "DEFELEM_UNSPEC",
                  "defname": "cache",
                  "location": 76175,
                },
              },
            ],
            "sequence": {
              "inh": true,
              "location": 76076,
              "relname": "refresh_tokens_id_seq",
              "relpersistence": "p",
              "schemaname": "auth",
            },
          },
        },
        "supabase_functions.hooks_id_seq" => {
          "id": "supabase_functions.hooks_id_seq",
          "name": "hooks_id_seq",
          "owner": {
            "location": 92069,
            "rolename": "supabase_functions_admin",
            "roletype": "ROLESPEC_CSTRING",
          },
          "schema": "supabase_functions",
          "statement": {
            "options": [
              {
                "DefElem": {
                  "arg": {
                    "Integer": {
                      "ival": 1,
                    },
                  },
                  "defaction": "DEFELEM_UNSPEC",
                  "defname": "start",
                  "location": 91934,
                },
              },
              {
                "DefElem": {
                  "arg": {
                    "Integer": {
                      "ival": 1,
                    },
                  },
                  "defaction": "DEFELEM_UNSPEC",
                  "defname": "increment",
                  "location": 91951,
                },
              },
              {
                "DefElem": {
                  "defaction": "DEFELEM_UNSPEC",
                  "defname": "minvalue",
                  "location": 91970,
                },
              },
              {
                "DefElem": {
                  "defaction": "DEFELEM_UNSPEC",
                  "defname": "maxvalue",
                  "location": 91986,
                },
              },
              {
                "DefElem": {
                  "arg": {
                    "Integer": {
                      "ival": 1,
                    },
                  },
                  "defaction": "DEFELEM_UNSPEC",
                  "defname": "cache",
                  "location": 92002,
                },
              },
            ],
            "sequence": {
              "inh": true,
              "location": 91898,
              "relname": "hooks_id_seq",
              "relpersistence": "p",
              "schemaname": "supabase_functions",
            },
          },
        },
      }
    `);
  });
});
