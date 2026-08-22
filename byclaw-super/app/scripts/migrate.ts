import "dotenv/config";
import {
  LATEST_POSTGRES_SCHEMA_VERSION,
  PostgresDatabase,
} from "@byclaw/storage-postgres";
import { booleanValue, integer, requiredEnv } from "../config/env-parsers.js";

const env = process.env;
const database = new PostgresDatabase({
  host: requiredEnv(env, "DB_HOST"),
  port: integer(requiredEnv(env, "DB_PORT"), "DB_PORT", 1, 65_535),
  database: requiredEnv(env, "DB_DATABASE"),
  schema: requiredEnv(env, "DB_SCHEMA"),
  user: requiredEnv(env, "DB_USER"),
  password: requiredEnv(env, "DB_PASS"),
  ssl: booleanValue(requiredEnv(env, "DB_SSL"), "DB_SSL"),
});

try {
  await database.migrate();
  console.log(
    `PostgreSQL schema ${database.schema} migrated to version ${LATEST_POSTGRES_SCHEMA_VERSION}`,
  );
} finally {
  await database.close();
}
