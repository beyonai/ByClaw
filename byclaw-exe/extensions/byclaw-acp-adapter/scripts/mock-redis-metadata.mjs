import net from "node:net";
import { ACP, DEFAULTS, ENV, JSON_INDENT_SPACES, REDIS_KEYS } from "./constants.mjs";

function envString(name, fallback = "") {
  return process.env[name] && process.env[name].trim() ? process.env[name].trim() : fallback;
}

function envNumber(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function encodeCommand(parts) {
  const chunks = [`*${parts.length}\r\n`];
  for (const part of parts) {
    const value = String(part);
    chunks.push(`$${Buffer.byteLength(value)}\r\n${value}\r\n`);
  }
  return Buffer.from(chunks.join(""), "utf8");
}

class RespParser {
  buffer = Buffer.alloc(0);

  append(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }

  read() {
    const parsed = this.parseAt(0);
    if (!parsed) return undefined;
    this.buffer = this.buffer.subarray(parsed.offset);
    return parsed.value;
  }

  parseAt(offset) {
    if (offset >= this.buffer.length) return undefined;
    const prefix = String.fromCharCode(this.buffer[offset]);
    const lineEnd = this.buffer.indexOf("\r\n", offset);
    if (lineEnd < 0) return undefined;
    const line = this.buffer.subarray(offset + 1, lineEnd).toString("utf8");
    const next = lineEnd + 2;
    if (prefix === "+") return { value: line, offset: next };
    if (prefix === "-") throw new Error(`Redis error: ${line}`);
    if (prefix === ":") return { value: Number(line), offset: next };
    if (prefix === "$") {
      const length = Number(line);
      if (length < 0) return { value: null, offset: next };
      const end = next + length;
      if (this.buffer.length < end + 2) return undefined;
      return { value: this.buffer.subarray(next, end).toString("utf8"), offset: end + 2 };
    }
    if (prefix === "*") {
      const length = Number(line);
      if (length < 0) return { value: null, offset: next };
      const items = [];
      let cursor = next;
      for (let index = 0; index < length; index += 1) {
        const parsed = this.parseAt(cursor);
        if (!parsed) return undefined;
        items.push(parsed.value);
        cursor = parsed.offset;
      }
      return { value: items, offset: cursor };
    }
    throw new Error(`Unsupported Redis RESP prefix: ${prefix}`);
  }
}

class Redis {
  constructor(config) {
    this.config = config;
    this.parser = new RespParser();
    this.waiters = [];
  }

  async connect() {
    this.socket = net.createConnection({ host: this.config.host, port: this.config.port });
    this.socket.setTimeout(DEFAULTS.redisConnectTimeoutMs);
    this.socket.on("data", (chunk) => {
      this.parser.append(chunk);
      for (;;) {
        const reply = this.parser.read();
        if (reply === undefined) break;
        const waiter = this.waiters.shift();
        waiter?.resolve(reply);
      }
    });
    this.socket.on("error", (error) => this.rejectPending(error));
    this.socket.on("timeout", () => this.socket.destroy(new Error("Redis connection timed out.")));
    this.socket.on("close", () => this.rejectPending(new Error("Redis connection closed.")));
    await new Promise((resolve, reject) => {
      this.socket.once("connect", resolve);
      this.socket.once("error", reject);
    });
    if (this.config.password) {
      if (this.config.username) {
        await this.command("AUTH", this.config.username, this.config.password);
      } else {
        await this.command("AUTH", this.config.password);
      }
    }
    if (this.config.database > 0) {
      await this.command("SELECT", this.config.database);
    }
  }

  async command(...parts) {
    return await new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.socket.write(encodeCommand(parts));
    });
  }

  async setJson(key, value) {
    await this.command("SET", key, JSON.stringify(value));
  }

  async hset(key, object) {
    const parts = ["HSET", key];
    for (const [field, value] of Object.entries(object)) {
      parts.push(field, typeof value === "string" ? value : JSON.stringify(value));
    }
    await this.command(...parts);
  }

  close() {
    this.socket?.destroy();
  }

  rejectPending(error) {
    const pending = this.waiters.splice(0);
    for (const waiter of pending) waiter.reject(error);
  }
}

