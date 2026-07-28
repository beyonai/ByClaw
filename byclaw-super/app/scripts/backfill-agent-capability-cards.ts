import "dotenv/config";
import {
  PiLeaderSessionFactory,
  type AgentCapabilityCompileResult,
} from "@byclaw/by-conductor";
import { PostgresDatabase } from "@byclaw/storage-postgres";
import {
  buildAgentCapabilityBackfillSource,
  type DigitalEmployeeCapabilityRow,
  type RelatedCapabilityResource,
} from "../business/agent-capability-source.js";
import { loadConfig } from "../config/index.js";

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const config = loadConfig();
const database = new PostgresDatabase(config.database);
const sourceSchema = safeIdentifier(
  options.sourceSchema ??
    process.env.BYCLAW_SOURCE_SCHEMA ??
    config.database.schema,
  "BYCLAW_SOURCE_SCHEMA",
);
const sourceDatabase = hasSourceDatabaseOverrides()
  ? new PostgresDatabase({
      ...config.database,
      host: envText("BYCLAW_SOURCE_DB_HOST") ?? config.database.host,
      port: envPositiveInteger("BYCLAW_SOURCE_DB_PORT") ?? config.database.port,
      database:
        envText("BYCLAW_SOURCE_DB_DATABASE") ?? config.database.database,
      user: envText("BYCLAW_SOURCE_DB_USER") ?? config.database.user,
      password:
        process.env.BYCLAW_SOURCE_DB_PASS ?? config.database.password,
      schema: sourceSchema,
      ...(process.env.BYCLAW_SOURCE_DB_SSL
        ? { ssl: envBoolean("BYCLAW_SOURCE_DB_SSL") }
        : {}),
    })
  : database;

