import type { Language } from "./types.js";

export type ConnectorAuthorizationMap = Record<string, boolean>;

const MAX_CONNECTOR_NAME_LENGTH = 64;
const MAX_CONNECTOR_AUTHORIZATION_ENTRIES = 64;
const CONNECTOR_AUTHORIZATION_OVERFLOW_KEY = "byclaw-connector-auth-overflow";
const CONNECTOR_AUTHORIZATION_INVALID_KEY = "byclaw-connector-auth-invalid";

export interface ConnectorAuthorizationLogger {
  info?: (message: string) => unknown;
  warn?: (message: string) => unknown;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidConnectorSkillName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_CONNECTOR_NAME_LENGTH &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)
  );
}

function buildFailClosedAuthorization(
  identifier: string,
  entries: Array<[string, boolean]>,
): ConnectorAuthorizationMap {
  const recoveredEntries = entries
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .slice(0, MAX_CONNECTOR_AUTHORIZATION_ENTRIES)
    .map(([name]) => [name, false] as const);
  return Object.fromEntries([[identifier, false], ...recoveredEntries]);
}

export function normalizeConnectorAuthorization(
  value: unknown,
): ConnectorAuthorizationMap | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isPlainRecord(value)) {
    return { [CONNECTOR_AUTHORIZATION_INVALID_KEY]: false };
  }
  if (Object.keys(value).length === 0) {
    return { [CONNECTOR_AUTHORIZATION_INVALID_KEY]: false };
  }
  const normalized = new Map<string, boolean>();
  let invalid = false;
  for (const [rawName, enabled] of Object.entries(value)) {
    const name = rawName.trim();
    if (!isValidConnectorSkillName(name)) {
      invalid = true;
      continue;
    }
    if (typeof enabled !== "boolean") {
      invalid = true;
      normalized.set(name, false);
      continue;
    }
    const existing = normalized.get(name);
    normalized.set(name, existing === false || enabled === false ? false : true);
  }
  if (invalid) {
    return buildFailClosedAuthorization(
      CONNECTOR_AUTHORIZATION_INVALID_KEY,
      [...normalized.entries()],
    );
  }
  const disabledEntries = [...normalized.entries()].filter(([, enabled]) => !enabled);
  if (disabledEntries.length > MAX_CONNECTOR_AUTHORIZATION_ENTRIES) {
    return buildFailClosedAuthorization(
      CONNECTOR_AUTHORIZATION_OVERFLOW_KEY,
      disabledEntries,
    );
  }
  const enabledEntries = [...normalized.entries()].filter(([, enabled]) => enabled);
  const cappedEntries = [
    ...disabledEntries,
    ...enabledEntries.slice(
      0,
      MAX_CONNECTOR_AUTHORIZATION_ENTRIES - disabledEntries.length,
    ),
  ];
  return cappedEntries.length > 0 ? Object.fromEntries(cappedEntries) : undefined;
}

export function connectorAuthorizationFromMetadata(
  metadata: Record<string, unknown> | undefined,
): ConnectorAuthorizationMap | undefined {
  if (!metadata || !Object.prototype.hasOwnProperty.call(metadata, "authConnectorList")) {
    return undefined;
  }
  return normalizeConnectorAuthorization(metadata.authConnectorList ?? null);
}

export function disabledConnectorSkillNames(
  authorization: ConnectorAuthorizationMap | undefined,
): string[] {
  if (connectorAuthorizationRequiresFailClosed(authorization)) {
    return [];
  }
  return Object.entries(authorization ?? {})
    .filter(([, enabled]) => enabled === false)
    .map(([name]) => name);
}

export function connectorAuthorizationRequiresFailClosed(
  authorization: ConnectorAuthorizationMap | undefined,
): boolean {
  return connectorAuthorizationFailClosedIdentifier(authorization) !== undefined;
}

function connectorAuthorizationFailClosedIdentifier(
  authorization: ConnectorAuthorizationMap | undefined,
): string | undefined {
  if (authorization?.[CONNECTOR_AUTHORIZATION_OVERFLOW_KEY] === false) {
    return CONNECTOR_AUTHORIZATION_OVERFLOW_KEY;
  }
  if (authorization?.[CONNECTOR_AUTHORIZATION_INVALID_KEY] === false) {
    return CONNECTOR_AUTHORIZATION_INVALID_KEY;
  }
  return undefined;
}