const userCode = envString("USER_CODE", DEFAULTS.syncUserCode);
const defaultClaudeModel = envString(
  ENV.byclawAcpClaudeModel,
  envString(ENV.anthropicModel, DEFAULTS.claudeModel)
);
const strongClaudeModel = envString(ENV.byclawAcpStrongModel, defaultClaudeModel);
const anthropicCompatibleUrl = envString("BYCLAW_ACP_PROVIDER_URL", "");
const anthropicCompatibleAuthorization = envString("BYCLAW_ACP_AUTHORIZATION", "");
const anthropicCompatibleApiKey = envString("BYCLAW_ACP_API_KEY", "");
const anthropicCompatibleHeaders = anthropicCompatibleAuthorization
  ? {
      Authorization: anthropicCompatibleAuthorization,
      ...(anthropicCompatibleApiKey ? { "X-Api-Key": anthropicCompatibleApiKey } : {})
    }
  : anthropicCompatibleApiKey
    ? { "X-Api-Key": anthropicCompatibleApiKey }
    : {};
const anthropicCompatibleRequestDefaults = {
  temperature: 0.1,
  stream: true,
  enable_thinking: false,
  chat_template_kwargs: {
    enable_thinking: false
  }
};
const modelByRole = {
  "orchestrator": defaultClaudeModel,
  "issue-triage": defaultClaudeModel,
  "req-analyst": defaultClaudeModel,
  "arch-designer": strongClaudeModel,
  "coder": defaultClaudeModel,
  "reviewer": strongClaudeModel,
  "tester": defaultClaudeModel,
  "shipper": defaultClaudeModel,
  "specialist-teammate": defaultClaudeModel
};

const roles = [
  ["900001", "orchestrator", "orchestrator / team-lead", "流程调度与共享状态 owner", "任务拆分、dispatch、gate、汇总"],
  ["900002", "issue-triage", "issue-triage", "事件入口和需求池管理员", "结构化 issue、标签、优先级、去重"],
  ["900003", "req-analyst", "req-analyst", "产品价值和验收标准", "PRD-lite、scope、acceptance criteria"],
  ["900004", "arch-designer", "arch-designer", "技术方案和测试策略", "锁定设计、接口、数据流、测试策略"],
  ["900005", "coder", "coder", "maker", "分支、commit、实现说明、proof"],
  ["900006", "reviewer", "reviewer", "checker #1", "findings、verdict、missing edge cases"],
  ["900007", "tester", "tester", "checker #2", "test report、health score、screenshots"],
  ["900008", "shipper", "shipper", "发布工程", "PR、CI proof、release note"],
  ["900009", "specialist-teammate", "specialist teammate", "Claude agent team 内的专家队友", "独立结论、补丁候选、证据"]
];

function employee([resourceId, roleCode, name, positioning, output]) {
  return {
    id: resourceId,
    resourceId,
    resourceName: `ByClaw ${name}`,
    name: `ByClaw ${name}`,
    resourceCode: `BYCLAW_${roleCode.toUpperCase().replaceAll("-", "_")}`,
    resourceBizType: "DIG_EMPLOYEE",
    resourceDesc: positioning,
    resourceStatus: "1",
    userCode,
    agentRole: roleCode,
    openclawAgentId: `baiying-agent-${resourceId}`,
    runtime: {
      acpAgentId: DEFAULTS.acpAgentId,
      modelRef: modelByRole[roleCode],
      provider: "anthropic-compatible",
      ...(anthropicCompatibleUrl ? { url: anthropicCompatibleUrl } : {}),
      ...(Object.keys(anthropicCompatibleHeaders).length
        ? { headers: anthropicCompatibleHeaders }
        : {}),
      requestDefaults: anthropicCompatibleRequestDefaults,
      output
    },
    prologue: {
      role: roleCode,
      modelId: modelByRole[roleCode],
      background: positioning,
      descText: `${positioning}。主要输出：${output}。`,
      openingQuestion: "请给出本轮任务目标、约束、证据和下一步。"
    },
    relSkills: [`byclaw-${roleCode}`],
    relTools: ["workboard", "task-flow", "btw", "sqlExecute"]
  };
}

