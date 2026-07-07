import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { ACP, DEFAULTS, ENV, GATEWAY, HTTP, JSON_INDENT_SPACES, PACKAGE, PATHS } from "./constants.mjs";

const byclawRoot = path.resolve(new URL("../../../../", import.meta.url).pathname);
const openclawRoot =
  process.env[ENV.openclawRoot] || path.resolve(byclawRoot, ...PATHS.defaultOpenclawRootParts);
const configPath =
  process.env[ENV.openclawConfigPath] ||
  path.join(byclawRoot, PATHS.tempDir, PATHS.testConfigFileName);
const stateDir =
  process.env[ENV.openclawStateDir] || path.join(byclawRoot, PATHS.tempDir, PATHS.stateDirName);
const token = process.env[ENV.openclawGatewayToken] || DEFAULTS.gatewayToken;
const port = Number(process.env[ENV.openclawGatewayPort] || DEFAULTS.gatewayPort);
const require = createRequire(import.meta.url);

function canWriteOpenclawArtifacts() {
  try {
    const artifacts = path.join(openclawRoot, ".artifacts");
    fs.mkdirSync(artifacts, { recursive: true });
    fs.accessSync(artifacts, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function openclawCliArgs(args) {
  if (process.env[ENV.byclawOpenclawUsePackagedCli] === "1" || !canWriteOpenclawArtifacts()) {
    return ["openclaw.mjs", ...args];
  }
  return ["scripts/run-node.mjs", ...args];
}

async function httpJson(pathname, options = {}) {
  const response = await fetch(`${HTTP.scheme}://${DEFAULTS.gatewayHost}:${port}${pathname}`, {
      method: options.method || HTTP.methods.get,
    headers: {
      Authorization: `Bearer ${token}`,
      [HTTP.headers.contentType]: HTTP.contentTypes.json,
      ...(options.headers || {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, ok: response.ok, json };
}

async function waitForGateway(timeoutMs = DEFAULTS.gatewayReadyTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await httpJson("/plugins/byclaw-acp-adapter/registry");
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, DEFAULTS.gatewayPollIntervalMs));
    }
  }
  throw lastError || new Error("Gateway did not become ready.");
}

function summarizeClaudeTeam(plan) {
  const claudeTeam = plan?.metadata?.claudeTeam;
  const agents = Array.isArray(claudeTeam?.agents) ? claudeTeam.agents : [];
  const files = agents.map((agent) => String(agent.filePath || "")).filter(Boolean);
  return {
    runtime: claudeTeam?.runtime,
    agentsDir: claudeTeam?.agentsDir,
    agentCount: agents.length,
    allFilesExist: files.length > 0 && files.every((filePath) => fs.existsSync(filePath)),
    agents: agents.map((agent) => ({
      byclawAgentId: agent.byclawAgentId,
      name: agent.name,
      role: agent.role,
      model: agent.model
    }))
  };
}

function assertNativeClaudeTeamPlan(plan) {
  const summary = summarizeClaudeTeam(plan);
  if (summary.runtime !== ACP.nativeSubagentsRuntime) {
    throw new Error(`plan did not target Claude Code native subagents: ${summary.runtime}`);
  }
  if (summary.agentCount < DEFAULTS.smokeMinimumAgentCount) {
    throw new Error(
      `expected at least ${DEFAULTS.smokeMinimumAgentCount} materialized Claude Code subagents, got ${summary.agentCount}`,
    );
  }
  if (!summary.allFilesExist) {
    throw new Error("not all materialized Claude Code subagent files exist.");
  }
  const task = String(plan?.task || "");
  if (!task.includes("query.md") || !task.includes("metadata.md")) {
    throw new Error("plan task does not point the ACP client at shared query and metadata files.");
  }
  return summary;
}

function assertSessionsSpawnModelPayload(plan) {
  const payload = plan?.sessionsSpawn;
  if (!payload || typeof payload !== "object") {
    throw new Error("plan.sessionsSpawn is missing.");
  }
  if (!payload.modelConfig || typeof payload.modelConfig !== "object") {
    throw new Error("plan.sessionsSpawn.modelConfig is missing.");
  }
  if (payload.agentModels !== undefined) {
    throw new Error("plan.sessionsSpawn.agentModels should be stored in the shared bundle file.");
  }
  const bundlePath = payload.bundle?.path;
  if (!bundlePath || typeof bundlePath !== "string") {
    throw new Error("plan.sessionsSpawn.bundle.path is missing.");
  }
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`plan.sessionsSpawn.bundle.path does not exist: ${bundlePath}`);
  }
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  const agentModels = bundle.agentModels;
  if (!agentModels || typeof agentModels !== "object") {
    throw new Error("plan bundle agentModels is missing.");
  }
  const agents = Array.isArray(agentModels.agents) ? agentModels.agents : [];
  if (agents.length < 1) {
    throw new Error("plan bundle agentModels.agents is empty.");
  }
  const agentsMissingModelConfig = agents
    .filter((agent) => !agent?.modelConfig)
    .map((agent) => agent?.byclawAgentId || agent?.nativeSubagentId || "unknown");
  if (agentsMissingModelConfig.length) {
    throw new Error(
      `plan.sessionsSpawn.agentModels has agents without modelConfig: ${agentsMissingModelConfig.join(", ")}`
    );
  }
  for (const agent of agents) {
    const byId = agentModels.byByclawAgentId?.[agent.byclawAgentId];
    if (!byId?.nativeSubagentId) {
      throw new Error(`agentModels.byByclawAgentId is missing nativeSubagentId for ${agent.byclawAgentId}`);
    }
    const byNative = agentModels.byNativeSubagentId?.[agent.nativeSubagentId];
    if (!byNative?.byclawAgentId) {
      throw new Error(`agentModels.byNativeSubagentId is missing byclawAgentId for ${agent.nativeSubagentId}`);
    }
  }
  const metadataAgentModels = plan?.metadata?.agentModels;
  if (JSON.stringify(metadataAgentModels) !== JSON.stringify(agentModels)) {
    throw new Error("plan.metadata.agentModels and plan bundle agentModels differ.");
  }
  return {
    hasModelConfig: true,
    bundlePath,
    sessionsSpawnBytes: Buffer.byteLength(JSON.stringify(payload)),
    agentModelCount: agents.length,
    providerApis: [...new Set(agents.map((agent) => agent.modelConfig?.providerApi).filter(Boolean))]
  };
}

function checkSqliteStateAlignment(runId) {
  const sqlitePath = path.join(stateDir, PATHS.pluginStateDir, PATHS.pluginSqliteFileName);
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(sqlitePath);
  try {
    const acpRun = db
      .prepare("SELECT run_id, pipeline_run_id FROM byclaw_acp_runs WHERE run_id = ?")
      .get(runId);
    if (!acpRun?.pipeline_run_id) {
      throw new Error(`ACP run ${runId} is missing pipeline_run_id.`);
    }
    const pipelineRun = db
      .prepare("SELECT id, status, flow_id, workboard_board_id, workspace_mirror_path FROM byclaw_pipeline_runs WHERE id = ?")
      .get(acpRun.pipeline_run_id);
    if (!pipelineRun) {
      throw new Error(`PipelineRun not found for ${acpRun.pipeline_run_id}.`);
    }
    const taskCount = db
      .prepare("SELECT count(*) AS count FROM byclaw_pipeline_tasks WHERE pipeline_run_id = ?")
      .get(acpRun.pipeline_run_id).count;
    const eventCount = db
      .prepare("SELECT count(*) AS count FROM byclaw_task_events WHERE pipeline_run_id = ?")
      .get(acpRun.pipeline_run_id).count;
    const artifactCount = db
      .prepare("SELECT count(*) AS count FROM byclaw_shared_artifacts WHERE pipeline_run_id = ?")
      .get(acpRun.pipeline_run_id).count;
    if (taskCount < DEFAULTS.smokeMinimumTaskCount) {
      throw new Error(`Expected at least ${DEFAULTS.smokeMinimumTaskCount} pipeline tasks, got ${taskCount}.`);
    }
    if (eventCount < taskCount + 1) {
      throw new Error(`Expected task events for run and tasks, got ${eventCount}.`);
    }
    if (artifactCount < 1) {
      throw new Error("Expected at least one shared artifact row.");
    }
    return {
      sqlitePath,
      acpRunId: acpRun.run_id,
      pipelineRunId: acpRun.pipeline_run_id,
      pipelineRun,
      taskCount,
      eventCount,
      artifactCount
    };
  } finally {
    db.close();
  }
}

function createGatewayBackendRpcClient({ onEvent } = {}) {
  const ws = new WebSocket(`${HTTP.wsScheme}://${DEFAULTS.gatewayHost}:${port}`);
  const pending = new Map();
  let eventCount = 0;

  function closeWithError(error) {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    pending.clear();
  }

  function request(method, params, timeoutMs = DEFAULTS.gatewayRequestTimeoutMs) {
    return new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) {
        reject(new Error(`Gateway WebSocket is not open for ${method}.`));
        return;
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timeout waiting for ${method}.`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeout });
      ws.send(JSON.stringify({ type: GATEWAY.frameTypes.request, id, method, params }));
    });
  }

  const open = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Gateway WebSocket open timeout.")),
      DEFAULTS.gatewaySocketOpenTimeoutMs,
    );
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Gateway WebSocket failed to open."));
    }, { once: true });
  });

  ws.addEventListener("message", (event) => {
    let frame;
    try {
      frame = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!frame || typeof frame !== "object") {
      return;
    }
    if (frame.type === GATEWAY.frameTypes.response) {
      const waiter = pending.get(frame.id);
      if (!waiter) {
        return;
      }
      pending.delete(frame.id);
      clearTimeout(waiter.timeout);
      waiter.resolve(frame);
      return;
    }
    if (frame.type === GATEWAY.frameTypes.event) {
      eventCount += 1;
      onEvent?.(frame);
    }
  });
  ws.addEventListener("close", (event) => {
    closeWithError(new Error(`Gateway WebSocket closed (${event.code}): ${event.reason || "no reason"}`));
  });
  ws.addEventListener("error", () => {
    closeWithError(new Error("Gateway WebSocket error."));
  });

  return {
    async connect() {
      await open;
      const response = await request(GATEWAY.rpc.connect, {
        minProtocol: DEFAULTS.protocolVersion,
        maxProtocol: DEFAULTS.protocolVersion,
        client: {
          id: GATEWAY.clientId,
          displayName: GATEWAY.clientDisplayName,
          version: PACKAGE.version,
          platform: process.platform,
          mode: GATEWAY.backendMode,
          instanceId: GATEWAY.instanceId
        },
        locale: GATEWAY.locale,
        userAgent: GATEWAY.userAgent,
        role: GATEWAY.operatorRole,
        scopes: GATEWAY.scopes,
        caps: GATEWAY.caps,
        auth: { token }
      }, DEFAULTS.gatewayConnectRequestTimeoutMs);
      if (!response.ok) {
        throw new Error(`Gateway connect failed: ${JSON.stringify(response.error)}`);
      }
      return response.payload;
    },
    request,
    getEventCount() {
      return eventCount;
    },
    close() {
      closeWithError(new Error("Gateway WebSocket client closed."));
      ws.close();
    }
  };
}

function readJsonlFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { raw: line };
        }
      });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function waitForAcpStreamResult(
  streamLogPath,
  timeoutMs = Number(process.env[ENV.byclawSmokeAcpStreamTimeoutMs] || DEFAULTS.acpStreamTimeoutMs)
) {
  if (!streamLogPath) {
    return null;
  }
  const deadline = Date.now() + timeoutMs;
  let latest = [];
  while (Date.now() < deadline) {
    latest = readJsonlFile(streamLogPath);
    const serialized = latest.map((entry) => JSON.stringify(entry)).join("\n");
    const errorEntry = latest.find((entry) => entry?.kind === "lifecycle" && entry?.phase === "error");
    if (errorEntry) {
      throw new Error(`ACP stream failed: ${JSON.stringify(errorEntry.data || errorEntry)}`);
    }
    if (serialized.includes("ByClaw ACP Claude Code smoke ok")) {
      return {
        streamLogPath,
        lineCount: latest.length,
        matched: true,
        tail: latest.slice(-DEFAULTS.smokeStreamTailLines)
      };
    }
    await new Promise((resolve) => setTimeout(resolve, DEFAULTS.gatewayPollIntervalMs));
  }
  return {
    streamLogPath,
    lineCount: latest.length,
    matched: false,
    tail: latest.slice(-DEFAULTS.smokeStreamTailLines)
  };
}

async function invokeSessionsSpawnViaGateway(plan) {
  const events = [];
  const client = createGatewayBackendRpcClient({
    onEvent: (event) => {
      events.push(event);
    }
  });
  try {
    const hello = await client.connect();
    let invoke;
    for (let attempt = 1; attempt <= DEFAULTS.sessionsSpawnRetryCount; attempt += 1) {
      const spawnLabel = `${plan.sessionsSpawn.label || "ByClaw ACP Claude smoke"} #${Date.now()}-${attempt}`;
      invoke = await client.request(GATEWAY.rpc.toolsInvoke, {
        name: GATEWAY.tools.sessionsSpawn,
        agentId: GATEWAY.mainAgentId,
        sessionKey: `agent:${GATEWAY.mainAgentId}:${GATEWAY.mainAgentId}`,
        idempotencyKey: `byclaw-acp-smoke-${Date.now()}-${attempt}`,
        args: {
          ...plan.sessionsSpawn,
          label: spawnLabel,
          task: [
            "ByClaw ACP smoke 验证短任务。",
            `Adapter plan kind=${plan.kind} id=${plan.id} model=${plan.model || plan.sessionsSpawn.model}.`,
            `已由 /plugins/${PACKAGE.pluginId}/plan 验证 Redis 数字员工、team、workflow、loop 元数据可以生成 ${GATEWAY.tools.sessionsSpawn}。`,
            "Smoke 验证要求：不要修改文件，只回复一句 ByClaw ACP Claude Code smoke ok。"
          ].join("\n")
        }
      }, DEFAULTS.sessionsSpawnInvokeTimeoutMs);
      if (!invoke.ok) {
        throw new Error(`tools.invoke ${GATEWAY.tools.sessionsSpawn} failed: ${JSON.stringify(invoke.error)}`);
      }
      const details = invoke.payload?.output?.details;
      if (details?.status !== "error") {
        break;
      }
      const message = String(details.error || "");
      if (
        !message.includes("ACP runtime backend is currently unavailable") ||
        attempt === DEFAULTS.sessionsSpawnRetryCount
      ) {
        throw new Error(`${GATEWAY.tools.sessionsSpawn} returned error: ${JSON.stringify(details)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, DEFAULTS.sessionsSpawnRetryDelayMs));
    }
    if (!invoke) {
      throw new Error(`${GATEWAY.tools.sessionsSpawn} was not invoked.`);
    }
    const stream = await waitForAcpStreamResult(invoke.payload?.output?.details?.streamLogPath);
    if (!stream) {
      throw new Error(
        `${GATEWAY.tools.sessionsSpawn} did not return a stream log: ${JSON.stringify(invoke.payload?.output?.details)}`,
      );
    }
    if (stream && !stream.matched) {
      throw new Error(`ACP stream did not produce expected smoke text: ${JSON.stringify(stream)}`);
    }
    return {
      helloAuth: hello?.auth,
      response: invoke.payload,
      stream,
      eventCount: client.getEventCount(),
      sampledEvents: events.slice(0, DEFAULTS.smokeSampledEventLimit).map((event) => ({
        event: event.event,
        seq: event.seq,
        payloadType: event.payload && typeof event.payload === "object"
          ? event.payload.type || event.payload.event || undefined
          : undefined
      }))
    };
  } finally {
    client.close();
  }
}

async function main() {
  const gateway = spawn(process.execPath, openclawCliArgs(["gateway"]), {
    cwd: openclawRoot,
    env: {
      ...process.env,
      OPENCLAW_CONFIG_PATH: configPath,
      [ENV.openclawStateDir]: stateDir,
      [ENV.openclawGatewayToken]: token,
      [ENV.openclawGatewayPort]: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let gatewayLog = "";
  gateway.stdout.on("data", (chunk) => {
    gatewayLog += chunk.toString();
  });
  gateway.stderr.on("data", (chunk) => {
    gatewayLog += chunk.toString();
  });

  try {
    await waitForGateway();
    const registry = await httpJson("/plugins/byclaw-acp-adapter/registry");
    const plan = await httpJson("/plugins/byclaw-acp-adapter/plan", {
      method: HTTP.methods.post,
      body: {
        kind: "loop",
        id: "feature-delivery-loop",
        input: {
          title: "smoke test",
          goal: "验证 ByClaw Redis 元数据可以驱动 ACP Claude Code workflow/loop 计划"
        }
      }
    });
    const run = await httpJson("/plugins/byclaw-acp-adapter/run", {
      method: HTTP.methods.post,
      body: {
        kind: "loop",
        id: "feature-delivery-loop",
        input: {
          title: "smoke test",
          goal: `创建 SQLite run ledger 并返回 ${GATEWAY.tools.sessionsSpawn} 计划`
        }
      }
    });
    const claudeTeam = assertNativeClaudeTeamPlan(run.json?.data?.plan);
    const planSessionsSpawnPayload = assertSessionsSpawnModelPayload(plan.json?.data?.plan);
    const runSessionsSpawnPayload = assertSessionsSpawnModelPayload(run.json?.data?.plan);

    let claude = null;
    if (process.argv.includes("--execute-claude") && run.json?.data?.plan) {
      claude = await invokeSessionsSpawnViaGateway(run.json.data.plan);
    }
    const sqliteState = checkSqliteStateAlignment(run.json?.data?.run?.runId);

    console.log(
      JSON.stringify(
        {
          ok: true,
          registryCounts: {
            agents: registry.json?.data?.agents?.length ?? 0,
            teams: registry.json?.data?.teams?.length ?? 0,
            workflows: registry.json?.data?.workflows?.length ?? 0,
            loops: registry.json?.data?.loops?.length ?? 0
          },
          registryStatus: registry.status,
          planStatus: plan.status,
          plan: plan.json?.data?.plan
            ? {
                kind: plan.json.data.plan.kind,
                id: plan.json.data.plan.id,
                model: plan.json.data.plan.model,
                claudeTeam: summarizeClaudeTeam(plan.json.data.plan),
                sessionsSpawn: plan.json.data.plan.sessionsSpawn
                  ? {
                      runtime: plan.json.data.plan.sessionsSpawn.runtime,
                      agentId: plan.json.data.plan.sessionsSpawn.agentId,
                      streamTo: plan.json.data.plan.sessionsSpawn.streamTo,
                      mode: plan.json.data.plan.sessionsSpawn.mode,
                      cwd: plan.json.data.plan.sessionsSpawn.cwd,
                      model: plan.json.data.plan.sessionsSpawn.model,
                      label: plan.json.data.plan.sessionsSpawn.label,
                      bundlePath: plan.json.data.plan.sessionsSpawn.bundle?.path,
                      taskChars: plan.json.data.plan.sessionsSpawn.task?.length ?? 0
                    }
                  : undefined
              }
            : undefined,
          runStatus: run.status,
          runId: run.json?.data?.run?.runId,
          sessionsSpawnPayload: {
            plan: planSessionsSpawnPayload,
            run: runSessionsSpawnPayload
          },
          run: run.json?.data?.run
            ? {
                kind: run.json.data.run.kind,
                targetId: run.json.data.run.targetId,
                pipelineRunId: run.json.data.run.pipelineRunId,
                runId: run.json.data.run.runId,
                status: run.json.data.run.status
              }
            : undefined,
          claudeTeam,
          sqliteState,
          claude
        },
        null,
        JSON_INDENT_SPACES
      )
    );
  } finally {
    gateway.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, DEFAULTS.gatewayShutdownGraceMs));
    if (!gateway.killed) {
      gateway.kill("SIGKILL");
    }
    if (process.env[ENV.byclawSmokePrintGatewayLog] === "1") {
      console.error(gatewayLog);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
