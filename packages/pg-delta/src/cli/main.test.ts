import { describe, expect, test } from "bun:test";

const CLI = new URL("./main.ts", import.meta.url).pathname;

async function runHelp(...args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("schema help", () => {
  test("lists the schema apply debugging flags", async () => {
    const { stdout, stderr, exitCode } = await runHelp("schema", "--help");

    expect({ exitCode, stderr }).toMatchObject({ exitCode: 0, stderr: "" });
    expect(stdout).toContain("--dry-run");
    expect(stdout).toContain("--verbose");
    expect(stdout).toContain("--out-plan");
  });

  test("lists schema export create-extension-if-not-exists", async () => {
    const { stdout, stderr, exitCode } = await runHelp("schema", "--help");

    expect({ exitCode, stderr }).toMatchObject({ exitCode: 0, stderr: "" });
    expect(stdout).toContain("--create-extension-if-not-exists");
  });
});

describe("top-level help", () => {
  test("qualifies how to execute a dry-run script", async () => {
    const { stdout, stderr, exitCode } = await runHelp("--help");

    expect({ exitCode, stderr }).toMatchObject({ exitCode: 0, stderr: "" });
    expect(stdout).toContain("statement by statement on one session");
    expect(stdout).toMatch(/Do\s+not submit it as one multi-statement request/);
    expect(stdout).toContain("psql -X -v ON_ERROR_STOP=1 -f apply.sql");
    expect(stdout).toContain("secure libpq configuration");
    expect(stdout).not.toContain('"$DATABASE_URL"');
  });
});
