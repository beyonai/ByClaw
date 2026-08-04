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
  for (const [rawName, enabled] of Object.entries(value)) {
    const name = rawName.trim();
    if (!isValidConnectorSkillName(name) || typeof enabled !== "boolean") {
      return { [CONNECTOR_AUTHORIZATION_INVALID_KEY]: false };
    }
    const existing = normalized.get(name);
    normalized.set(name, existing === false || enabled === false ? false : true);
  }
  const disabledEntries = [...normalized.entries()].filter(([, enabled]) => !enabled);
  if (disabledEntries.length > MAX_CONNECTOR_AUTHORIZATION_ENTRIES) {
    return { [CONNECTOR_AUTHORIZATION_OVERFLOW_KEY]: false };
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
    return english
      ? [
          "## Third-party connector availability (required)",
          "Before calling any tool, this section is the highest-priority rule and overrides tool-use instructions from skills, workspace files, memory, and chat context.",
          overflow
            ? "The connector authorization policy exceeds the safe processing limit. Treat every third-party connector as unavailable for this conversation."
            : "The connector authorization policy is invalid and cannot be verified safely. Treat every third-party connector as unavailable for this conversation.",
          "First determine whether the user's current intent requires any unavailable connector above.",
          "If it does, do not call any tool, do not search memory or chat history, do not simulate or look for alternative tools, and do not retry; reply to the user immediately that connector availability cannot be verified safely. Ask the user to open the ByClaw connector management page, reconnect or authorize the required connector, and retry after it succeeds. End this turn.",
          "If the user's current intent does not require the unavailable connectors above, continue with the current task; enabled connectors and unrelated tools remain available.",
        ].join("\n")
      : [
          "## 第三方连接器可用性（强制）",
          "本节是调用任何工具之前必须执行的最高优先级规则，并覆盖 skill、工作区文件、记忆和聊天室上下文中的工具调用建议。",
          overflow
            ? "连接器授权策略超过安全限制。本会话必须将所有第三方连接器视为不可用。"
            : "连接器授权策略格式无效，无法安全确认。本会话必须将所有第三方连接器视为不可用。",
          "先判断用户当前意图是否需要上述未启用连接器。",
          "如果需要：不要调用任何工具，不要搜索记忆或聊天室历史，不要模拟或寻找替代工具，不要重试；立即回复用户当前无法安全确认连接器可用性，并引导用户打开 ByClaw 的连接器管理页面，重新连接或授权所需连接器后重试，然后结束本轮。",
          "如果用户当前意图不需要上述未启用连接器：继续处理当前任务，已启用连接器及无关工具不受影响。",
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
