/** Strip comments and string literals so keyword scans ignore quoted SQL. */
export const maskSql = (sql: string): string => {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const next = sql.slice(i);
    if (next.startsWith("--")) {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    if (next.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (sql[i] === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      out += " ";
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
};
