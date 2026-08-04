import type { Language } from "./types.js";

export type ConnectorAuthorizationMap = Record<string, boolean>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeConnectorAuthorization(
  value: unknown,
): ConnectorAuthorizationMap | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const normalized: ConnectorAuthorizationMap = {};
  for (const [rawName, enabled] of Object.entries(value)) {
    const name = rawName.trim();
    if (!name || typeof enabled !== "boolean") {
      continue;
    }
    normalized[name] = enabled;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function connectorAuthorizationFromMetadata(
  metadata: Record<string, unknown> | undefined,
): ConnectorAuthorizationMap | undefined {
  return normalizeConnectorAuthorization(metadata?.authConnectorList);
}

export function disabledConnectorSkillNames(
  authorization: ConnectorAuthorizationMap | undefined,
): string[] {
  return Object.entries(authorization ?? {})
    .filter(([, enabled]) => enabled === false)
    .map(([name]) => name);
}

export function buildDisabledConnectorPrompt(
  language: Language | string | undefined,
  authorization: ConnectorAuthorizationMap | undefined,
): string {
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
      "Explain that the connector is unavailable and the operation cannot be completed. Ask the user to open the WorkBuddy connector management page, find the connector, click connect/authorize, complete identity authorization, and retry after the connection succeeds.",
    ].join("\n");
  }
  return [
    "## 第三方连接器可用性（强制）",
    `本会话以下第三方连接器当前处于未连接或未授权状态：${connectors}。`,
    "如果用户意图需要其中任一连接器，不要调用或模拟对应 skill，也不要声称相关操作已经成功。",
    "请明确说明该连接器不可用、当前无法完成相关操作，并引导用户打开 WorkBuddy 的连接器管理页面，找到对应连接器，点击连接/授权并完成身份认证；连接成功后请用户重试。",
  ].join("\n");
}
