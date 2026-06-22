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
 * Env: REDIS_HOST, REDIS_PORT, REDIS_USERNAME, REDIS_PASSWORD, REDIS_DATABASE, USER_CODE
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
  const host = process.env.REDIS_HOST?.trim();
  const port = process.env.REDIS_PORT?.trim();
  if (!host || !port) {
    throw new Error("REDIS_HOST and REDIS_PORT are required");
  }
  return {
    host,
    port: Number.parseInt(port, 10),
    username: process.env.REDIS_USERNAME?.trim() || undefined,
    password: process.env.REDIS_PASSWORD?.trim() || undefined,
    db: Number.parseInt(process.env.REDIS_DATABASE ?? "0", 10),
  };
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

  const { createRedis, GatewayClient, WorkerRegistry } = await importFramework();
  const redisInfo = readRedisInfo();
  const redis = createRedis(redisInfo);
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
