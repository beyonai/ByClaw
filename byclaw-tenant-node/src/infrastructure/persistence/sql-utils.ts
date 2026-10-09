import type { SqlRow, SqlSession } from "../../application/database-ports.js";
import { DomainError } from "../../domain/errors.js";
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
/** Reserve a disjoint signed-BIGINT range per tenant while retaining the local DB sequence counter. */
export async function nextId(db: SqlSession, enterpriseId: string): Promise<string> {
  if (!/^[1-9]\d*$/.test(enterpriseId)) throw new DomainError("INVALID_TENANT_ID");
  const tenant = BigInt(enterpriseId);
  if (tenant >= 1_000_000_000n) throw new DomainError("TENANT_ID_RANGE_EXHAUSTED");
  const [row] = await db.query("SELECT nextval('byai.seq_any_table')::text AS id");
  const sequence = BigInt(row!.id);
  if (sequence < 1n || sequence >= 1_000_000_000n)
    throw new DomainError("TENANT_SEQUENCE_EXHAUSTED");
  return (8_000_000_000_000_000_000n + tenant * 1_000_000_000n + sequence).toString();
}
