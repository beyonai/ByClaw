#!/usr/bin/env node
/**
 * Simulate byai-channel SDK inbound (Redis AskAgentCommand), equivalent to
 * frontend LLM_MESSAGE -> Java GatewayClient -> BYCLAW_EXE_{USER_CODE} worker.
 *
 * Usage:
 *   USER_CODE=0027024710 REDIS_HOST=... node scripts/send-inbound-message.mjs \
 *     --content "你是什么模型？你有哪些agent？" --main
 *
 *   # Or route to a specific digital employee (agentId 10002171):
 *   node scripts/send-inbound-message.mjs --agent-id 10002171 --content "你好"
 *
 * Env: REDIS_HOST/REDIS_PORT or REDIS_CLUSTER_HOST, REDIS_USERNAME,
 * REDIS_PASSWORD, REDIS_DATABASE, USER_CODE. Spring-style keys such as
 * spring.data.redis.cluster.nodes and spring.data.redis.password are also read.
 */
import crypto from "node:crypto";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frameworkEntry = path.join(scriptDir, "../node_modules/@byclaw/by-framework/dist/index.js");

function parseArgs(argv) {
  const opts = {
    content: "你是什么模型？你有哪些agent？",
    sessionId: "",
    agentId: null,
    agentCode: null,
    language: "zh-CN",
    clientRequestId: `${Date.now()}`,
    waitMs: 120_000,
    poll: true,
    requireOnlineWorker: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--content") {
      opts.content = argv[++i] ?? opts.content;
    } else if (arg === "--session-id") {
      opts.sessionId = argv[++i] ?? "";
    } else if (arg === "--agent-id") {
      opts.agentId = argv[++i] ?? null;
    } else if (arg === "--agent-code") {
      opts.agentCode = argv[++i] ?? null;
    } else if (arg === "--main") {
      opts.agentId = null;
      opts.agentCode = null;
    } else if (arg === "--language") {
      opts.language = argv[++i] ?? opts.language;
    } else if (arg === "--client-request-id") {
      opts.clientRequestId = argv[++i] ?? opts.clientRequestId;
    } else if (arg === "--wait-ms") {
      opts.waitMs = Number(argv[++i] ?? opts.waitMs);
    } else if (arg === "--no-poll") {
      opts.poll = false;
    } else if (arg === "--require-online-worker") {
      opts.requireOnlineWorker = true;
    } else if (arg === "--no-require-online-worker") {
      opts.requireOnlineWorker = false;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/send-inbound-message.mjs [options]

Options:
  --content <text>           Chat text (default: sample question)
  --session-id <id>          Session id (default: random uuid)
  --main                     Route to main agent (clear agent-id)
  --agent-id <id>            Target digital employee id, e.g. 10002171
  --agent-code <code>        Target agent code override
  --language <locale>        Metadata language (default: zh-CN)
  --client-request-id <id>   Client request id for ext_params
  --wait-ms <n>              Poll session stream timeout (default: 120000)
  --no-poll                  Send only, do not poll session stream
  --no-require-online-worker Allow send when worker offline (queue mode)
`);
      process.exit(0);
    }
  }
  if (!opts.sessionId) {
    opts.sessionId = crypto.randomUUID();
  }
  return opts;
}

function readRedisInfo() {
  applyRedisEnvAliases();
  const clusterRaw =
    envString("REDIS_CLUSTER_HOST") ||
    envString("REDIS_CLUSTER_NODES") ||
    envString("spring.data.redis.cluster.nodes") ||
    envString("spring.redis.cluster.nodes");
  const clusterNodes = parseClusterNodes(clusterRaw);
  const mode = envString("REDIS_MODE") || (clusterNodes.length > 0 ? "cluster" : "standalone");
  const keySchemaVersion = envString("REDIS_KEY_SCHEMA_VERSION") || (mode === "cluster" ? "v2" : "v1");
  if (mode === "cluster" && keySchemaVersion !== "v2") {
    throw new Error("Redis Cluster requires REDIS_KEY_SCHEMA_VERSION=v2");
  }
  if (mode === "cluster") {
    if (clusterNodes.length === 0) {
      throw new Error("REDIS_CLUSTER_HOST or spring.data.redis.cluster.nodes is required");
    }
    return {
      mode,
      clusterNodes,
      keySchemaVersion,
      username: envString("REDIS_USERNAME") || undefined,
      password: envString("REDIS_PASSWORD") || undefined,
    };
  }
  const host = envString("REDIS_HOST");
  const port = envString("REDIS_PORT");
  if (!host || !port) {
    throw new Error("REDIS_HOST and REDIS_PORT are required for standalone Redis");
  }
  return {
    mode: "standalone",
    keySchemaVersion,
    clusterNodes: [],
    host,
    port: Number.parseInt(port, 10),
    username: envString("REDIS_USERNAME") || undefined,
    password: envString("REDIS_PASSWORD") || undefined,
    db: Number.parseInt(envString("REDIS_DATABASE") || envString("REDIS_DB") || "0", 10),
  };
}

function envString(name) {
  return typeof process.env[name] === "string" ? process.env[name].trim() : "";
}

function applyRedisEnvAliases() {
  const springClusterNodes =
    envString("spring.data.redis.cluster.nodes") || envString("spring.redis.cluster.nodes");
  if (!process.env.REDIS_CLUSTER_HOST && springClusterNodes) {
    process.env.REDIS_CLUSTER_HOST = springClusterNodes;
  }
  const aliases = [
    ["REDIS_HOST", ["spring.data.redis.host", "spring.redis.host"]],
    ["REDIS_PORT", ["spring.data.redis.port", "spring.redis.port"]],
    ["REDIS_USERNAME", ["spring.data.redis.username", "spring.redis.username"]],
    ["REDIS_PASSWORD", ["spring.data.redis.password", "spring.redis.password"]],
    ["REDIS_DATABASE", ["spring.data.redis.database", "spring.redis.database", "REDIS_DB"]],
  ];
  for (const [target, sources] of aliases) {
    if (process.env[target]) continue;
    const value = sources.map(envString).find(Boolean);
    if (value) process.env[target] = value;
  }
  if (!process.env.REDIS_DB && process.env.REDIS_DATABASE) {
    process.env.REDIS_DB = process.env.REDIS_DATABASE;
  }
  if ((process.env.REDIS_CLUSTER_HOST || process.env.REDIS_CLUSTER_NODES) && !process.env.REDIS_KEY_SCHEMA_VERSION) {
    process.env.REDIS_KEY_SCHEMA_VERSION = "v2";
  }
}

function parseClusterNodes(raw) {
  return String(raw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const idx = item.lastIndexOf(":");
      if (idx <= 0) return null;
      const host = item.slice(0, idx).trim();
      const port = Number.parseInt(item.slice(idx + 1).trim(), 10);
      return host && Number.isFinite(port) ? { host, port } : null;
    })
    .filter(Boolean);
}

function v2(config) {
  return config.keySchemaVersion === "v2";
}

function versioned(config, v1, v2Suffix) {
  return v2(config) ? `byai_gateway:v2:${v2Suffix}` : v1;
}

function patchFrameworkRedisKeys(framework, config) {
  if (!v2(config)) return;
  const { QueueNames, RegistryKeys } = framework;
  if (QueueNames) {
    QueueNames.ctrl_stream = (agentType) =>
      versioned(config, `byai_gateway:ctrl:agent_type:${agentType}`, `ctrl:agent_type:${agentType}`);
    QueueNames.worker_ctrl_stream = (workerId) =>
      versioned(config, `byai_gateway:ctrl:worker:${workerId}`, `ctrl:worker:{${workerId}}`);
    QueueNames.session_data_stream = (sessionId) =>
      versioned(config, `byai_gateway:session:${sessionId}:data_stream`, `session:{${sessionId}}:data_stream`);
    QueueNames.task_group = (groupId) =>
      versioned(config, `byai_gateway:task_group:${groupId}`, `task_group:{${groupId}}`);
    QueueNames.task_group_results = (groupId) =>
      versioned(config, `byai_gateway:task_group:${groupId}:results`, `task_group:{${groupId}}:results`);
  }
  if (RegistryKeys) {
    RegistryKeys.KNOWN_WORKERS = versioned(config, "byai_gateway:registry:workers", "registry:workers");
    RegistryKeys.SD_SERVICES = versioned(config, "byai_gateway:sd:services", "sd:services");
    RegistryKeys.WORKER_DEFAULT_LEASE_TTL_SECONDS = 30;
    RegistryKeys.worker_online_lease = (workerId) =>
      versioned(config, `byai_gateway:registry:worker:online:${workerId}`, `registry:worker:{${workerId}}:online`);
    RegistryKeys.workerDeclaredAgentTypes = (workerId) =>
      versioned(config, `byai_gateway:registry:worker:agent_types:${workerId}`, `registry:worker:{${workerId}}:agent_types`);
    RegistryKeys.agentTypeMembers = (agentType) =>
      versioned(config, `byai_gateway:registry:agent_type:workers:${agentType}`, `registry:agent_type:{${agentType}}:workers`);
    RegistryKeys.worker_lock = (workerId) =>
      versioned(config, `byai_gateway:registry:worker:lock:${workerId}`, `registry:worker:{${workerId}}:lock`);
    RegistryKeys.session_registry = (sessionId) =>
      versioned(config, `byai_gateway:session:${sessionId}:registry`, `session:{${sessionId}}:registry`);
  }
}

async function createRedisConnection(config) {
  if (config.mode === "cluster") {
    const Redis = (await import("ioredis")).default;
    return new Redis.Cluster(config.clusterNodes, {
      redisOptions: {
        username: config.username,
        password: config.password,
      },
      scaleReads: "master",
    });
  }
  const { createRedis } = await importFramework();
  return createRedis(config);
}

function buildLlmMessagePayload(opts) {
  return {
    type: "LLM_MESSAGE",
    clientRequestId: opts.clientRequestId,
    language: opts.language,
    chatContent: opts.content,
    relModelId: -1,
    accessTerminal: "Web",
    sessionId: opts.sessionId,
    chatId: opts.sessionId,
    resourceList: [],
    extParams: { files: [], clientId: opts.clientRequestId },
    deepThink: false,
    enterpriseInformation: false,
    connectNet: false,
    files: [],
    mode: "basic",
    agentType: "001",
    agentId: opts.agentId,
    dataCloud: {},
    functionCloud: {},
    memory: {},
    agentCode: opts.agentCode,
  };
}

function buildExtraPayload(llmPayload) {
  const extra = {
    ext_params: llmPayload.extParams ?? {},
    resource_list: llmPayload.resourceList ?? [],
  };
  if (llmPayload.agentId != null && llmPayload.agentId !== "") {
    extra.agent_id = String(llmPayload.agentId);
  }
  if (llmPayload.agentCode) {
    extra.agent_code = llmPayload.agentCode;
  }
  return extra;
}

async function pollSessionStream(redis, sessionId, timeoutMs) {
  const { QueueNames } = await importFramework();
  const stream = QueueNames.session_data_stream(sessionId);
  let lastId = "0-0";
  const deadline = Date.now() + timeoutMs;
  const chunks = [];

  while (Date.now() < deadline) {
    const rows = await redis.xread("BLOCK", 2000, "STREAMS", stream, lastId);
    if (!rows) {
      continue;
    }
    for (const [, messages] of rows) {
      for (const [id, fields] of messages) {
        lastId = id;
        const record = Object.fromEntries(
          fields.reduce((acc, cur, idx, arr) => {
            if (idx % 2 === 0) {
              acc.push([cur, arr[idx + 1]]);
            }
            return acc;
          }, []),
        );
        const payloadRaw = record.payload ?? record.data ?? record.message;
        if (payloadRaw) {
          try {
            const payload = JSON.parse(payloadRaw);
            chunks.push(payload);
            const eventType = payload?.eventType ?? payload?.event_type;
            if (
              eventType === "APP_STREAM_RESPONSE" ||
              eventType === "appStreamResponse" ||
              eventType === "error"
            ) {
              return { chunks, done: true, eventType };
            }
          } catch {
            chunks.push({ raw: payloadRaw });
          }
        }
      }
    }
  }
  return { chunks, done: false, eventType: "timeout" };
}

async function importFramework() {
  return import(pathToFileURL(frameworkEntry).href);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const userCode = process.env.USER_CODE?.trim();
  if (!userCode) {
    throw new Error("USER_CODE is required (e.g. 0027024710)");
  }

  const llmPayload = buildLlmMessagePayload(opts);
  const extraPayload = buildExtraPayload(llmPayload);
  const targetAgentType = `BYCLAW_EXE_${userCode}`;
  const traceId = crypto.randomBytes(16).toString("hex");

  const framework = await importFramework();
  const { GatewayClient, WorkerRegistry } = framework;
  const redisInfo = readRedisInfo();
  patchFrameworkRedisKeys(framework, redisInfo);
  const redis = await createRedisConnection(redisInfo);
  const registry = new WorkerRegistry(redis);
  const client = new GatewayClient(registry, redis);

  console.log("[send-inbound] LLM_MESSAGE payload:");
  console.log(JSON.stringify(llmPayload, null, 2));
  console.log(`[send-inbound] targetAgentType=${targetAgentType} sessionId=${opts.sessionId} traceId=${traceId}`);

  const res = await client.sendMessage({
    targetAgentType,
    sessionId: opts.sessionId,
    content: opts.content,
    traceId,
    userCode,
    extraPayload,
    metadata: {
      language: opts.language,
      user_code: userCode,
    },
    requireOnlineWorker: opts.requireOnlineWorker,
  });

  console.log("[send-inbound] gateway ack:", res);
  if (!res.success) {
    process.exitCode = 1;
    await redis.quit();
    return;
  }

  if (opts.poll) {
    console.log(`[send-inbound] polling session stream for up to ${opts.waitMs}ms...`);
    const poll = await pollSessionStream(redis, opts.sessionId, opts.waitMs);
    console.log(`[send-inbound] poll done=${poll.done} eventType=${poll.eventType} chunks=${poll.chunks.length}`);
    for (const [idx, chunk] of poll.chunks.entries()) {
      const preview = JSON.stringify(chunk);
      console.log(`  [chunk ${idx}] ${preview.slice(0, 500)}${preview.length > 500 ? "…" : ""}`);
    }
    if (!poll.done) {
      process.exitCode = 2;
    }
  }

  await redis.quit();
}

main().catch((err) => {
  console.error("[send-inbound] failed:", err);
  process.exitCode = 1;
});
