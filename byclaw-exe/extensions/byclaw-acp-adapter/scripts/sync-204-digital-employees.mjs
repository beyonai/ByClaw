import IORedis from "ioredis";
import { ACP, DEFAULTS, ENV, HTTP, REDIS_KEYS } from "./constants.mjs";

function envString(name, fallback = "") {
  return process.env[name] && process.env[name].trim() ? process.env[name].trim() : fallback;
}

function envNumber(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBoolean(name, fallback = false) {
  const value = envString(name, "");
  if (!value) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
}

function parseClusterNodes(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [host, rawPort] = item.split(":");
      const port = Number(rawPort);
      if (!host || !Number.isInteger(port) || port <= 0) {
        throw new Error(`Invalid Redis cluster node: ${item}`);
      }
      return { host, port };
    });
}

function readRedisConfig() {
  const clusterNodesValue =
    envString("REDIS_CLUSTER_HOST", "") ||
    envString("REDIS_CLUSTER_NODES", "") ||
    envString("spring.data.redis.cluster.nodes", "") ||
    envString("spring.redis.cluster.nodes", "");
  const clusterNodes = clusterNodesValue ? parseClusterNodes(clusterNodesValue) : [];
  return {
    host: envString(ENV.redisHost, envString("spring.data.redis.host", envString("spring.redis.host", DEFAULTS.redisHost))),
    port: envNumber(ENV.redisPort, envNumber("spring.data.redis.port", envNumber("spring.redis.port", DEFAULTS.redisPort))),
    username: envString(ENV.redisUsername, envString("spring.data.redis.username", envString("spring.redis.username", ""))),
    password: envString(ENV.redisPassword, envString("spring.data.redis.password", envString("spring.redis.password", ""))),
    database: envNumber(
      ENV.redisDatabase,
      envNumber("REDIS_DB", envNumber("spring.data.redis.database", envNumber("spring.redis.database", DEFAULTS.redisDatabase)))
    ),
    clusterNodes,
    mode: clusterNodes.length > 0 ? "cluster" : "standalone",
  };
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run") || envBoolean("BYCLAW_API_DRY_RUN", false),
    deleteOldMock: argv.includes("--delete-old-mock") || envBoolean("BYCLAW_DELETE_OLD_MOCK", false),
    skipRedis: argv.includes("--skip-redis") || envBoolean("BYCLAW_SKIP_REDIS", false),
  };
}

class Redis {
  constructor(config) {
    this.config = config;
  }

  async connect() {
    const redisOptions = {
      username: this.config.username || undefined,
      password: this.config.password || undefined,
      connectTimeout: DEFAULTS.redisConnectTimeoutMs,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 2,
    };
    if (this.config.mode === "cluster") {
      this.client = new IORedis.Cluster(this.config.clusterNodes, {
        redisOptions,
        lazyConnect: true,
        enableOfflineQueue: false,
        scaleReads: "master",
        slotsRefreshTimeout: DEFAULTS.redisConnectTimeoutMs,
      });
    } else {
      this.client = new IORedis({
        ...redisOptions,
        host: this.config.host,
        port: this.config.port,
        db: this.config.database,
      });
    }
    await this.client.connect();
  }

  async command(...parts) {
    const [command, ...args] = parts;
    const upper = String(command).toUpperCase();
    if (upper === "KEYS") return await this.keys(String(args[0] ?? "*"));
    if (this.config.mode === "cluster" && upper === "MGET") {
      return await Promise.all(args.map((key) => this.client.get(String(key))));
    }
    if (this.config.mode === "cluster" && upper === "DEL" && args.length > 1) {
      const counts = await Promise.all(args.map((key) => this.client.del(String(key))));
      return counts.reduce((sum, count) => sum + count, 0);
    }
    return await this.client.call(upper, ...args);
  }

