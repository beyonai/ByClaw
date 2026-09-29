import type { SqlSession } from "../../application/database-ports.js";
import type { SchemaManifest, SchemaMarker } from "../../application/schema/types.js";
import { DomainError } from "../../domain/errors.js";
import { canonical, sha256 } from "../../interfaces/contracts/validation.js";

export async function readMarker(
  db: SqlSession,
  enterpriseId: string,
): Promise<SchemaMarker | null> {
  const [row] = await db.query(
    "SELECT obj_description(oid, 'pg_namespace') AS marker FROM pg_namespace WHERE nspname='byai'",
  );
  if (!row?.marker) return null;
  let marker: SchemaMarker;
  try {
    marker = JSON.parse(row.marker);
  } catch {
    throw new DomainError("SCHEMA_MARKER_INVALID");
  }
  if (
    marker.protocolVersion !== 1 ||
    marker.enterpriseId !== enterpriseId ||
    !marker.version ||
    !/^[a-f0-9]{64}$/.test(marker.catalogDigest) ||
    !/^[a-f0-9]{64}$/.test(marker.scriptDigest)
  )
    throw new DomainError("SCHEMA_MARKER_INVALID");
  return marker;
}
export async function catalogDigest(db: SqlSession): Promise<string> {
  const objects =
    await db.query(`SELECT c.relname AS name, c.relkind AS kind, obj_description(c.oid,'pg_class') AS comment
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='byai' ORDER BY c.relname`);
  const columns =
    await db.query(`SELECT c.relname AS table_name,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
    a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_value,col_description(c.oid,a.attnum) AS comment
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='byai' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`);
  const indexes =
    await db.query(`SELECT c.relname AS name,pg_get_indexdef(c.oid) AS definition FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='byai' AND c.relkind IN('i','I') ORDER BY c.relname`);
  const constraints =
    await db.query(`SELECT c.relname AS table_name,k.conname AS name,pg_get_constraintdef(k.oid) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='byai' ORDER BY c.relname,k.conname`);
  const sequences =
    await db.query(`SELECT sequence_name,data_type,start_value,minimum_value,maximum_value,increment,cycle_option
    FROM information_schema.sequences WHERE sequence_schema='byai' ORDER BY sequence_name`);
  return sha256(canonical({ objects, columns, indexes, constraints, sequences }));
}
export async function assertEmpty(db: SqlSession): Promise<boolean> {
  const [row] =
    await db.query(`SELECT (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('byai','public') OR n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))+
    (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('byai','public') OR n.nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS count`);
  return Number(row?.count) === 0;
}
export async function verifyCatalog(db: SqlSession, manifest: SchemaManifest): Promise<void> {
  for (const object of manifest.objects) {
    const kinds =
      object.kind === "table" ? ["r", "p"] : object.kind === "index" ? ["i", "I"] : ["S"];
    const rows = await db.query(
      `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='byai' AND c.relname=$1 AND c.relkind=ANY($2)`,
      [object.name, kinds],
    );
    if (!rows.length) throw new DomainError("SCHEMA_OBJECT_MISSING");
  }
  if ((await catalogDigest(db)) !== manifest.catalogDigest)
    throw new DomainError("SCHEMA_FINGERPRINT_MISMATCH");
}
