import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  parseGroupChatRef,
  type GroupChatRefV1,
  THINKING_LEVELS,
  isThinkingLevel,
  normalizeRunAttachments,
  type CallerPrincipal,
  type RunAttachment,
  type RunEvent,
  type SessionContextInput,
  type ThinkingLevel,
} from "@byclaw/by-conductor";
import {
  type AskAgentCommand,
  type GatewayCommand,
} from "@byclaw/by-framework";

/**
 * by-framework 协议的解析和序列化辅助函数。
 * 这里不访问 Redis、Repository 或 RunService，便于单独阅读和测试协议细节。
 */

/** 从 AskAgent 的多种内容表示中提取最后一条非空用户文本。 */
export function extractMessage(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    for (let index = content.length - 1; index >= 0; index -= 1) {
      const message = extractMessage(content[index]);
      if (message) {
        return message;
      }
    }
    return "";
  }
  if (!isRecord(content)) {
    return "";
  }
  if (typeof content.text === "string") {
    return content.text.trim();
  }
  return extractMessage(content.content);
}

/** Worker 从用户输入解析出的文本与附件。 */
export interface WorkerUserInput {
  message: string;
  attachments: RunAttachment[];
}

/**
 * 从 AskAgent content 同时提取最后一条用户消息的文本与附件。
 *
 * 规则：
 * - 兼容纯字符串 content。
 * - 数组中选最后一条 `role === "user"`，从其 content 的同一对象读 text 与 files，
 *   避免跨历史消息拼接附件；无 user 角色时回退到旧递归文本提取（不带附件）。
 * - files 存在但格式非法时由 normalizeRunAttachments 抛错，调用方转为失败事件，
 *   不静默丢弃。
 * - message 可能为空（仅有附件），由 ingress 的 resolveRunMessage 兜底成稳定提示。
 */
export function extractUserInput(content: unknown): WorkerUserInput {
  if (typeof content === "string") {
    return { message: content.trim(), attachments: [] };
  }
  if (Array.isArray(content)) {
    for (let index = content.length - 1; index >= 0; index -= 1) {
      const entry = content[index];
      if (isRecord(entry) && entry.role === "user") {
        return readTextAndFiles(entry.content);
      }
    }
    return { message: extractMessage(content), attachments: [] };
  }
  if (isRecord(content)) {
    return readTextAndFiles(content);
  }
  return { message: "", attachments: [] };
}

/** 从 text/files 节点（或其 .content 子节点）读取文本与附件。 */
function readTextAndFiles(node: unknown): WorkerUserInput {
  if (typeof node === "string") {
    return { message: node.trim(), attachments: [] };
  }
  if (!isRecord(node)) {
    return { message: "", attachments: [] };
  }
  // 下钻到承载 text/files 的节点：当前节点有 text 或 files 即采用，否则沿 .content 查找
  const target = hasTextOrFiles(node) ? node : resolveContentNode(node.content);
  if (!target) {
    return { message: extractMessage(node), attachments: [] };
  }
  const text = typeof target.text === "string" ? target.text.trim() : "";
  const files = target.files;
  if (files === undefined || files === null) {
    return { message: text, attachments: [] };
  }
  return {
    message: text,
    attachments: normalizeRunAttachments(files, "by-framework"),
  };
}

/** 节点是否承载 text 或 files（任一即可，支持"仅附件"消息）。 */
function hasTextOrFiles(node: Record<string, unknown>): boolean {
  return typeof node.text === "string" || "files" in node;
}

/** 沿 .content 下钻到承载 text/files 的节点。 */
function resolveContentNode(
  node: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(node)) {
    return undefined;
  }
  if (hasTextOrFiles(node)) {
    return node;
  }
  return resolveContentNode(node.content);
}

/** 按大小写不敏感方式从 command metadata 或 extraPayload 读取字符串字段。 */
export function commandString(
  command: {
    header: { metadata: Readonly<Record<string, unknown>> };
    extraPayload?: Readonly<Record<string, unknown>>;
  },
  key: string,
): string {
  return (
    recordString(command.header.metadata, key) ||
    recordString(command.extraPayload ?? {}, key)
  );
}

/**
 * 从 by-framework metadata/extraPayload 读取前端环境信息。
 * `language` 兼容既有 i18n 头，`locale` 为规范字段；时区必须由调用端显式传递，
 * 避免根据语言猜测用户所在地区。
 */
export function commandSessionContext(command: {
  header: { metadata: Readonly<Record<string, unknown>> };
  extraPayload?: Readonly<Record<string, unknown>>;
}): SessionContextInput | undefined {
  const locale =
    commandString(command, "locale") || commandString(command, "language");
  const timezone =
    commandString(command, "timezone") ||
    commandString(command, "time-zone") ||
    commandString(command, "time_zone");
  if (!locale && !timezone) {
    return undefined;
  }
  return {
    ...(locale ? { locale } : {}),
    ...(timezone ? { timezone } : {}),
  };
}

/** 思考等级属于调用业务参数，只从 AskAgent extraPayload 读取。 */
export function commandThinkingLevel(command: AskAgentCommand): ThinkingLevel {
  const value = command.extraPayload.thinkingLevel;
  if (value === undefined) {
    return "off";
  }
  if (isThinkingLevel(value)) {
    return value;
  }
  throw new Error(
    `AskAgent extraPayload.thinkingLevel must be one of ${THINKING_LEVELS.join(", ")}`,
  );
}

