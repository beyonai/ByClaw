import type { SqlSession } from "../../application/database-ports.js";
import { requireId } from "../../domain/values.js";

/** Acquire before any group lock; the keys are shared with ordinary lifecycle/message commands. */
export async function lockSessions(db: SqlSession, ids: string[]): Promise<void> {
  const ordered = [...new Set(ids.map(requireId))].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
  );
  for (const id of ordered)
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`session:${id}`]);
}
