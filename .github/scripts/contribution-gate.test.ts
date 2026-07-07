import { describe, expect, test } from "bun:test";
import { evaluateGate, GATE_LABEL } from "./contribution-gate.ts";

describe("evaluateGate", () => {
  test("skips bot authors", () => {
    const result = evaluateGate({
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
      authorAssociation: "CONTRIBUTOR",
      isBot: false,
      linkedIssues: [{ number: 12, state: "OPEN", labels: ["🐛 Bug"] }],
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("missing-label");
    expect(result.message).toContain(GATE_LABEL);
  });

  test("fails when the only labeled issue is closed", () => {
    const result = evaluateGate({
      authorAssociation: "NONE",
      isBot: false,
      linkedIssues: [{ number: 7, state: "CLOSED", labels: [GATE_LABEL] }],
    });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("issue-closed");
  });

  test("passes when a linked issue is open and carries the gate label", () => {
    const result = evaluateGate({
      authorAssociation: "NONE",
      isBot: false,
      linkedIssues: [
        { number: 42, state: "OPEN", labels: [GATE_LABEL, "🐛 Bug"] },
      ],
    });
    expect(result.pass).toBe(true);
    expect(result.reason).toBe("ok");
  });

  test("passes when any one of several linked issues qualifies", () => {
    const result = evaluateGate({
      authorAssociation: "FIRST_TIME_CONTRIBUTOR",
      isBot: false,
      linkedIssues: [
        { number: 1, state: "CLOSED", labels: [GATE_LABEL] },
        { number: 2, state: "OPEN", labels: ["✨ Feature"] },
        { number: 3, state: "OPEN", labels: [GATE_LABEL] },
      ],
    });
    expect(result.pass).toBe(true);
    expect(result.reason).toBe("ok");
  });
});
