import type { SqlRow, SqlSession } from "../../application/database-ports.js";
export const camel = (row: SqlRow): SqlRow =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
export async function first(
  db: SqlSession,
  sql: string,
  args: unknown[] = [],
): Promise<SqlRow | null> {
  const [row] = await db.query(sql, args);
  return row ? camel(row) : null;
}
export async function insert(
  db: SqlSession,
  table: string,
  values: Record<string, unknown>,
): Promise<void> {
  const entries = Object.entries(values);
  await db.query(
    `INSERT INTO byai.${table} (${entries.map(([key]) => key).join(",")}) VALUES (${entries.map((_entry, index) => `$${index + 1}`).join(",")})`,
    entries.map(([, value]) => value),
  );
}
export async function nextId(db: SqlSession): Promise<string> {
  const [row] = await db.query("SELECT nextval('byai.seq_any_table')::text AS id");
  return row!.id;
}