  async keys(pattern) {
    if (this.config.mode !== "cluster") return await this.client.keys(pattern);
    const masters = this.client.nodes("master");
    const keySets = await Promise.all(masters.map((node) => scanNodeKeys(node, pattern)));
    return [...new Set(keySets.flat())];
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

  async hdel(key, fields) {
    if (!fields.length) return;
    await this.command("HDEL", key, ...fields);
  }

  close() {
    this.client?.disconnect();
  }
}

async function scanNodeKeys(node, pattern) {
  const keys = [];
  let cursor = "0";
  do {
    const [nextCursor, batch] = await node.scan(cursor, "MATCH", pattern, "COUNT", "500");
    cursor = String(nextCursor);
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}

const userCode = envString("USER_CODE", DEFAULTS.syncUserCode);
const apiBaseUrl = envString("BYCLAW_API_BASE_URL", DEFAULTS.syncApiBaseUrl);
const language = envString("BYCLAW_API_LANGUAGE", DEFAULTS.syncLanguage);
const ownerType = envString(ENV.byclawDigEmployeeOwnerType, DEFAULTS.syncOwnerType);
const agentType = envString(ENV.byclawDigEmployeeAgentType, DEFAULTS.syncAgentType);
const runtimeModel = envString(
  ENV.byclawAcpClaudeModel,
  envString(ENV.anthropicModel, DEFAULTS.syncRuntimeModel),
);
const acpAgentId = envString(ENV.byclawAcpAgentId, DEFAULTS.acpAgentId);
const providerUrl = envString("BYCLAW_ACP_PROVIDER_URL", "");
const providerAuthorization = envString("BYCLAW_ACP_AUTHORIZATION", "");
const providerApiKey = envString("BYCLAW_ACP_API_KEY", "");

const roles = [
  {
    roleCode: "orchestrator",
    name: "orchestrator / team-lead",
    positioning: "流程调度与共享状态 owner",
    output: "任务拆分、dispatch、gate、汇总",
    ability: "拆解研发任务，分配子 Agent，维护共享状态和门禁结果。",
    constraints: "不直接绕过 reviewer/tester；遇到权限、成本或架构争议必须升级给用户。",
    faqs: "如何启动 ByClaw 团队流程？请提供目标、仓库范围、验收标准和约束。",
    processingFlow: "接收目标 -> 建立 Workboard -> 派发 workflow step -> 汇总证据 -> 判断 loop exit criteria。"
  },
  {
    roleCode: "issue-triage",
    name: "issue-triage",
    positioning: "事件入口和需求池管理员",
    output: "结构化 issue、标签、优先级、去重",
    ability: "把自然语言诉求归并为结构化 issue，并识别重复项、阻塞项和优先级。",
    constraints: "不扩大需求范围；信息不足时必须列出待确认字段。",
    faqs: "我需要哪些信息？目标、影响范围、复现方式、期望结果和验收口径。",
    processingFlow: "读取输入 -> 分类 -> 去重 -> 标注优先级 -> 形成 issue summary。"
  },
  {
    roleCode: "req-analyst",
    name: "req-analyst",
    positioning: "产品价值和验收标准",
    output: "PRD-lite、scope、acceptance criteria",
    ability: "把需求转换为最小可交付范围、验收标准和非目标清单。",
    constraints: "不把技术实现细节伪装成用户价值；必须明确 out-of-scope。",
    faqs: "PRD-lite 包括什么？背景、目标、范围、验收标准、风险和依赖。",
    processingFlow: "分析 issue -> 提炼用户价值 -> 划定 scope -> 输出 acceptance criteria。"
  },
  {
    roleCode: "arch-designer",
    name: "arch-designer",
    positioning: "技术方案和测试策略",
    output: "锁定设计、接口、数据流、测试策略",
    ability: "设计最小可行技术方案，识别接口、数据结构、失败路径和测试策略。",
    constraints: "不引入无必要抽象；必须和现有代码边界、数据结构、测试能力对齐。",
    faqs: "什么时候需要方案评审？跨模块、数据结构变更、权限/安全或运行时协议变化时。",
    processingFlow: "读取需求 -> 调研现有实现 -> 输出方案 -> 定义测试矩阵和回滚点。"
  },
  {
    roleCode: "coder",
    name: "coder",
    positioning: "maker",
    output: "分支、commit、实现说明、proof",
    ability: "按设计实现代码、脚本和配置，产出可验证的 proof。",
    constraints: "只改任务相关文件；不提交 secret；不回滚用户已有改动。",
    faqs: "实现完成的证据是什么？关键 diff、构建结果、测试输出和剩余风险。",
    processingFlow: "读取任务卡 -> 编辑实现 -> 运行验证 -> 回写 proof。"
  },
  {
    roleCode: "reviewer",
    name: "reviewer",
    positioning: "checker #1",
    output: "findings、verdict、missing edge cases",
    ability: "从代码审查角度发现 bug、回归风险、边界遗漏和测试缺口。",
    constraints: "发现必须可复现或有明确代码依据；不要输出泛泛建议。",
    faqs: "verdict 怎么给？pass、pass-with-risk 或 block，并附证据。",
    processingFlow: "审查 diff -> 追踪调用影响 -> 列 findings -> 给 verdict。"
  },
  {
    roleCode: "tester",
    name: "tester",
    positioning: "checker #2",
    output: "test report、health score、screenshots",
    ability: "执行测试计划，覆盖核心路径、失败路径和集成链路。",
    constraints: "不能把未执行的测试写成已通过；环境问题要单独标注。",
    faqs: "测试报告包括什么？命令、结果、失败原因、证据路径和健康评分。",
    processingFlow: "读取验收标准 -> 执行测试 -> 记录证据 -> 输出 health score。"
  },
  {
    roleCode: "shipper",
    name: "shipper",
    positioning: "发布工程",
    output: "PR、CI proof、release note",
    ability: "整理交付材料、发布说明、CI 证据和上线风险。",
    constraints: "不隐藏已知风险；发布材料必须可追踪到测试证据。",
    faqs: "release note 要写什么？变更摘要、验证结果、兼容性、风险和回滚建议。",
    processingFlow: "汇总 proof -> 检查 CI -> 生成 release note -> 准备交付。"
  },
  {
    roleCode: "specialist-teammate",
    name: "specialist teammate",
    positioning: "Claude agent team 内的专家队友",
    output: "独立结论、补丁候选、证据",
    ability: "针对特定技术点提供独立判断、候选补丁和证据。",
    constraints: "必须说明假设边界；不能覆盖团队 gate 决策。",
    faqs: "什么时候调用专家队友？遇到专门领域、复杂故障或需要第二方案时。",
    processingFlow: "接收专题 -> 独立分析 -> 输出候选方案 -> 标注证据和风险。"
  }
];

function resourceCode(roleCode) {
  return `BYCLAW_${roleCode.toUpperCase().replaceAll("-", "_")}`;
}

function normalizePromptConfigKey(key = "", item = {}) {
  const candidates = [key, item?.name, item?.nameEn, item?.paramName, item?.paramEnName].filter(Boolean);
  if (candidates.some((value) => ["agent", "工作规范", "Work Specification"].includes(value))) return "agent";
  if (
    candidates.some((value) =>
      ["persona", "soul", "corePersonaDefinition", "人格定义", "Persona", "Personality Definition"].includes(value)
    )
  ) {
    return "soul";
  }
  if (candidates.some((value) => ["tool", "tools", "工具规范", "Tool Specification"].includes(value))) return "tools";
  if (candidates.some((value) => ["memory", "记忆规范", "Memory Specification"].includes(value))) return "memory";
  return key || item?.promptKey || item?.paramName || "";
}

function parseTemplatePayload(value) {
  const raw = value?.paramValue ?? value?.data?.paramValue ?? value?.data ?? value;
  const parsed = typeof raw === "string" ? parseJson(raw, raw) : raw;
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") return [parsed];
  return [];
}

function parseBundledToolsPayload(value) {
  const raw = value?.paramValue ?? value?.data?.paramValue ?? value?.data ?? value;
  const parsed = typeof raw === "string" ? parseJson(raw, []) : raw;
  return Array.isArray(parsed) ? parsed : [];
}

function selectRelTools(bundledTools) {
  const configured = parseJson(envString("BYCLAW_OPENCLAW_REL_TOOLS_JSON", ""), null);
  if (Array.isArray(configured) && configured.length) {
    const available = new Set(bundledTools.map((item) => String(item?.toolCode || "")).filter(Boolean));
    const selected = configured.map(String).filter((toolCode) => available.has(toolCode));
    if (selected.length) return selected;
  }

  const mode = envString("BYCLAW_OPENCLAW_TOOL_MODE", "wildcard");
  const wildcard = bundledTools.find((item) => item?.isWildcard || item?.toolCode === "*");
  if (mode === "wildcard" && wildcard?.toolCode) {
    return [String(wildcard.toolCode)];
  }

  const profile = envString("BYCLAW_OPENCLAW_TOOL_PROFILE", "coding");
  const byProfile = bundledTools
    .filter((item) => Array.isArray(item?.profiles) && item.profiles.includes(profile))
    .map((item) => String(item.toolCode || ""))
    .filter(Boolean);
  if (byProfile.length) return byProfile;

  return bundledTools.map((item) => String(item?.toolCode || "")).filter(Boolean);
}

function selectDigitalEmployeeTemplate(templates) {
  const effectiveOwnerType = ownerType === "personal" ? "personal" : "enterprise";
  const list = Array.isArray(templates) ? templates : [];
  const ownerTemplates = list.filter((item) => item?.ownerType === effectiveOwnerType);
  if (effectiveOwnerType === "personal") {
    return (
      ownerTemplates.find((item) => item?.key === "BYCLAW_ASSISTANT") ||
      ownerTemplates.find((item) => item?.agentType === agentType) ||
      ownerTemplates[0] ||
      {}
    );
  }
  return ownerTemplates.find((item) => item?.agentType === agentType) || ownerTemplates[0] || {};
}

function mapTemplatePromptsToConfigList(template) {
  const prompts = Array.isArray(template?.prompts) ? template.prompts : [];
  return prompts.map((item, index) => ({
    paramGroupCode: template?.key || "TEMPLATE_DIGITAL_EMPLOYEE",
    paramName: item?.name || item?.key || "",
    paramEnName: item?.enName || item?.key || "",
    paramValue: item?.defaultValue || "",
    paramSeq: index + 1,
    promptKey: item?.key || "",
    tip: item?.tip || "",
  }));
}

function fallbackTemplateData() {
  return [
    { paramName: "人格定义", paramEnName: "Persona", promptKey: "soul", paramValue: "" },
    { paramName: "工作规范", paramEnName: "Work Specification", promptKey: "agent", paramValue: "" },
    { paramName: "工具规范", paramEnName: "Tool Specification", promptKey: "tools", paramValue: "" },
    { paramName: "记忆规范", paramEnName: "Memory Specification", promptKey: "memory", paramValue: "" },
  ];
}

function rolePromptValue(role, key, templateValue, relTools = []) {
  const normalizedTemplateValue = String(templateValue || "").replace(/\\n/g, "\n").trim();
  const byclawValues = {
    soul: `你是 ByClaw 研发流程中的 ${role.name}。定位：${role.positioning}。主要输出：${role.output}。`,
    agent: [
      `围绕 ${role.roleCode} 职责工作，只处理当前 workflow step 的任务。`,
      "输出必须包含结论、依据、风险和下一步。",
      "需要外部动作、权限变更、发布或 destructive 操作时先请求确认。",
      "发现信息不足时列出缺口，不编造事实。",
      "所有 proof 必须可追踪到输入、工具结果或文件路径。"
    ].join("\n"),
    tools: `优先使用数字员工已关联的 OpenClaw bundled tools：${relTools.join(", ") || "未配置"}。调用工具前明确目的，调用后记录证据。`,
    memory: "仅记录可复用的项目约束、验收标准、关键决策和阻塞原因；不要记录密钥、token、个人敏感信息或临时噪声。"
  };
  const addition = byclawValues[key] || `${role.positioning}。输出：${role.output}。`;
  if (!normalizedTemplateValue) return addition;
  if (normalizedTemplateValue.includes("ByClaw")) return normalizedTemplateValue;
  return `${normalizedTemplateValue}\n\nByClaw 角色要求：\n${addition}`;
}

function buildCorePersonaDefinition(role, templates, relTools) {
  const selectedTemplate = selectDigitalEmployeeTemplate(templates);
  const templateData = mapTemplatePromptsToConfigList(selectedTemplate);
  const prompts = templateData.length ? templateData : fallbackTemplateData();
  return JSON.stringify(
    prompts.map((item) => {
      const key = normalizePromptConfigKey(item.promptKey || item.paramName, item);
      const value = rolePromptValue(role, key, item.paramValue, relTools);
      const prompt = {
        name: item.paramName || key,
        nameEn: item.paramEnName || key,
        key,
        value,
      };
      if (item.tip) prompt.tip = item.tip;
      return prompt;
    }),
    null,
    2
  );
}

function buildRuntime(role) {
  const headers = providerAuthorization
    ? {
        Authorization: providerAuthorization,
        ...(providerApiKey ? { "X-Api-Key": providerApiKey } : {})
      }
    : providerApiKey
      ? { "X-Api-Key": providerApiKey }
      : {};
  return {
    acpAgentId,
    modelRef: runtimeModel,
    provider: providerUrl ? ACP.providerAnthropicCompatible : ACP.providerClaudeCode,
    ...(providerUrl ? { url: providerUrl } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    requestDefaults: {
      temperature: 0.1,
      stream: true,
      enable_thinking: false,
      chat_template_kwargs: {
        enable_thinking: false
      }
    },
    output: role.output
  };
}

function buildDigitalEmployeePayload(role, templates, existing, relTools) {
  const name = `ByClaw ${role.name}`;
  const corePersonaDefinition = buildCorePersonaDefinition(role, templates, relTools);
  const prologue = {
    role: role.roleCode,
    background: role.positioning,
    descText: `${role.positioning}。主要输出：${role.output}。`,
    openingQuestion: JSON.stringify(["请说明本轮目标、约束和验收标准。", "请启动 ByClaw workflow 并给出 proof。"]),
    modelId: runtimeModel,
    modelInfo: {
      modelId: runtimeModel,
      model: runtimeModel,
      modelCode: runtimeModel,
      temperature: "0.1",
      history: 6
    }
  };
  return {
    ...(existing?.resourceId ? { resourceId: existing.resourceId } : {}),
    systemCode: "BYAI",
    resourceBizType: "DIG_EMPLOYEE",
    resourceType: "COMBIN",
    resourceName: name,
    resourceCode: resourceCode(role.roleCode),
    resourceDesc: role.positioning,
    ownerType,
    avatar: "default",
    agentType,
    agentDevType: "byai",
    createType: "FROM_MANUALLY",
    terminal: "ALL",
    homeType: "default",
    integrationType: "NONE",
    implType: "",
    workerAgentType: "",
    isFrontAccess: envBoolean(ENV.byclawDigEmployeeFrontAccess, false),
    prologue: JSON.stringify(prologue),
    ability: role.ability,
    constraints: role.constraints,
    faqs: role.faqs,
    processingFlow: role.processingFlow,
    personalityDimensions: "严谨、克制、证据优先、面向交付",
    wordPreferences: "使用清晰、可执行、可验证的工程语言。",
    sentenceAndTone: "直接给结论，必要时列证据和风险。",
    corePersonaDefinition,
    toolStandard: "工具调用必须记录目的、输入、输出和结论，不泄露密钥。",
    memoryStandard: "只保留可复用的约束、决策和 proof 摘要。",
    coreCompetencies: JSON.stringify([{ name: role.name, description: role.output }]),
    advancedSettings: JSON.stringify([
      { settingName: "byclawRole", settingDesc: role.roleCode },
      { settingName: "acpRuntime", settingDesc: `${acpAgentId}:${runtimeModel}` }
    ]),
    memoryConfigList: [],
    relIds: [],
    relTools,
    machineChannel: JSON.stringify([])
  };
}

function buildHeaders() {
  const extraHeaders = parseJson(envString("BYCLAW_API_EXTRA_HEADERS_JSON", ""), {});
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "Content-Type": "application/json",
    Origin: apiBaseUrl,
    Pragma: "no-cache",
    Referer: `${apiBaseUrl}/beyond/digitalEmployeesCreate?ownerType=${ownerType}`,
    "User-Agent": "ByClaw ACP Adapter Sync Script",
    language,
    ...extraHeaders,
  };
  const beyondToken = envString("BYCLAW_API_BEYOND_TOKEN", "");
  const ssoToken = envString("BYCLAW_API_SSO_TOKEN", "");
  const sessionId = envString("BYCLAW_API_SESSION_ID", "");
  const cookie = envString("BYCLAW_API_COOKIE", "");
  if (beyondToken) headers["Beyond-Token"] = beyondToken;
  if (ssoToken) headers["SSO-TOKEN"] = ssoToken;
  if (sessionId) headers["x-session-id"] = sessionId;
  if (cookie) headers.Cookie = cookie;
  return headers;
}

class ByclawApi {
  constructor() {
    this.headers = buildHeaders();
  }

  async post(path, payload) {
    const url = new URL(path, apiBaseUrl).toString();
    const response = await fetch(url, {
      method: HTTP.methods.post,
      headers: this.headers,
      body: JSON.stringify(payload ?? {}),
    });
    const text = await response.text();
    const parsed = text ? parseJson(text, text) : {};
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${path}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
    }
    if (parsed && typeof parsed === "object" && "code" in parsed && parsed.code !== 0) {
      throw new Error(`API ${path} failed: ${parsed.msg || JSON.stringify(parsed)}`);
    }
    return parsed?.data ?? parsed;
  }
}

function pageItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.list)) return value.list;
  if (Array.isArray(value?.records)) return value.records;
  if (Array.isArray(value?.data?.list)) return value.data.list;
  return [];
}