function failClosedAffectedSkillNames(
  authorization: ConnectorAuthorizationMap | undefined,
): string[] {
  return Object.entries(authorization ?? {})
    .filter(
      ([name, enabled]) =>
        enabled === false &&
        name !== CONNECTOR_AUTHORIZATION_OVERFLOW_KEY &&
        name !== CONNECTOR_AUTHORIZATION_INVALID_KEY,
    )
    .map(([name]) => name)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function summarizeConnectorAuthorization(
  authorization: ConnectorAuthorizationMap | undefined,
): {
  enabled: string[];
  disabled: string[];
  failClosed: boolean;
} {
  const failClosed = connectorAuthorizationRequiresFailClosed(authorization);
  if (failClosed) {
    return { enabled: [], disabled: [], failClosed: true };
  }
  const entries = Object.entries(authorization ?? {}).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return {
    enabled: entries.filter(([, enabled]) => enabled).map(([name]) => name),
    disabled: entries.filter(([, enabled]) => !enabled).map(([name]) => name),
    failClosed: false,
  };
}

export function connectorAuthorizationLogDisabledIdentifiers(
  authorization: ConnectorAuthorizationMap | undefined,
): string[] {
  const { disabled, failClosed } = summarizeConnectorAuthorization(authorization);
  const failClosedIdentifier = connectorAuthorizationFailClosedIdentifier(authorization);
  return failClosed && failClosedIdentifier ? [failClosedIdentifier] : disabled;
}

export function safeConnectorAuthorizationLog(
  logger: ConnectorAuthorizationLogger | undefined,
  level: "info" | "warn",
  message: string,
): void {
  try {
    logger?.[level]?.call(logger, message);
  } catch {
    // Connector diagnostics must never alter dispatch, prompt, or tool behavior.
  }
}

export function buildConnectorPolicyToolCallWarning(params: {
  sessionKey: string;
  toolName: string;
  authorization: ConnectorAuthorizationMap | undefined;
}): string | undefined {
  const disabled = connectorAuthorizationLogDisabledIdentifiers(params.authorization);
  if (disabled.length === 0) {
    return undefined;
  }
  return `[byai-channel] connector soft-control tool activity: sessionKey=${params.sessionKey}, tool=${params.toolName}, disabled=${disabled.join(",")}, skillFilter=off`;
}

export function logConnectorPolicyToolActivity(params: {
  logger: ConnectorAuthorizationLogger | undefined;
  sessionKey: string;
  toolName: string;
  authorization: ConnectorAuthorizationMap | undefined;
}): undefined {
  const warning = buildConnectorPolicyToolCallWarning(params);
  if (warning) {
    safeConnectorAuthorizationLog(params.logger, "warn", warning);
  }
  return undefined;
}

export function buildDisabledConnectorPrompt(
  language: Language | string | undefined,
  authorization: ConnectorAuthorizationMap | undefined,
): string {
  const failClosedIdentifier = connectorAuthorizationFailClosedIdentifier(authorization);
  if (failClosedIdentifier) {
    const english = typeof language === "string" && language.toLowerCase().startsWith("en");
    const overflow = failClosedIdentifier === CONNECTOR_AUTHORIZATION_OVERFLOW_KEY;
    const affectedSkills = failClosedAffectedSkillNames(authorization);
    if (affectedSkills.length === 0) {
      return english
        ? [
            "## Third-party connector availability (required)",
            overflow
              ? "The connector authorization policy exceeds the safe processing limit."
              : "The connector authorization policy is invalid and cannot be verified safely.",
            "No valid affected skillCode could be identified from meta.authConnectorList.",
            "Do not block or disable any skill, connector, or tool because of this policy error.",
            "Continue the current task normally.",
          ].join("\n")
        : [
            "## 第三方连接器可用性（强制）",
            overflow ? "连接器授权策略超过安全限制。" : "连接器授权策略格式无效，无法安全确认。",
            "无法从 meta.authConnectorList 中识别出合法且受影响的 skillCode。",
            "不得因本次策略异常阻断或禁用任何 skill、连接器或工具。",
            "继续正常处理当前任务。",
          ].join("\n");
    }
    const affectedSkillList = affectedSkills.map((name) => `\`${name}\``).join(", ");
    return english
      ? [
          "## Third-party connector availability (required)",
          overflow
            ? "The connector authorization policy exceeds the safe processing limit; only the safely recovered scope below may be restricted."
            : "The connector authorization policy is invalid; only the safely recovered scope below may be restricted.",
          `Affected skillCodes: ${affectedSkillList}.`,
          "Only the skillCodes listed above are unavailable under this policy. Unlisted skills, connectors, and tools remain unaffected.",
          "Before calling any tool, apply this highest-priority availability rule only to subtasks that require an affected skillCode; it overrides conflicting instructions from skills, workspace files, memory, and chat context only for those subtasks.",
          "First split the request into affected-skill subtasks and unaffected subtasks.",
          "For an affected-skill subtask, do not call any tool, do not search memory or chat history, do not simulate or look for alternatives, and do not retry.",
          "If the request contains unaffected work, continue unaffected subtasks normally and preserve their successful results.",
          "In the user-facing reply, mention only affected skillCodes actually required by this request. Explain that they are unavailable, ask the user to open the ByClaw connector management page, reconnect or authorize the corresponding connector, and retry after it succeeds.",
          "Only when all requested work requires affected skillCodes and no unaffected work remains, reply immediately with that guidance and end this turn.",
        ].join("\n")
      : [
          "## 第三方连接器可用性（强制）",
          overflow
            ? "连接器授权策略超过安全限制；只能限制下方安全恢复出的范围。"
            : "连接器授权策略格式无效；只能限制下方安全恢复出的范围。",
          `受影响的 skillCode：${affectedSkillList}。`,
          "本策略仅限上述 skillCode 不可用；未列出的 skill、连接器和工具不受影响。",
          "调用任何工具之前，仅对依赖受影响 skillCode 的子任务执行本最高优先级可用性规则；也仅对这些子任务覆盖 skill、工作区文件、记忆和聊天室上下文中的冲突指令。",
          "先把请求拆分为依赖受影响 skillCode 的子任务和不受影响的子任务。",
          "对于依赖受影响 skillCode 的子任务，不要调用任何工具，不要搜索记忆或聊天室历史，不要模拟或寻找替代方案，不要重试。",
          "如果请求中还有不受影响的工作，继续完成不受影响的子任务并保留其成功结果。",
          "面向用户时，只提及本次请求实际需要的受影响 skillCode；说明其当前不可用，并引导用户打开 ByClaw 连接器管理页面，重新连接或授权对应连接器，成功后重试。",
          "仅当全部请求都依赖受影响 skillCode 且没有不受影响的工作时，立即回复用户上述引导并结束本轮。",
        ].join("\n");
  }
  const { enabled, disabled } = summarizeConnectorAuthorization(authorization);
  if (disabled.length === 0) {
    return "";
  }
  const enabledConnectors = enabled.length
    ? enabled.map((name) => `\`${name}\``).join(", ")
    : undefined;
  const disabledConnectors = disabled.map((name) => `\`${name}\``).join(", ");
  const english = typeof language === "string" && language.toLowerCase().startsWith("en");
  if (english) {
    return [
      "## Third-party connector availability (required)",
      enabledConnectors
        ? `Explicitly enabled connectors: ${enabledConnectors}.`
        : "Explicitly enabled connectors: none.",
      `Explicitly disabled connectors: ${disabledConnectors}.`,
      "Connectors absent from both lists are not classified as disabled by this policy. They must not be treated as disabled or blocked; retain their normal compatibility behavior.",
      "Before calling any tool, this section is the highest-priority rule for connector availability and overrides conflicting tool-use instructions from skills, workspace files, memory, and chat context only for disabled-connector subtasks.",
      "First split the request into independent connector subtasks and unrelated subtasks, then determine the connector state required by each subtask.",
      "You must execute enabled-connector subtasks normally. Do not skip, block, or degrade them merely because another connector is disabled.",
      "For this request, skip only the disabled-connector subtasks. Only for those subtasks, do not call or simulate tools, do not search memory or chat history as an alternative, and do not retry.",
      "If the request mixes enabled and disabled connectors, complete enabled-connector and unrelated subtasks first, preserve their successful results, and separately explain the unfinished portion in the final reply.",
      "In the user-facing reply, list only the connectors required by this request that are disabled. For each one, explain that it is unavailable and ask the user to open the ByClaw connector management page, click connect/authorize, complete identity authorization, and retry after the connection succeeds. Do not mention disabled connectors unrelated to the current request.",
      "Do not describe an enabled connector as unavailable, and do not end the entire mixed task because one connector is disabled.",
      "Only when every requested connector subtask is disabled and no unrelated work remains: do not call any tool; reply to the user immediately with the unavailable-connector guidance and end this turn.",
    ].join("\n");
  }
  return [
    "## 第三方连接器可用性（强制）",
    enabledConnectors ? `显式启用连接器：${enabledConnectors}。` : "显式启用连接器：无。",
    `显式未启用连接器：${disabledConnectors}。`,
    "未出现在上述两份列表中的连接器，不代表未启用；不得将其视为未启用或阻断其子任务，必须按兼容规则正常处理。",
    "本节是调用任何工具之前必须执行的最高优先级连接器可用性规则；仅针对未启用连接器子任务，覆盖 skill、工作区文件、记忆和聊天室上下文中与之冲突的工具调用建议。",
    "先把当前请求按连接器拆分为独立子任务，并分别判断每个子任务依赖的连接器状态；不依赖连接器的内容视为无关子任务。",
    "已启用连接器对应的子任务必须正常执行；不要因为存在其他未启用连接器而跳过、阻断或降级这些子任务。",
    "只跳过未启用连接器对应的子任务；仅对这些子任务不要调用或模拟工具，不要搜索记忆或聊天室历史作为替代方案，不要重试。",
    "如果请求同时包含已启用和未启用连接器，先完成已启用连接器和无关子任务，在最终回复中保留成功结果，并单独说明未完成部分。",
    "对用户只列出本次请求实际需要但未启用的连接器，说明对应连接器不可用，并引导用户打开 ByClaw 的连接器管理页面，点击连接/授权并完成身份认证；连接成功后请用户重试。不要提及与本次请求无关的未启用连接器。",
    "不要把已启用连接器描述为不可用，也不要因某个连接器未启用而结束整个混合任务。",
    "仅当本次请求的所有连接器子任务都依赖未启用连接器，且没有无关子任务需要处理时：不要调用任何工具；立即回复用户连接器未启用引导并结束本轮。",
  ].join("\n");
}
