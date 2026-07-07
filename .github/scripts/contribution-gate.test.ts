import { describe, expect, test } from "bun:test";
import { evaluateGate, GATE_LABEL } from "./contribution-gate.ts";

const REPO = "supabase/pg-toolbelt";

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