const employees = roles.map(employee);
const team = {
  id: "rd-core",
  name: "ByClaw R&D Core Team",
  coordinatorAgentId: "900001",
  memberAgentIds: employees.map((item) => item.resourceId),
  policy: {
    makerChecker: true,
    stateAuthority: "openclaw-sqlite",
    outboundChannel: "byai-channel"
  }
};

const workflow = {
  id: "feature-delivery",
  name: "ByClaw Feature Delivery Workflow",
  teamId: team.id,
  steps: [
    { id: "triage", name: "Discovery", agentId: "900002", instruction: "归并事件，形成结构化需求池和优先级。" },
    { id: "prd", name: "Planning PRD", agentId: "900003", instruction: "输出 PRD-lite、scope 与验收标准。" },
    { id: "design", name: "Architecture", agentId: "900004", instruction: "锁定接口、数据流、风险与测试策略。" },
    { id: "implement", name: "Implementation", agentId: "900005", instruction: "按 card 实现，产出 proof 与变更说明。" },
    { id: "review", name: "Review", agentId: "900006", instruction: "独立 code review，给出 findings/verdict。" },
    { id: "test", name: "Verification", agentId: "900007", instruction: "执行测试策略，给出 test report 和 health score。" },
    { id: "ship", name: "Shipping", agentId: "900008", instruction: "准备 PR、CI proof 和 release note。" }
  ]
};

const loop = {
  id: "feature-delivery-loop",
  name: "ByClaw Feature Delivery Loop",
  workflowId: workflow.id,
  maxIterations: 3,
  cadence: "event-driven",
  exitCriteria: [
    "checker verdict 为 pass 或 explicit override",
    "关键测试命令有可追溯输出",
    "Workboard card 状态、proof 和 release note 已回写"
  ],
  budget: {
    maxAgentTurns: 20,
    humanEscalation: ["超出 3 轮未收敛", "权限或 CI 环境阻塞", "架构争议"]
  }
};

const modelConfigs = Object.fromEntries(
  Object.values(modelByRole).map((modelId) => [
    modelId,
    {
      modelId,
      modelCode: modelId,
      modelName: modelId,
      provider: ACP.providerClaudeCode,
      modelType: "LLM",
      enabled: true,
      runtime: ACP.runtime,
      agentId: DEFAULTS.acpAgentId
    }
  ])
);

async function main() {
  const redis = new Redis({
    host: envString(ENV.redisHost, DEFAULTS.redisHost),
    port: envNumber(ENV.redisPort, DEFAULTS.redisPort),
    username: envString(ENV.redisUsername, ""),
    password: envString(ENV.redisPassword, ""),
    database: envNumber(ENV.redisDatabase, DEFAULTS.redisDatabase)
  });
  await redis.connect();

  for (const item of employees) {
    await redis.setJson(`${REDIS_KEYS.digitalEmployeePrefix}${item.resourceId}`, item);
    await redis.hset(`${REDIS_KEYS.userResourcesAuthPrefix}:${userCode}`, {
      [item.resourceId]: REDIS_KEYS.authorizedValue,
    });
    await redis.command(
      "PUBLISH",
      REDIS_KEYS.digitalEmployeeChangeChannel,
      JSON.stringify({ eventType: "UPSERT", resourceId: item.resourceId, userCode })
    );
  }

  await redis.setJson(`${REDIS_KEYS.teamPrefix}${team.id}`, team);
  await redis.setJson(`${REDIS_KEYS.workflowPrefix}${workflow.id}`, workflow);
  await redis.setJson(`${REDIS_KEYS.loopPrefix}${loop.id}`, loop);
  await redis.hset(REDIS_KEYS.aimodelConfig, modelConfigs);
  await redis.hset(REDIS_KEYS.aimodelTypeList, {
    [REDIS_KEYS.typeListLlmField]: Object.values(modelConfigs),
  });
  redis.close();

  console.log(
    JSON.stringify(
      {
        ok: true,
        userCode,
        employees: employees.map((item) => item.resourceId),
        team: team.id,
        workflow: workflow.id,
        loop: loop.id
      },
      null,
      JSON_INDENT_SPACES
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