/** 只接受群聊定位引用；Gateway 透传的历史正文不会进入 Super。 */
export function commandGroupChatRef(
  command: AskAgentCommand,
): GroupChatRefV1 | undefined {
  const value = command.extraPayload.groupChat;
  if (value === undefined) {
    return undefined;
  }
  const reference = parseGroupChatRef(value);
  if (reference.conversationKey !== command.header.sessionId) {
    throw new Error(
      "AskAgent extraPayload.groupChat.conversationKey must match header.sessionId",
    );
  }
  return reference;
}

/**
 * 从 AskAgent extraPayload 读取当前入口 Agent ID，用于排除超级助手自身。
 * 兼容 `agent_id` 与 `agentId`，接受字符串或数字（by-framework 约定为 `string | number`），
 * 统一 trim 成非空字符串；缺失或非法时返回空串。
 */
export function commandSourceAgentId(command: {
  extraPayload?: Readonly<Record<string, unknown>>;
}): string {
  const extra = command.extraPayload ?? {};
  const raw =
    recordScalar(extra, "agent_id") ?? recordScalar(extra, "agentId");
  return raw ?? "";
}

/** 从 by-framework 入站参数读取当前超级助手的展示名称。 */
export function commandAgentName(command: {
  header: { metadata: Readonly<Record<string, unknown>> };
  extraPayload?: Readonly<Record<string, unknown>>;
}): string {
  const extra = command.extraPayload ?? {};
  return (
    recordString(extra, "agent_name") ||
    recordString(extra, "agentName") ||
    recordString(command.header.metadata, "agent_name") ||
    recordString(command.header.metadata, "agentName")
  );
}

/** 生成与 byai-channel 一致的 Agent Run 启动标题。 */
export function agentReadyTitle(agentName: string, locale?: string): string {
  return locale?.trim().toLowerCase().startsWith("en")
    ? `${agentName} agent is ready`
    : `${agentName} 智能体已就绪`;
}

/** 从记录中读取大小写不敏感的非空字符串值。 */
export function recordString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const expected = key.toLowerCase();
  for (const [candidate, value] of Object.entries(record)) {
    if (candidate.toLowerCase() === expected && typeof value === "string") {
      return value.trim();
    }
  }
  return "";
}

/** 从记录中大小写不敏感地读取字符串或数字字段，统一 trim；缺失或空返回 undefined。 */
export function recordScalar(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const expected = key.toLowerCase();
  for (const [candidate, value] of Object.entries(record)) {
    if (
      candidate.toLowerCase() === expected &&
      (typeof value === "string" || typeof value === "number")
    ) {
      const text = String(value).trim();
      if (text) {
        return text;
      }
    }
  }
  return undefined;
}

/** 将内部事件转换为对调用方安全、稳定的执行进度。 */
export function progressMessage(event: RunEvent): string {
  if (event.type === "delegation.progress") {
    return stringData(event.data.message);
  }
  return "";
}

/** 判断事件是否需要包在 reasoning 阶段内展示。 */
export function isDelegationReasoningEvent(event: RunEvent): boolean {
  return [
    "delegation.started",
    "delegation.output.delta",
    "delegation.completed",
    "delegation.failed",
    "interaction.requested",
  ].includes(event.type);
}

/** 构造与 GatewayDataEmitter 一致、并带业务 Agent 标识的消息体。 */
export function protocolMessage(input: {
  event: string;
  content: string;
  contentType: string;
  orderId: string;
  parentOrderId: string;
  agentId: string;
  agentName: string;
  objectType?: string;
  status?: string;
}): Record<string, unknown> {
  return {
    id: randomUUID().replaceAll("-", "").toUpperCase(),
    created: Math.floor(Date.now() / 1_000),
    model: "",
    object: "",
    event: input.event,
    contentType: input.contentType,
    orderId: input.orderId,
    parentOrderId: input.parentOrderId,
    agentId: input.agentId,
    agentName: input.agentName,
    ...(input.objectType ? { objectType: input.objectType } : {}),
    ...(input.status ? { status: input.status } : {}),
    choices: [
      {
        index: 0,
        finish_reason: "",
        delta: { content: input.content },
      },
    ],
  };
}

/** 从 RunEvent JSON 字段中安全读取字符串。 */
export function stringData(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 生成同一主机内稳定且便于定位的默认 Worker 实例 ID。 */
export function defaultWorkerId(): string {
  const host =
    hostname().trim().replace(/[^a-zA-Z0-9_.-]/g, "-") || "unknown-host";
  return `byclaw-super-${host}`;
}

/** 构造不包含消息正文和凭证的结构化日志字段。 */
export function commandLogFields(
  command: GatewayCommand,
): Record<string, unknown> {
  return {
    messageId: command.header.messageId,
    sessionId: command.header.sessionId,
    traceId: command.header.traceId,
    sourceAgentType: command.header.sourceAgentType,
  };
}

/** 外部 sessionId 在验签 userCode 内绑定，避免不同用户发生碰撞。 */
export function externalSessionBindingKey(
  principal: CallerPrincipal,
  externalSessionId: string,
): string {
  return JSON.stringify([principal.userCode, externalSessionId]);
}

/** 把未知值安全收窄为普通记录。 */
export function recordValue(
  value: unknown,
): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Worker 启动状态检查使用的非阻塞短轮询。 */
export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
