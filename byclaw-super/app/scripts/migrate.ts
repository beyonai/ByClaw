import "dotenv/config";
import { PostgresDatabase } from "@byclaw/storage-postgres";

const database = new PostgresDatabase({
  host: required("DB_HOST"),
  port: integer("DB_PORT"),
  database: required("DB_DATABASE"),
  schema: required("DB_SCHEMA"),
  user: required("DB_USER"),
  password: required("DB_PASS"),
  ssl: booleanValue("DB_SSL"),
});

try {
  await database.migrate();
  const status = await database.health();
  if (!status.healthy) {
    throw new Error(status.message ?? "PostgreSQL schema is not ready");
  }
  console.log(
    `PostgreSQL schema ${database.schema} is at version ${status.currentVersion}`,
  );
} finally {
  await database.close();
}

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function integer(name: string): number {
  const raw = required(name);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function booleanValue(name: string): boolean {
  const value = required(name).toLowerCase();
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  throw new Error(`${name} must be true, false, 1 or 0`);
}
