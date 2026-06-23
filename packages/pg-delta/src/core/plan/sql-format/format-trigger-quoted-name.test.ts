import { describe, expect, it } from "bun:test";
import { formatSqlStatements } from "./index.ts";

describe("formatCreateTrigger with quoted (dashed) names", () => {
  // Regression: CLI-1820. A trigger whose name contains characters that force
  // PostgreSQL to double-quote it (e.g. a dash) used to lose its event/table
  // clause ("AFTER INSERT ON public.t1"). The tokenizer emitted no token for
  // the quoted identifier, so the formatter mistook the next keyword for the
  // name and sliced away everything before the first recognized clause.
  it("preserves the event/table clause for a dashed trigger name", () => {
    const sql = `CREATE TRIGGER "new-webhook-with-dashed-name" AFTER INSERT ON public.t1 FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://example.com/x', 'POST', '{}', '{}', '5000')`;

    const [formatted] = formatSqlStatements([sql], { keywordCase: "upper" });

    expect(formatted).toContain("AFTER INSERT ON public.t1");
    expect(formatted).toMatchInlineSnapshot(`
      "CREATE TRIGGER "new-webhook-with-dashed-name"
        AFTER INSERT ON public.t1
        FOR EACH ROW
        EXECUTE FUNCTION
          supabase_functions.http_request('https://example.com/x', 'POST', '{}', '{}', '5000')"
    `);
  });

  it("formats a dashed trigger name the same way as an unquoted one", () => {
    const dashed = `CREATE TRIGGER "send-chat-push" AFTER INSERT ON public.chat_message FOR EACH ROW EXECUTE FUNCTION public.notify()`;
    const plain = `CREATE TRIGGER send_chat_push AFTER INSERT ON public.chat_message FOR EACH ROW EXECUTE FUNCTION public.notify()`;

    const [dashedOut] = formatSqlStatements([dashed], { keywordCase: "upper" });
    const [plainOut] = formatSqlStatements([plain], { keywordCase: "upper" });

    expect(dashedOut.replace('"send-chat-push"', "send_chat_push")).toBe(
      plainOut,
    );
  });
});
