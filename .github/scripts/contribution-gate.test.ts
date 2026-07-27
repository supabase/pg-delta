import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  type AuthorPermission,
  evaluateAllOpenPrs,
  evaluateGate,
  fetchAuthorPermission,
  GATE_LABEL,
  type GateIo,
  type LinkedIssue,
  type OpenPr,
} from "./contribution-gate.ts";

const REPO = "supabase/pg-toolbelt";
const originalFetch = globalThis.fetch;

describe("evaluateGate", () => {
  test("skips bot authors", () => {
    const result = evaluateGate({
      repository: REPO,
      authorAssociation: "NONE",
      isBot: true,
      linkedIssues: [],
    });
    expect(result.pass).toBe(true);
    expect(result.reason).toBe("bot");
  });

  test.each(["OWNER", "MEMBER", "COLLABORATOR"])(
    "skips internal author association %s",
    (authorAssociation) => {
      const result = evaluateGate({
        repository: REPO,
        authorAssociation,
        isBot: false,
        linkedIssues: [],
      });
      expect(result.pass).toBe(true);
      expect(result.reason).toBe("internal");
    },
  );

  test.each([
    ["admin", "internal"],
    ["write", "internal"],
    ["read", "no-linked-issue"],
    ["none", "no-linked-issue"],
  ] as const)("handles %s permission", (authorPermission, reason) => {
    const result = evaluateGate({
      repository: REPO,
      authorAssociation: "CONTRIBUTOR",
      authorPermission,
      isBot: false,
      linkedIssues: [],
    });
    expect(result.reason).toBe(reason);
  });

  test("fails when no issue is linked", () => {
    const result = evaluateGate({
      repository: REPO,
      authorAssociation: "NONE",
      isBot: false,
      linkedIssues: [],
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("no-linked-issue");
    expect(result.message).toContain(GATE_LABEL);
    expect(result.message).toContain("CONTRIBUTING.md");
  });

  test("fails when the linked issue is open but not labeled", () => {
    const result = evaluateGate({
      repository: REPO,
      authorAssociation: "CONTRIBUTOR",
      isBot: false,
      linkedIssues: [
        { repository: REPO, number: 12, state: "OPEN", labels: ["🐛 Bug"] },
      ],
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("missing-label");
    expect(result.message).toContain(GATE_LABEL);
  });

  test("fails when the only labeled issue is closed", () => {
    const result = evaluateGate({
      repository: REPO,
      authorAssociation: "NONE",
      isBot: false,
      linkedIssues: [
        { repository: REPO, number: 7, state: "CLOSED", labels: [GATE_LABEL] },
      ],
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("issue-closed");
  });

  test("passes when a linked issue is open and carries the gate label", () => {
    const result = evaluateGate({
      repository: REPO,
      authorAssociation: "NONE",
      isBot: false,
      linkedIssues: [
        {
          repository: REPO,
          number: 42,
          state: "OPEN",
          labels: [GATE_LABEL, "🐛 Bug"],
        },
      ],
    });
    expect(result.pass).toBe(true);
    expect(result.reason).toBe("ok");
  });

  test("passes when any one of several linked issues qualifies", () => {
    const result = evaluateGate({
      repository: REPO,
      authorAssociation: "FIRST_TIME_CONTRIBUTOR",
      isBot: false,
      linkedIssues: [
        { repository: REPO, number: 1, state: "CLOSED", labels: [GATE_LABEL] },
        { repository: REPO, number: 2, state: "OPEN", labels: ["✨ Feature"] },
        { repository: REPO, number: 3, state: "OPEN", labels: [GATE_LABEL] },
      ],
    });
    expect(result.pass).toBe(true);
    expect(result.reason).toBe("ok");
  });

  test("ignores an open, labeled issue from a different repository", () => {
    // Cross-repo closing keyword (e.g. `Closes attacker/repo#1`): the issue is
    // controlled by the contributor, so it must not satisfy the gate.
    const result = evaluateGate({
      repository: REPO,
      authorAssociation: "NONE",
      isBot: false,
      linkedIssues: [
        {
          repository: "attacker/repo",
          number: 1,
          state: "OPEN",
          labels: [GATE_LABEL],
        },
      ],
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("no-linked-issue");
  });

  test("matches the repository case-insensitively", () => {
    const result = evaluateGate({
      repository: REPO,
      authorAssociation: "NONE",
      isBot: false,
      linkedIssues: [
        {
          repository: "Supabase/PG-Toolbelt",
          number: 5,
          state: "OPEN",
          labels: [GATE_LABEL],
        },
      ],
    });
    expect(result.pass).toBe(true);
    expect(result.reason).toBe("ok");
  });
});

describe("evaluateAllOpenPrs", () => {
  function pr(
    number: number,
    authorLogin: string,
    authorAssociation = "NONE",
    isBot = false,
  ): OpenPr {
    return { number, authorLogin, authorAssociation, isBot };
  }

  function makeIo(
    openPrs: OpenPr[],
    linkedByPr: Record<number, LinkedIssue[]>,
    permissionByLogin: Partial<Record<string, AuthorPermission>> = {},
  ) {
    const closed: Array<{ number: number; message: string }> = [];
    const permissionLookups: string[] = [];
    const linkedIssueLookups: number[] = [];
    const io: GateIo = {
      listOpenPrs: () => Promise.resolve(openPrs),
      fetchPermission: (login) => {
        permissionLookups.push(login);
        return Promise.resolve(permissionByLogin[login]);
      },
      fetchLinkedIssues: (prNumber) => {
        linkedIssueLookups.push(prNumber);
        return Promise.resolve(linkedByPr[prNumber] ?? []);
      },
      closePr: (prNumber, message) => {
        closed.push({ number: prNumber, message });
        return Promise.resolve();
      },
    };
    return { io, closed, permissionLookups, linkedIssueLookups };
  }

  test("closes only non-conforming external PRs and leaves the rest", async () => {
    const { io, closed, permissionLookups, linkedIssueLookups } = makeIo(
      [
        pr(1, "ext-a"),
        pr(2, "maint", "MEMBER"),
        pr(3, "dependabot", "NONE", true),
        pr(4, "ext-b", "CONTRIBUTOR"),
        pr(5, "ext-c"),
        pr(6, "hidden-maint", "CONTRIBUTOR"),
      ],
      {
        4: [
          { repository: REPO, number: 40, state: "OPEN", labels: [GATE_LABEL] },
        ],
        5: [
          { repository: REPO, number: 50, state: "OPEN", labels: ["🐛 Bug"] },
        ],
      },
      { "hidden-maint": "write" },
    );

    const entries = await evaluateAllOpenPrs(io, REPO);

    expect(closed.map((c) => c.number).sort((a, b) => a - b)).toEqual([1, 5]);
    const byNumber = Object.fromEntries(
      entries.map((entry) => [entry.number, entry.result]),
    );
    expect(byNumber[1]?.reason).toBe("no-linked-issue");
    expect(byNumber[2]?.pass).toBe(true);
    expect(byNumber[2]?.reason).toBe("internal");
    expect(byNumber[3]?.reason).toBe("bot");
    expect(byNumber[4]?.pass).toBe(true);
    expect(byNumber[5]?.reason).toBe("missing-label");
    expect(byNumber[6]?.pass).toBe(true);
    expect(byNumber[6]?.reason).toBe("internal");
    expect(closed.find((c) => c.number === 1)?.message).toContain(GATE_LABEL);
    expect(permissionLookups).toEqual([
      "ext-a",
      "ext-b",
      "ext-c",
      "hidden-maint",
    ]);
    expect(linkedIssueLookups).toEqual([1, 4, 5]);
  });

  test("returns an entry per PR and closes none when all conform", async () => {
    const { io, closed } = makeIo([pr(9, "ext")], {
      9: [
        { repository: REPO, number: 90, state: "OPEN", labels: [GATE_LABEL] },
      ],
    });

    const entries = await evaluateAllOpenPrs(io, REPO);

    expect(entries).toHaveLength(1);
    expect(closed).toHaveLength(0);
    expect(entries[0]?.result.pass).toBe(true);
  });
});

describe("fetchAuthorPermission", () => {
  const fetchSpy = spyOn(globalThis, "fetch");
  afterEach(() => {
    fetchSpy.mockReset();
  });
  afterAll(() => {
    fetchSpy.mockRestore();
  });

  function stubFetch(status: number, body: unknown): void {
    fetchSpy.mockImplementation(
      Object.assign(
        () => Promise.resolve(new Response(JSON.stringify(body), { status })),
        { preconnect: () => {} },
      ),
    );
  }

  function getPermission(login = "author") {
    return fetchAuthorPermission("t", "supabase", "pg-toolbelt", login);
  }

  test("returns the effective permission for a collaborator", async () => {
    stubFetch(200, { permission: "admin" });
    expect(await getPermission()).toBe("admin");
  });

  test("maps a 404 (non-collaborator fork author) to undefined", async () => {
    stubFetch(404, { message: "Not Found" });
    expect(await getPermission()).toBeUndefined();
  });

  test("throws on other API failures so the run aborts without closing PRs", async () => {
    stubFetch(403, { message: "Forbidden" });
    return expect(getPermission()).rejects.toThrow(/403/);
  });

  test("throws when a successful response has no permission", async () => {
    stubFetch(200, {});
    return expect(getPermission()).rejects.toThrow(/permission/);
  });

  test("skips the network call for a blank login", async () => {
    stubFetch(200, { permission: "admin" });
    expect(await getPermission("")).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

test("restores fetch after permission tests", () => {
  expect(globalThis.fetch).toBe(originalFetch);
});