try {
  const rows = await loadDigitalEmployees(
    sourceDatabase,
    sourceSchema,
    options,
  );
  if (rows.length === 0) {
    console.log("No digital employees matched the backfill filters.");
    process.exitCode = 0;
  } else {
    const relations = await loadRelatedResources(
      sourceDatabase,
      sourceSchema,
      rows.map((row) => String(row.agent_id)),
    );
    const relationsByAgent = groupRelations(relations);
    const compiler = await PiLeaderSessionFactory.create({
      ...(config.piProvider ? { provider: config.piProvider } : {}),
      ...(config.piModel ? { model: config.piModel } : {}),
      ...(config.openAiBaseUrl
        ? { openAiBaseUrl: config.openAiBaseUrl }
        : {}),
      instanceId: `${config.instanceId}-capability-backfill`,
      ...(config.piSessionCacheDirectory
        ? { sessionCacheDirectory: config.piSessionCacheDirectory }
        : {}),
    });

    let succeeded = 0;
    let failed = 0;
    for (const [index, row] of rows.entries()) {
      const label = `${index + 1}/${rows.length} agentId=${row.agent_id}`;
      try {
        const source = buildAgentCapabilityBackfillSource(
          row,
          relationsByAgent.get(String(row.agent_id)) ?? [],
        );
        console.log(`${label} compiling name=${source.input.agent.name}`);
        const compiled = await compiler.compile(source.input);
        if (options.dryRun) {
          printDryRunResult(source.agentId, source.systemCode, compiled);
        } else {
          await database.capabilityCards.upsert({
            systemCode: source.systemCode,
            agentId: source.agentId,
            ...(source.input.agent.code
              ? { agentCode: source.input.agent.code }
              : {}),
            agentName: source.input.agent.name,
            sourceVersion: source.sourceVersion,
            compiled,
            now: Date.now(),
          });
          console.log(`${label} persisted fingerprint=${compiled.sourceFingerprint}`);
        }
        succeeded += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `${label} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    console.log(
      `Capability card backfill finished: selected=${rows.length} succeeded=${succeeded} failed=${failed} dryRun=${options.dryRun}`,
    );
    if (failed > 0) {
      process.exitCode = 1;
    }
  }
} finally {
  if (sourceDatabase !== database) {
    await sourceDatabase.close();
  }
  await database.close();
}

interface BackfillOptions {
  agentIds: string[];
  dryRun: boolean;
  help: boolean;
  includeInactive: boolean;
  limit: number;
  sourceSchema?: string;
}

function parseArgs(args: string[]): BackfillOptions {
  const agentIds: string[] = [];
  let dryRun = false;
  let help = false;
  let includeInactive = false;
  let limit = 100;
  let sourceSchema: string | undefined;

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--include-inactive") {
      includeInactive = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg.startsWith("--agent-id=")) {
      agentIds.push(
        ...arg
          .slice("--agent-id=".length)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      );
    } else if (arg.startsWith("--limit=")) {
      limit = nonNegativeInteger(arg.slice("--limit=".length), "--limit");
    } else if (arg.startsWith("--source-schema=")) {
      sourceSchema = safeIdentifier(
        arg.slice("--source-schema=".length),
        "--source-schema",
      );
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return {
    agentIds: [...new Set(agentIds)],
    dryRun,
    help,
    includeInactive,
    limit,
    ...(sourceSchema ? { sourceSchema } : {}),
  };
}

async function loadDigitalEmployees(
  database: PostgresDatabase,
  schema: string,
  options: BackfillOptions,
): Promise<DigitalEmployeeCapabilityRow[]> {
  const values: unknown[] = [];
  const filters = ["r.resource_biz_type = 'DIG_EMPLOYEE'"];
  if (!options.includeInactive) {
    filters.push("r.resource_status = 2");
  }
  if (options.agentIds.length > 0) {
    values.push(options.agentIds);
    filters.push(`r.resource_id::text = ANY($${values.length}::text[])`);
  }
  const limitSql =
    options.limit > 0
      ? (() => {
          values.push(options.limit);
          return `LIMIT $${values.length}`;
        })()
      : "";
  const result = await database.pool.query<DigitalEmployeeCapabilityRow>(
    `SELECT
       r.resource_id::text AS agent_id,
       r.system_code,
       r.resource_code,
       r.resource_name,
       r.resource_desc,
       r.tags,
       r.resource_d_verid,
       r.resource_r_verid,
       r.create_time,
       r.update_time,
       e.ability,
       e.constraints,
       e.faqs,
       e.processing_flow,
       e.core_competencies,
       e.core_persona_definition,
       e.skills,
       e.target_content
     FROM ${table(schema, "ss_resource")} r
     INNER JOIN ${table(schema, "ss_res_ext_dig_employee")} e
       ON e.resource_id = r.resource_id
     WHERE ${filters.join("\n       AND ")}
     ORDER BY r.resource_id
     ${limitSql}`,
    values,
  );
  return result.rows;
}

async function loadRelatedResources(
  database: PostgresDatabase,
  schema: string,
  agentIds: string[],
): Promise<RelatedCapabilityResource[]> {
  if (agentIds.length === 0) {
    return [];
  }
  const result = await database.pool.query<RelatedCapabilityResource>(
    `SELECT
       d.resource_id::text AS agent_id,
       related.resource_code,
       related.resource_name,
       related.resource_desc,
       related.resource_biz_type
     FROM ${table(schema, "ss_resource_rel_detail")} d
     INNER JOIN ${table(schema, "ss_resource")} related
       ON related.resource_id = d.rel_resource_id
     WHERE d.resource_id::text = ANY($1::text[])
       AND (d.rel_status = 1 OR d.rel_status IS NULL)
       AND related.resource_status = 2
     ORDER BY d.resource_id, d.create_time, d.resource_rel_detail_id`,
    [agentIds],
  );
  return result.rows;
}

function groupRelations(
  relations: readonly RelatedCapabilityResource[],
): Map<string, RelatedCapabilityResource[]> {
  const grouped = new Map<string, RelatedCapabilityResource[]>();
  for (const relation of relations) {
    const agentId = String(relation.agent_id);
    const current = grouped.get(agentId) ?? [];
    current.push(relation);
    grouped.set(agentId, current);
  }
  return grouped;
}

function printDryRunResult(
  agentId: string,
  systemCode: string,
  compiled: AgentCapabilityCompileResult,
): void {
  console.log(
    JSON.stringify(
      {
        systemCode,
        agentId,
        ...compiled,
      },
      null,
      2,
    ),
  );
}

function printHelp(): void {
  console.log(`Usage: pnpm capability:backfill -- [options]

Options:
  --agent-id=ID[,ID]       Only process selected digital employees; repeatable
  --limit=N                Maximum rows to process; default 100, 0 means all
  --source-schema=NAME     Schema containing ss_resource tables; defaults to
                           BYCLAW_SOURCE_SCHEMA or DB_SCHEMA
  --include-inactive       Include resource_status values other than 2
  --dry-run                Compile and print cards without writing the card table
  --help, -h               Show this help
`);
}

function safeIdentifier(value: string, name: string): string {
  const normalized = value.trim();
  if (!/^[a-z_][a-z0-9_]*$/i.test(normalized)) {
    throw new Error(`${name} must be a PostgreSQL identifier`);
  }
  return normalized;
}

function table(schema: string, name: string): string {
  return `"${schema}"."${name}"`;
}

function nonNegativeInteger(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function hasSourceDatabaseOverrides(): boolean {
  return [
    "BYCLAW_SOURCE_DB_HOST",
    "BYCLAW_SOURCE_DB_PORT",
    "BYCLAW_SOURCE_DB_DATABASE",
    "BYCLAW_SOURCE_DB_USER",
    "BYCLAW_SOURCE_DB_PASS",
    "BYCLAW_SOURCE_DB_SSL",
  ].some((name) => process.env[name] !== undefined);
}

function envText(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function envPositiveInteger(name: string): number | undefined {
  const raw = envText(name);
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function envBoolean(name: string): boolean {
  const value = envText(name)?.toLowerCase();
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  throw new Error(`${name} must be true, false, 1 or 0`);
}
