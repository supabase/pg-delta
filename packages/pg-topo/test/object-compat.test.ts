import { describe, expect, test } from "bun:test";
import {
  isKindCompatible,
  operatorClassSignaturesCompatible,
  signaturesCompatible,
} from "../src/model/object-compat";

describe("isKindCompatible", () => {
  test("type is compatible with view, table, domain, materialized_view", () => {
    expect(isKindCompatible("type", "type")).toBe(true);
    expect(isKindCompatible("type", "view")).toBe(true);
    expect(isKindCompatible("type", "table")).toBe(true);
    expect(isKindCompatible("type", "domain")).toBe(true);
    expect(isKindCompatible("type", "materialized_view")).toBe(true);
    expect(isKindCompatible("type", "function")).toBe(false);
  });

  test("function is compatible with procedure and vice versa", () => {
    expect(isKindCompatible("function", "procedure")).toBe(true);
    expect(isKindCompatible("procedure", "function")).toBe(true);
    expect(isKindCompatible("function", "table")).toBe(false);
  });
});

describe("signaturesCompatible", () => {
  test("matches when both signatures are undefined", () => {
    expect(signaturesCompatible(undefined, undefined)).toBe(true);
  });

  test("matches when required is undefined (no signature constraint)", () => {
    expect(signaturesCompatible(undefined, "(int,text)")).toBe(true);
  });

  test("rejects when provided is undefined but required is set", () => {
    expect(signaturesCompatible("(int,text)", undefined)).toBe(false);
  });

  test("exact arity match still works", () => {
    expect(signaturesCompatible("(int,text)", "(int,text)")).toBe(true);
    expect(
      signaturesCompatible("(bigint,text,json)", "(bigint,text,json)"),
    ).toBe(true);
  });

  test("fewer required args matches provider with more params (default params)", () => {
    expect(
      signaturesCompatible(
        "(unknown,unknown,auth.action)",
        "(bigint,text,auth.action,json,uuid)",
      ),
    ).toBe(true);
  });

  test("more required args than provided rejects", () => {
    expect(signaturesCompatible("(int,text,json)", "(int,text)")).toBe(false);
  });

  test("zero required args matches any provider", () => {
    expect(signaturesCompatible("()", "(int,text,json)")).toBe(true);
  });

  test("prefix type mismatch rejects even with fewer args", () => {
    expect(signaturesCompatible("(int,text)", "(text,int,json)")).toBe(false);
  });

  test("unknown in prefix matches any provided type", () => {
    expect(
      signaturesCompatible("(unknown,text)", "(bigint,text,json,uuid)"),
    ).toBe(true);
  });

  test("auth.can pattern: 3-arg call matches 5-param overload but not 6-param", () => {
    const callSig = "(unknown,unknown,auth.action)";
    const overload5 = "(bigint,text,auth.action,json,uuid)";
    const overload6 = "(bigint,bigint,text,auth.action,json,uuid)";

    expect(signaturesCompatible(callSig, overload5)).toBe(true);
    expect(signaturesCompatible(callSig, overload6)).toBe(false);
  });

  test("auth.can_project pattern: 4-arg call matches 6-param overload", () => {
    const callSig = "(unknown,unknown,text,auth.action)";
    const overload6 = "(bigint,bigint,text,auth.action,json,uuid)";
    const overload5 = "(bigint,text,auth.action,json,uuid)";

    expect(signaturesCompatible(callSig, overload6)).toBe(true);
    expect(signaturesCompatible(callSig, overload5)).toBe(false);
  });

  test("matches exact callbacks with canonical pg_catalog type signatures", () => {
    const options = { requireExactArity: true };

    expect(
      signaturesCompatible(
        "(text,text)",
        "(pg_catalog.text,pg_catalog.text)",
        options,
      ),
    ).toBe(true);
    expect(
      signaturesCompatible(
        "(numeric,numeric)",
        "(pg_catalog.numeric,pg_catalog.numeric)",
        options,
      ),
    ).toBe(true);
    expect(
      signaturesCompatible(
        "(uuid,uuid)",
        "(pg_catalog.uuid,pg_catalog.uuid)",
        options,
      ),
    ).toBe(true);
  });

  test("does not match explicit public shadow types to pg_catalog signatures", () => {
    const options = { requireExactArity: true };

    expect(signaturesCompatible("(int4)", "(pg_catalog.int4)", options)).toBe(
      true,
    );
    expect(
      signaturesCompatible("(pg_catalog.int4)", "(public.int4)", options),
    ).toBe(false);
    expect(
      signaturesCompatible("(public.int4)", "(pg_catalog.int4)", options),
    ).toBe(false);
  });

  test("does not match explicit public shadow types to bare built-in signatures", () => {
    const options = { requireExactArity: true };

    expect(signaturesCompatible("(int4)", "(public.int4)", options)).toBe(
      false,
    );
    expect(signaturesCompatible("(public.int4)", "(int4)", options)).toBe(
      false,
    );
    expect(
      signaturesCompatible("(cstring,oid,int4)", "(cstring,oid,public.int4)", {
        requireExactArity: true,
      }),
    ).toBe(false);
  });

  test("does not match explicit public shadow array types to bare built-in array signatures", () => {
    const options = { requireExactArity: true };

    expect(
      signaturesCompatible("(cstring[])", "(pg_catalog.cstring[])", options),
    ).toBe(true);
    expect(
      signaturesCompatible("(cstring[])", "(public.cstring[])", options),
    ).toBe(false);
    expect(
      signaturesCompatible(
        "(pg_catalog.cstring[])",
        "(public.cstring[])",
        options,
      ),
    ).toBe(false);
  });

  test("matches unqualified built-in providers for pg_catalog requirements", () => {
    const options = { requireExactArity: true };

    expect(
      signaturesCompatible(
        "(pg_catalog.int4,pg_catalog.int4)",
        "(int4,int4)",
        options,
      ),
    ).toBe(true);
    expect(
      signaturesCompatible(
        "(pg_catalog.int4,pg_catalog.int4)",
        "(public.int4,public.int4)",
        options,
      ),
    ).toBe(false);
  });

  test("requires provider return types when the requirement specifies one", () => {
    const options = { requireExactArity: true };

    expect(
      signaturesCompatible(
        "(int4,int4)->float8",
        "(int4,int4)->float8",
        options,
      ),
    ).toBe(true);
    expect(
      signaturesCompatible("(int4,int4)->float8", "(int4,int4)->int4", options),
    ).toBe(false);
    expect(
      signaturesCompatible("(int4,int4)->float8", "(int4,int4)", options),
    ).toBe(false);
  });

  test("ignores provider return types when the requirement omits one", () => {
    expect(signaturesCompatible("(int4,int4)", "(int4,int4)->float8")).toBe(
      true,
    );
  });

  test("single-arg unknown matches any single-param or multi-param provider", () => {
    expect(signaturesCompatible("(unknown)", "(bigint)")).toBe(true);
    expect(signaturesCompatible("(unknown)", "(bigint,text)")).toBe(true);
    expect(signaturesCompatible("(unknown)", "(bigint,text,json)")).toBe(true);
  });
});

