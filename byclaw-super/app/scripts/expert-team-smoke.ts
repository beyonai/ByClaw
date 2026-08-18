import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
  GatewayClient,
  QueueNames,
  WorkerRegistry,
  createRedis,
} from "@byclaw/by-framework";
import { createBeyondTokenVerifier } from "../auth/beyond-token.js";
import { loadConfig } from "../config/index.js";
import {
  postByClawBeJson,
  type FetchLike,
} from "../business/byclaw-be-http.js";

const config = loadConfig();
const beyondToken = requiredEnv("BEYOND_TOKEN");
const expertTeamId = requiredEnv("EXPERT_TEAM_ID");
const systemCode = optionalEnv("SYSTEM_CODE");
const message =
  optionalEnv("SMOKE_MESSAGE") ??
  "请根据团队成员分工，简要说明你会如何处理一次跨专业任务。";
const timeoutMs = positiveInteger(
  process.env.SMOKE_TIMEOUT_MS,
  10 * 60 * 1_000,
  "SMOKE_TIMEOUT_MS",
);
const sessionId =
  optionalEnv("SMOKE_SESSION_ID") ??
  `expert-team-smoke-${Date.now()}-${randomUUID().slice(0, 8)}`;

const verifyToken = createBeyondTokenVerifier(config.auth);
const claims = await verifyToken({
  token: beyondToken,
  ...(systemCode ? { systemCode } : {}),
});

process.stdout.write(
  `[1/3] Resolving expert-team runtime from ByClaw BE: team=${expertTeamId}\n`,
);
const runtime = await resolveRuntime();
const runtimeRecord = requiredRecord(runtime, "runtime");
const agents = requiredArray(runtimeRecord.agents, "runtime.agents");
if (agents.length === 0) {
  throw new Error("runtime.agents must contain at least one active member");
}
const orchestrator = requiredRecord(
  runtimeRecord.orchestrator,
  "runtime.orchestrator",
);
process.stdout.write(
  `[1/3] Runtime OK: name=${String(orchestrator.name ?? "")}, agents=${agents.length}, configVersion=${String(runtimeRecord.configVersion ?? "")}\n`,
);

const redis = createRedis(config.redis);
try {
  const registry = new WorkerRegistry(redis);
  const targetAgentType = config.worker.agentType;
  const worker = await registry.getTargetWorker(targetAgentType);
  if (!worker) {
    throw new Error(
      `No online by-framework worker found for ${targetAgentType}. Start byclaw-super with BYCLAW_WORKER_ENABLED=true.`,
    );
  }
  process.stdout.write(
    `[2/3] BY_SUPER worker online: worker=${worker}\n`,
  );

  const gateway = new GatewayClient(registry, redis);
  const response = await gateway.sendMessage({
    sourceAgentType: "BYCLAW_BE_EXPERT_TEAM_SMOKE",
    targetAgentType,
    sessionId,
    content: message,
    userCode: claims.userCode,
    requireOnlineWorker: true,
    extraPayload: {
      agent_id: expertTeamId,
      agent_name: String(orchestrator.name ?? "专家团"),
      agent_type: "017",
      agent_list: [],
      orchestrator: {
        schemaVersion: "byclaw.orchestrator-ref/v1",
        kind: "EXPERT_TEAM",
        id: expertTeamId,
      },
    },
    metadata: {
      "Beyond-Token": beyondToken,
      ...(systemCode ? { "System-Code": systemCode } : {}),
    },
  });
  if (!response.success) {
    throw new Error(
      `by-framework dispatch failed: ${response.error_code ?? "UNKNOWN"} ${response.error ?? response.status}`,
    );
  }
  process.stdout.write(
    `[2/3] Dispatched: session=${sessionId}, trace=${response.trace_id}, worker=${response.target_worker_id}\n`,
  );
  process.stdout.write("[3/3] Streaming BY_SUPER events...\n");

  await streamUntilTerminal(redis, {
    sessionId,
    traceId: response.trace_id,
    timeoutMs,
  });
} finally {
  await redis.quit();
}