async function fetchTemplates(api) {
  const response = await api.post("/byaiService/system/staticdata/getDcSystemConfig", {
    paramCode: "TEMPLATE_DIGITAL_EMPLOYEE",
    language,
  });
  return parseTemplatePayload(response);
}

async function fetchBundledTools(api) {
  const response = await api.post("/byaiService/system/staticdata/getDcSystemConfig", {
    paramCode: "OPENCLAW_BUNDLED_TOOLS",
    language,
  });
  return parseBundledToolsPayload(response);
}

async function verifyRecommendedQuestions(api) {
  await api.post("/byaiService/system/staticdata/getDcSystemConfigListByStandType", {
    standType: "RECOMMENDED_QUESTIONS",
    language,
  });
}

async function findExistingEmployee(api, role) {
  const targetCode = resourceCode(role.roleCode);
  const targetName = `ByClaw ${role.name}`;
  const payloads = [
    {
      keyword: targetCode,
      includeAllResourceStatus: true,
      pageNum: 1,
      pageSize: 50,
    },
    {
      keyword: targetName,
      includeAllResourceStatus: true,
      pageNum: 1,
      pageSize: 50,
    },
  ];
  for (const payload of payloads) {
    for (const path of [
      "/byaiService/digitalEmployeeController/queryAllDigitalEmployeeList",
      "/byaiService/digitalEmployeeController/selectDigitalEmployeeByQo",
    ]) {
      try {
        const response = await api.post(path, payload);
        const match = pageItems(response).find(
          (item) => `${item?.resourceCode || ""}` === targetCode || `${item?.resourceName || ""}` === targetName
        );
        if (match?.resourceId) return match;
      } catch {
        // Some environments may expose only one of the query variants.
      }
    }
  }
  const cached = await findExistingEmployeeInRedis(targetCode, targetName);
  if (cached?.resourceId) return cached;
  return null;
}