describe("signaturesCompatible with allowVariadicProviderTail", () => {
  const opts = { allowVariadicProviderTail: true };

  test("VARIADIC any matches any number of trailing args", () => {
    expect(signaturesCompatible("(int,text)", "(VARIADIC any)", opts)).toBe(
      true,
    );
    expect(
      signaturesCompatible("(int,text,json)", "(VARIADIC any)", opts),
    ).toBe(true);
    expect(signaturesCompatible("(int)", "(VARIADIC any)", opts)).toBe(true);
  });

  test("fixed args + VARIADIC tail matches extra args", () => {
    expect(
      signaturesCompatible("(int,text,json)", "(int, VARIADIC any)", opts),
    ).toBe(true);
  });

  test("fixed args + VARIADIC tail rejects mismatched fixed prefix", () => {
    expect(
      signaturesCompatible("(text,text,json)", "(int, VARIADIC any)", opts),
    ).toBe(false);
  });

  test("fixed args + VARIADIC tail rejects too few required args", () => {
    expect(signaturesCompatible("()", "(int, VARIADIC any)", opts)).toBe(false);
  });

  test("exact arity disables variadic tail expansion", () => {
    expect(
      signaturesCompatible("(int,int)", "(int, VARIADIC int)", {
        ...opts,
        requireExactArity: true,
      }),
    ).toBe(false);
  });

  test("polymorphic last arg without VARIADIC does NOT enable variadic matching", () => {
    // anyelement is polymorphic but NOT variadic — should not match 2 args
    expect(signaturesCompatible("(int,text)", "(anyelement)", opts)).toBe(
      false,
    );
  });

  test("fixed-arity polymorphic function rejects extra args", () => {
    // max(anyelement) takes exactly 1 arg
    expect(signaturesCompatible("(int,text,json)", "(anyelement)", opts)).toBe(
      false,
    );
  });
});