async function resolveRuntime(): Promise<unknown> {
  return postByClawBeJson({
    fetchImpl: globalThis.fetch as FetchLike,
    fallbackBaseUrl: new URL(config.byClawBe.baseUrl),
    timeoutMs: config.byClawBe.timeoutMs,
    path: "/byaiService/internal/v1/orchestrators/resolve-runtime",
    beyondToken,
    ...(systemCode ? { systemCode } : {}),
    body: {
      schemaVersion: "byclaw.orchestrator-runtime-request/v1",
      kind: "EXPERT_TEAM",
      orchestratorId: expertTeamId,
    },
    label: "expert-team smoke runtime",
    toError: (errorMessage, statusCode) =>
      new Error(
        `${errorMessage}${statusCode === undefined ? "" : ` (HTTP ${statusCode})`}`,
      ),
  });
}

async function streamUntilTerminal(
  redis: ReturnType<typeof createRedis>,
  input: { sessionId: string; traceId: string; timeoutMs: number },
): Promise<void> {
  const stream = QueueNames.session_data_stream(input.sessionId);
  const deadline = Date.now() + input.timeoutMs;
  let cursor = "0-0";
  let received = false;

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    const rows = await redis.xread(
      "COUNT",
      50,
      "BLOCK",
      Math.min(5_000, Math.max(1, remainingMs)),
      "STREAMS",
      stream,
      cursor,
    );
    for (const entry of parseStreamRows(rows)) {
      cursor = entry.id;
      const event = parseJsonRecord(entry.data);
      if (!event || String(event.trace_id ?? "") !== input.traceId) {
        continue;
      }
      received = true;
      const eventType = String(event.event_type ?? "unknown");
      const text = extractDeltaText(event.data);
      process.stdout.write(
        `${eventType}${text ? `: ${text}` : ""}\n`,
      );
      if (eventType === "error") {
        throw new Error(`BY_SUPER returned error: ${extractError(event)}`);
      }
      if (eventType === "appStreamResponse") {
        process.stdout.write(
          `[3/3] Expert-team smoke completed successfully: session=${input.sessionId}\n`,
        );
        return;
      }
    }
  }
  throw new Error(
    `Timed out after ${input.timeoutMs}ms waiting for BY_SUPER${received ? " terminal event" : " events"}`,
  );
}

function parseStreamRows(value: unknown): Array<{ id: string; data: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: Array<{ id: string; data: string }> = [];
  for (const streamRow of value) {
    if (!Array.isArray(streamRow) || !Array.isArray(streamRow[1])) {
      continue;
    }
    for (const entry of streamRow[1]) {
      if (!Array.isArray(entry) || !Array.isArray(entry[1])) {
        continue;
      }
      const fields = entry[1];
      for (let index = 0; index < fields.length - 1; index += 2) {
        if (fields[index] === "data" && typeof fields[index + 1] === "string") {
          result.push({ id: String(entry[0]), data: fields[index + 1] });
          break;
        }
      }
    }
  }
  return result;
}

function extractDeltaText(value: unknown): string {
  const data = requiredRecordOrUndefined(value);
  const choices = Array.isArray(data?.choices) ? data.choices : [];
  const first = requiredRecordOrUndefined(choices[0]);
  const delta = requiredRecordOrUndefined(first?.delta);
  return typeof delta?.content === "string" ? delta.content : "";
}

function extractError(event: Record<string, unknown>): string {
  const metadata = requiredRecordOrUndefined(event.metadata);
  const data = requiredRecordOrUndefined(event.data);
  return String(
    metadata?.error ?? data?.message ?? event.state_msg ?? "unknown error",
  );
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    return requiredRecordOrUndefined(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function requiredRecord(
  value: unknown,
  name: string,
): Record<string, unknown> {
  const record = requiredRecordOrUndefined(value);
  if (!record) {
    throw new Error(`${name} must be an object`);
  }
  return record;
}

function requiredRecordOrUndefined(
  value: unknown,
): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requiredArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
  return value;
}

function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (!value?.trim()) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