async function findExistingEmployeeInRedis(targetCode, targetName) {
  const redis = new Redis(readRedisConfig());
  try {
    await redis.connect();
    const keys = await redis.command("KEYS", REDIS_KEYS.digitalEmployeePattern);
    if (!Array.isArray(keys) || !keys.length) return null;
    const values = await redis.command("MGET", ...keys);
    if (!Array.isArray(values)) return null;
    for (let index = 0; index < values.length; index += 1) {
      const parsed = parseJson(values[index], null);
      if (!parsed || typeof parsed !== "object") continue;
      if (`${parsed.resourceCode || ""}` === targetCode || `${parsed.resourceName || ""}` === targetName) {
        return {
          resourceId:
            parsed.resourceId ||
            parsed.id ||
            (String(keys[index]).startsWith(REDIS_KEYS.digitalEmployeePrefix)
              ? String(keys[index]).slice(REDIS_KEYS.digitalEmployeePrefix.length)
              : String(keys[index])),
          resourceCode: parsed.resourceCode,
          resourceName: parsed.resourceName
        };
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    redis.close();
  }
}

async function upsertEmployee(api, role, templates, relTools) {
  const existing = await findExistingEmployee(api, role);
  const payload = buildDigitalEmployeePayload(role, templates, existing, relTools);
  const path = existing?.resourceId
    ? "/byaiService/digitalEmployeeController/updateDigitalEmployee"
    : "/byaiService/digitalEmployeeController/saveDigitalEmployee";
  try {
    const result = await api.post(path, payload);
    return { role, payload, result, action: existing?.resourceId ? "updated" : "created" };
  } catch (error) {
    if (
      !existing?.resourceId &&
      (String(error?.message || "").includes("duplicate") || String(error?.message || "").includes("已经被使用"))
    ) {
      const duplicate = await findExistingEmployee(api, role);
      if (duplicate?.resourceId) {
        const updatePayload = buildDigitalEmployeePayload(role, templates, duplicate, relTools);
        const result = await api.post("/byaiService/digitalEmployeeController/updateDigitalEmployee", updatePayload);
        return { role, payload: updatePayload, result, action: "updated" };
      }
    }
    throw error;
  }
}

function employeeResourceId(item) {
  return String(item?.result?.resourceId || item?.payload?.resourceId || item?.result?.id || "");
}

function buildCachedEmployee(item) {
  const resourceId = employeeResourceId(item);
  return {
    ...item.result,
    id: resourceId,
    resourceId,
    resourceCode: item.result?.resourceCode || item.payload.resourceCode,
    resourceName: item.result?.resourceName || item.payload.resourceName,
    name: item.result?.resourceName || item.payload.resourceName,
    resourceBizType: "DIG_EMPLOYEE",
    resourceDesc: item.result?.resourceDesc || item.payload.resourceDesc,
    resourceStatus: item.result?.resourceStatus ?? "1",
    userCode,
    agentRole: item.role.roleCode,
    openclawAgentId: `baiying-agent-${resourceId}`,
    runtime: buildRuntime(item.role),
    prologue: item.result?.prologue || item.payload.prologue,
    relTools: item.payload.relTools,
  };
}

function buildTeamWorkflowLoop(upserted) {
  const byRole = Object.fromEntries(upserted.map((item) => [item.role.roleCode, employeeResourceId(item)]));
  const memberAgentIds = roles.map((role) => byRole[role.roleCode]).filter(Boolean);
  const team = {
    id: "rd-core",
    name: "ByClaw R&D Core Team",
    coordinatorAgentId: byRole.orchestrator,
    memberAgentIds,
    policy: {
      makerChecker: true,
      stateAuthority: "openclaw-sqlite",
      outboundChannel: "byai-channel",
      source: "byclaw-be-204"
    }
  };
  const workflow = {
    id: "feature-delivery",
    name: "ByClaw Feature Delivery Workflow",
    teamId: team.id,
    steps: [
      { id: "triage", name: "Discovery", agentId: byRole["issue-triage"], instruction: "归并事件，形成结构化需求池和优先级。" },
      { id: "prd", name: "Planning PRD", agentId: byRole["req-analyst"], instruction: "输出 PRD-lite、scope 与验收标准。" },
      { id: "design", name: "Architecture", agentId: byRole["arch-designer"], instruction: "锁定接口、数据流、风险与测试策略。" },
      { id: "implement", name: "Implementation", agentId: byRole.coder, instruction: "按 card 实现，产出 proof 与变更说明。" },
      { id: "review", name: "Review", agentId: byRole.reviewer, instruction: "独立 code review，给出 findings/verdict。" },
      { id: "test", name: "Verification", agentId: byRole.tester, instruction: "执行测试策略，给出 test report 和 health score。" },
      { id: "ship", name: "Shipping", agentId: byRole.shipper, instruction: "准备 PR、CI proof 和 release note。" }
    ].filter((step) => step.agentId)
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
  return { team, workflow, loop };
}

function buildModelConfigs() {
  return {
    [runtimeModel]: {
      modelId: runtimeModel,
      modelCode: runtimeModel,
      modelName: runtimeModel,
      provider: ACP.providerClaudeCode,
      modelType: "LLM",
      enabled: true,
      runtime: ACP.runtime,
      agentId: acpAgentId
    }
  };
}

async function writeRedis(upserted, options) {
  const redis = new Redis(readRedisConfig());
  await redis.connect();

  if (options.deleteOldMock) {
    const oldIds = ["900001", "900002", "900003", "900004", "900005", "900006", "900007", "900008", "900009"];
    await redis.command("DEL", ...oldIds.map((id) => `${REDIS_KEYS.digitalEmployeePrefix}${id}`));
    await redis.hdel(`${REDIS_KEYS.userResourcesAuthPrefix}:${userCode}`, oldIds);
  }

  const cachedEmployees = upserted.map(buildCachedEmployee);
  for (const employee of cachedEmployees) {
    await redis.setJson(`${REDIS_KEYS.digitalEmployeePrefix}${employee.resourceId}`, employee);
    await redis.hset(`${REDIS_KEYS.userResourcesAuthPrefix}:${userCode}`, {
      [employee.resourceId]: REDIS_KEYS.authorizedValue,
    });
    await redis.command(
      "PUBLISH",
      REDIS_KEYS.digitalEmployeeChangeChannel,
      JSON.stringify({ eventType: "UPSERT", resourceId: employee.resourceId, userCode, source: "byclaw-be-204" })
    );
  }

  const { team, workflow, loop } = buildTeamWorkflowLoop(upserted);
  await redis.setJson(`${REDIS_KEYS.teamPrefix}${team.id}`, team);
  await redis.setJson(`${REDIS_KEYS.workflowPrefix}${workflow.id}`, workflow);
  await redis.setJson(`${REDIS_KEYS.loopPrefix}${loop.id}`, loop);

  const modelConfigs = buildModelConfigs();
  await redis.hset(REDIS_KEYS.aimodelConfig, modelConfigs);
  await redis.hset(REDIS_KEYS.aimodelTypeList, {
    [REDIS_KEYS.typeListLlmField]: Object.values(modelConfigs),
  });
  redis.close();

  return { cachedEmployees, team, workflow, loop };
}

function validateApiEnv(options) {
  if (options.dryRun) return;
  const missing = [];
  if (!envString("BYCLAW_API_BEYOND_TOKEN", "")) missing.push("BYCLAW_API_BEYOND_TOKEN");
  if (!envString("BYCLAW_API_SSO_TOKEN", "")) missing.push("BYCLAW_API_SSO_TOKEN");
  if (!envString("BYCLAW_API_SESSION_ID", "")) missing.push("BYCLAW_API_SESSION_ID");
  if (!envString("BYCLAW_API_COOKIE", "")) missing.push("BYCLAW_API_COOKIE");
  if (missing.length) {
    throw new Error(`Missing API auth env: ${missing.join(", ")}. Do not put token values in repo files.`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  validateApiEnv(options);

  if (options.dryRun) {
    const relTools = ["*"];
    const payloads = roles.map((role) => buildDigitalEmployeePayload(role, [], null, relTools));
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          apiBaseUrl,
          userCode,
          ownerType,
          relTools,
          roles: payloads.map((payload) => ({
            resourceCode: payload.resourceCode,
            resourceName: payload.resourceName,
            corePersonaDefinitionItems: parseJson(payload.corePersonaDefinition, []).length,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  const api = new ByclawApi();
  await verifyRecommendedQuestions(api);
  const templates = await fetchTemplates(api);
  const bundledTools = await fetchBundledTools(api);
  const relTools = selectRelTools(bundledTools);
  if (!relTools.length) {
    throw new Error("OPENCLAW_BUNDLED_TOOLS returned no selectable toolCode.");
  }

  const upserted = [];
  for (const role of roles) {
    const item = await upsertEmployee(api, role, templates, relTools);
    upserted.push(item);
    console.log(`${item.action}: ${item.payload.resourceCode} -> ${employeeResourceId(item)}`);
  }

  const redisState = options.skipRedis ? null : await writeRedis(upserted, options);

  console.log(
    JSON.stringify(
      {
        ok: true,
        userCode,
        source: "byclaw-be-204",
        ownerType,
        relTools,
        bundledToolsCount: bundledTools.length,
        employees: upserted.map((item) => ({
          role: item.role.roleCode,
          action: item.action,
          resourceId: employeeResourceId(item),
          resourceCode: item.payload.resourceCode,
        })),
        team: redisState?.team?.id,
        workflow: redisState?.workflow?.id,
        loop: redisState?.loop?.id,
        redis: !options.skipRedis,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