describe("operatorClassSignaturesCompatible", () => {
  test("restricts binary-coercible operator class matches to catalog types", () => {
    expect(
      operatorClassSignaturesCompatible("(btree,varchar)", "(btree,text)"),
    ).toBe(true);
    expect(
      operatorClassSignaturesCompatible(
        "(btree,pg_catalog.varchar)",
        "(btree,pg_catalog.text)",
      ),
    ).toBe(true);
    expect(
      operatorClassSignaturesCompatible("(btree,app.varchar)", "(btree,text)"),
    ).toBe(false);
    expect(
      operatorClassSignaturesCompatible("(btree,varchar)", "(btree,app.text)"),
    ).toBe(false);
  });
});

// pg-topo is a DDL ordering tool, not a type checker. Polymorphic provider args
// are intentionally permissive: any concrete type satisfies any polymorphic
// position. PostgreSQL's requirement that repeated polymorphic occurrences unify
// to a single concrete type is deliberately NOT enforced here because:
//   1. Ordering dependencies are valid regardless of type unification correctness
//   2. Proper unification requires understanding cross-family relationships
//      (anyelement ↔ anyarray, anyrange, etc.) which is beyond scope
//   3. Call-site signatures are mostly "unknown" so this path is rarely exercised
describe("signaturesCompatible with polymorphic provider types", () => {
  test("single polymorphic arg matches any concrete type", () => {
    expect(signaturesCompatible("(int)", "(anyelement)")).toBe(true);
    expect(signaturesCompatible("(text)", "(anyelement)")).toBe(true);
    expect(signaturesCompatible("(uuid)", "(anycompatible)")).toBe(true);
    expect(signaturesCompatible("(int)", "(anynonarray)")).toBe(true);
  });

  test("repeated polymorphic arg matches different concrete types (intentionally permissive for DDL ordering)", () => {
    expect(signaturesCompatible("(int,text)", "(anyelement,anyelement)")).toBe(
      true,
    );
    expect(signaturesCompatible("(int,int)", "(anyelement,anyelement)")).toBe(
      true,
    );
  });

  test("mixed polymorphic families match (intentionally permissive)", () => {
    expect(signaturesCompatible("(int[],int)", "(anyarray,anyelement)")).toBe(
      true,
    );
    expect(signaturesCompatible("(int[],text)", "(anyarray,anyelement)")).toBe(
      true,
    );
  });

  test("different polymorphic types each match any concrete", () => {
    expect(signaturesCompatible("(int,int[])", "(anyelement,anyarray)")).toBe(
      true,
    );
    expect(signaturesCompatible("(myenum,int[])", "(anyenum,anyarray)")).toBe(
      true,
    );
  });

  test("anycompatible family behaves the same as any family", () => {
    expect(
      signaturesCompatible("(int,text)", "(anycompatible,anycompatible)"),
    ).toBe(true);
    expect(
      signaturesCompatible("(int,int[])", "(anycompatible,anycompatiblearray)"),
    ).toBe(true);
  });

  test("arity is still enforced with polymorphic args", () => {
    expect(signaturesCompatible("(int,text)", "(anyelement)")).toBe(false);
    expect(
      signaturesCompatible("(int,text,json)", "(anyelement,anyarray)"),
    ).toBe(false);
  });

  test("polymorphic check is on provider side only", () => {
    expect(signaturesCompatible("(anyelement)", "(int)")).toBe(false);
    expect(signaturesCompatible("(anyelement,anyelement)", "(int,text)")).toBe(
      false,
    );
  });
});
