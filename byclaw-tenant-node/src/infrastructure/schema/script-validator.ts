import { parse } from "pgsql-ast-parser";
import { DomainError } from "../../domain/errors.js";
import type { SchemaObject } from "../../application/schema/types.js";
import { frameSql } from "./sql-framing.js";

const allowed = new Set([
  "create schema",
  "create table",
  "create index",
  "create sequence",
  "alter table",
  "alter sequence",
  "drop table",
  "drop index",
  "drop sequence",
  "comment",
]);
export function validateScript(
  sql: string,
  objects: SchemaObject[],
  operation: "INIT" | "UPDATE",
): string[] {
  if (!sql.trim() || Buffer.byteLength(sql) > 8 * 1024 * 1024 || sql.includes("\0"))
    throw new DomainError("INVALID_SQL");
  const names = new Set(objects.map((object) => object.name));
  const statements = frameSql(sql).filter((text) => parseStatement(text, names, operation));
  if (!statements.length) throw new DomainError("INVALID_SQL");
  return statements;
}
function parseStatement(sql: string, names: Set<string>, operation: string): boolean {
  let ast;
  try {
    ast = parse(sql);
  } catch {
    throw new DomainError("INVALID_SQL_SYNTAX");
  }
  if (!ast.length) return false;
  const statement = ast[0] as any;
  if (
    ast.length !== 1 ||
    !allowed.has(statement.type) ||
    (operation === "UPDATE" && statement.type.startsWith("drop"))
  )
    throw new DomainError("INVALID_SQL_STATEMENT");
  if (statement.type === "create schema") {
    if (statement.name.name !== "byai") throw new DomainError("INVALID_SQL_SCHEMA");
    return true;
  }
  if (statement.type === "alter table") {
    for (const change of statement.changes) {
      if (["owner", "set schema"].includes(change.type))
        throw new DomainError("INVALID_SQL_STATEMENT");
      if (change.type === "rename") checkObject(change.to, names);
    }
  }
  if (statement.change?.ownedBy && statement.change.ownedBy !== "none")
    checkObject(
      { schema: statement.change.ownedBy.schema, name: statement.change.ownedBy.table },
      names,
    );
  if (statement.on?.type === "schema") throw new DomainError("SCHEMA_MARKER_RESERVED");
  const target = statement.table ?? statement.name ?? statement.names?.[0] ?? statement.on?.name;
  if (target) checkObject(target, names);
  if (statement.on?.column)
    checkObject({ name: statement.on.column.table, schema: statement.on.column.schema }, names);
  if (statement.indexName) checkObject(statement.indexName, names);
  if (statement.names) statement.names.forEach((name: any) => checkObject(name, names));
  visit(statement, names);
  return true;
}
function checkObject(object: { schema?: string; name: string }, names: Set<string>): void {
  if ((object.schema && object.schema !== "byai") || !names.has(object.name))
    throw new DomainError("INVALID_SQL_OBJECT");
}
function visit(value: any, names: Set<string>): void {
  if (!value || typeof value !== "object") return;
  if (value.schema && value.schema !== "byai") throw new DomainError("INVALID_SQL_SCHEMA");
  if (value.foreignTable) checkObject(value.foreignTable, names);
  if (value.type === "call") {
    const name = value.function?.name?.toLowerCase();
    if (!["nextval", "now", "current_timestamp"].includes(name))
      throw new DomainError("INVALID_SQL_FUNCTION");
    if (name === "nextval")
      for (const argument of value.args ?? []) {
        const literal = argument.type === "cast" ? argument.operand : argument;
        if (
          literal.type !== "string" ||
          !/^(?:byai\.)?[A-Za-z_][A-Za-z0-9_]*$/.test(literal.value) ||
          !names.has(literal.value.replace(/^byai\./, ""))
        )
          throw new DomainError("INVALID_SQL_SEQUENCE");
      }
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach((item) => visit(item, names));
    else visit(child, names);
  }
}
