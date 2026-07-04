import { describe, expect, test } from "bun:test";
import {
  redactOptionStrings,
  SUBSCRIPTION_CONNINFO_PLACEHOLDER,
} from "./sensitive-options.ts";

describe("redactOptionStrings", () => {
  test("keeps allowlisted (non-credential) option values verbatim", () => {
    expect(
      redactOptionStrings([
        "host=remote.example.com",
        "port=5432",
        "user=fdw_reader",
        "use_remote_estimate=true",
        "schema_name=remote_schema",
      ]),
    ).toEqual([
      "host=remote.example.com",
      "port=5432",
      "user=fdw_reader",
      "use_remote_estimate=true",
      "schema_name=remote_schema",
    ]);
  });

  test("replaces non-allowlisted values with __OPTION_<KEY>__ placeholders", () => {
    expect(
      redactOptionStrings([
        "password=real-secret",
        "passfile=/etc/secrets/pass",
        "passcode=krb",
        "sslpassword=ssl-secret",
        "api_key=abc123",
      ]),
    ).toEqual([
      "password=__OPTION_PASSWORD__",
      "passfile=__OPTION_PASSFILE__",
      "passcode=__OPTION_PASSCODE__",
      "sslpassword=__OPTION_SSLPASSWORD__",
      "api_key=__OPTION_API_KEY__",
    ]);
  });

  test("keeps the non-secret postgres_fdw user-mapping option password_required", () => {
    // password_required is a documented postgres_fdw user-mapping option, not a
    // credential. Redacting it would make `password_required=false` invisible to
    // diff (both sides redact to the same placeholder) and emit a placeholder on
    // export/plan-from-empty. It must survive verbatim.
    expect(
      redactOptionStrings([
        "password_required=false",
        "password_required=true",
      ]),
    ).toEqual(["password_required=false", "password_required=true"]);
  });

  test("keeps the non-secret postgres_fdw connection option service", () => {
    // `service` names a pg_service.conf connection-service entry — a reference,
    // not a credential (the actual host/user/password live in that file). It is
    // a documented libpq/postgres_fdw connection option; redacting it would make
    // a service-name change invisible to diff (both sides redact to the same
    // placeholder) and emit `service=__OPTION_SERVICE__` on export/plan-from-empty.
    expect(redactOptionStrings(["service=prod"])).toEqual(["service=prod"]);
  });

  test("allowlist match is case-insensitive; placeholder upper-cases the key", () => {
    expect(redactOptionStrings(["HOST=h", "Password=secret"])).toEqual([
      "HOST=h",
      "Password=__OPTION_PASSWORD__",
    ]);
  });

  test("splits on the first '=' so values containing '=' are not truncated", () => {
    expect(redactOptionStrings(["host=a=b=c"])).toEqual(["host=a=b=c"]);
    expect(redactOptionStrings(["token=a=b=c"])).toEqual([
      "token=__OPTION_TOKEN__",
    ]);
  });

  test("leaves a valueless option untouched", () => {
    expect(redactOptionStrings(["solo"])).toEqual(["solo"]);
  });

  test("conninfo placeholder carries no real values", () => {
    expect(SUBSCRIPTION_CONNINFO_PLACEHOLDER).toBe(
      "host=__CONN_HOST__ port=__CONN_PORT__ dbname=__CONN_DBNAME__ user=__CONN_USER__ password=__CONN_PASSWORD__",
    );
  });
});
