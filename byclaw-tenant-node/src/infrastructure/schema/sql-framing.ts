import { DomainError } from "../../domain/errors.js";

/** 按 SQL 词法状态分句，忽略字符串、美元引号与嵌套注释内的分号。 */
export function frameSql(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote = "";
  let dollar = "";
  let block = 0;
  let line = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i],
      n = sql[i + 1];
    if (line) {
      if (c === "\n") line = false;
      continue;
    }
    if (block) {
      if (c === "/" && n === "*") {
        block++;
        i++;
      } else if (c === "*" && n === "/") {
        block--;
        i++;
      }
      continue;
    }
    if (dollar) {
      if (sql.startsWith(dollar, i)) {
        i += dollar.length - 1;
        dollar = "";
      }
      continue;
    }
    if (quote) {
      if (c === quote) {
        if (n === quote) i++;
        else quote = "";
      } else if (c === "\\" && quote === "'") i++;
      continue;
    }
    if (c === "-" && n === "-") {
      line = true;
      i++;
    } else if (c === "/" && n === "*") {
      block = 1;
      i++;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "$") {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        dollar = tag[0];
        i += dollar.length - 1;
      }
    } else if (c === ";") {
      statements.push(sql.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (quote || dollar || block) throw new DomainError("INVALID_SQL_SYNTAX");
  if (sql.slice(start).trim()) statements.push(sql.slice(start));
  return statements;
}
