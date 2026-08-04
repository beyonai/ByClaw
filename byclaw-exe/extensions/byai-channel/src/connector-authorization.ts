import type { Language } from "./types.js";

export type ConnectorAuthorizationMap = Record<string, boolean>;

const MAX_CONNECTOR_NAME_LENGTH = 64;
const MAX_CONNECTOR_AUTHORIZATION_ENTRIES = 64;
const CONNECTOR_AUTHORIZATION_OVERFLOW_KEY = "byclaw-connector-auth-overflow";

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
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const normalized = new Map<string, boolean>();
  for (const [rawName, enabled] of Object.entries(value)) {
    const name = rawName.trim();
    if (!isValidConnectorSkillName(name) || typeof enabled !== "boolean") {
      continue;
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
  return normalizeConnectorAuthorization(metadata?.authConnectorList);
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
  return authorization?.[CONNECTOR_AUTHORIZATION_OVERFLOW_KEY] === false;
}

export function buildDisabledConnectorPrompt(
  language: Language | string | undefined,
  authorization: ConnectorAuthorizationMap | undefined,
): string {
  if (connectorAuthorizationRequiresFailClosed(authorization)) {
    const english = typeof language === "string" && language.toLowerCase().startsWith("en");
    return english
      ? [
          "## Third-party connector availability (required)",
          "The connector authorization policy exceeds the safe processing limit. Treat every third-party connector as unavailable for this conversation and do not call or simulate connector skills.",
          "Explain that connector availability cannot be verified safely. Ask the user to open the ByClaw connector management page, reconnect or authorize the required connector, and retry.",
        ].join("\n")
      : [
          "## 第三方连接器可用性（强制）",
          "连接器授权策略超过安全限制。本会话必须将所有第三方连接器视为不可用，不要调用或模拟任何连接器 skill。",
          "请说明当前无法安全确认连接器可用性，并引导用户打开 ByClaw 的连接器管理页面，重新连接或授权所需连接器后重试。",
        ].join("\n");
  }
  const disabled = disabledConnectorSkillNames(authorization);
  if (disabled.length === 0) {
    return "";
  }
  const connectors = disabled.map((name) => `\`${name}\``).join(", ");
  const english = typeof language === "string" && language.toLowerCase().startsWith("en");
  if (english) {
    return [
      "## Third-party connector availability (required)",
      `The following third-party connectors are currently not connected or authorized for this conversation: ${connectors}.`,
      "If the user's intent requires any connector above, do not call or simulate its skill and do not claim that the requested operation succeeded.",
      "Explain that the connector is unavailable and the operation cannot be completed. Ask the user to open the ByClaw connector management page, find the connector, click connect/authorize, complete identity authorization, and retry after the connection succeeds.",
    ].join("\n");
  }
  return [
    "## 第三方连接器可用性（强制）",
    `本会话以下第三方连接器当前处于未连接或未授权状态：${connectors}。`,
    "如果用户意图需要其中任一连接器，不要调用或模拟对应 skill，也不要声称相关操作已经成功。",
    "请明确说明该连接器不可用、当前无法完成相关操作，并引导用户打开 ByClaw 的连接器管理页面，找到对应连接器，点击连接/授权并完成身份认证；连接成功后请用户重试。",
  ].join("\n");
}
