import { describe, expect, test } from "bun:test";

const CLI = new URL("./main.ts", import.meta.url).pathname;

describe("schema help", () => {
  test("lists the schema apply debugging flags", async () => {
    const proc = Bun.spawn(["bun", CLI, "schema", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect({ exitCode, stderr }).toMatchObject({ exitCode: 0, stderr: "" });
    expect(stdout).toContain("--dry-run");
    expect(stdout).toContain("--verbose");
    expect(stdout).toContain("--out-plan");
  });
});
