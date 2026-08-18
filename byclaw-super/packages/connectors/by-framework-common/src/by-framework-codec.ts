import type {
  ConnectorEvent,
  ExternalExecutionRef,
  JsonValue,
  UserInteractionQuestion,
} from "@byclaw/by-conductor";

type DisplayConnectorEvent = Extract<
  ConnectorEvent,
  {
    type: "display_progress" | "tool_started" | "tool_detail" | "tool_completed" | "tool_failed";
  }
>;

const MAX_DISPLAY_TEXT_LENGTH = 8_192;
const MAX_DISPLAY_JSON_LENGTH = 32_768;
const MAX_JSON_DEPTH = 8;
const MAX_COLLECTION_ITEMS = 100;
const SENSITIVE_KEY =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|connection[_-]?string)$/i;

/** by-framework Redis Stream 中的原始数据消息。 */
export type DataMessage = {
  trace_id?: string;
  session_id?: string;
  event_type?: string;
  state_msg?: string;
  data?: unknown;
  metadata?: Record<string, unknown>;
  source_agent_type?: string;
  message_id?: string;
  parent_message_id?: string;
};

/** 从可持久化执行引用中安全读取字符串字段。 */
export function refString(ref: ExternalExecutionRef, key: string): string {
  const value = ref.metadata?.[key];
  return typeof value === "string" ? value : "";
}

export function jsonString(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/** 从 metadata 中安全读取非空字符串。 */
export function stringMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value ? value : undefined;
}

/** 把任意中止原因规范化为 Error。 */
export function abortError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  const error = new Error(typeof reason === "string" ? reason : "Operation aborted");
  error.name = "AbortError";
  return error;
}

/** 容错解析 Redis Stream 中的 by-framework 数据消息。 */
export function parseDataMessage(raw: string): DataMessage | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? (value as DataMessage) : undefined;
  } catch {
    return undefined;
  }
}

/** 从 OpenAI 兼容的 choices 结构中提取文本。 */
export function extractContent(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.choices)) {
    return "";
  }
  const first = data.choices[0];
  if (!isRecord(first) || !isRecord(first.delta)) {
    return "";
  }
  return typeof first.delta.content === "string" ? first.delta.content : "";
}

/**
 * 将子 Agent 面向 by-framework 前端的思考帧转换为传输无关事件。
 * reasoning start/end 仍由调用方作为内部边界消费；这里只解析 delta 内容。
 */
export function extractDisplayEvent(message: DataMessage): DisplayConnectorEvent | undefined {
  if (!isRecord(message.data)) {
    return undefined;
  }
  const contentType = String(message.data.contentType ?? "");
  const content = extractContent(message.data);
  const orderId = displayId(message.data.orderId, message.message_id);
  const parentOrderId = displayId(message.data.parentOrderId, message.parent_message_id);

  if (contentType === "3009" || String(message.data.objectType ?? "") === "tool_call") {
    if (!orderId) {
      return undefined;
    }
    const status = String(message.data.status ?? "_START_");
    const title = safeDisplayText(content || "调用工具");
    const toolName = extractToolName(message.data, title);
    if (status === "_ERROR_") {
      return {
        type: "tool_failed",
        callId: orderId,
        toolName,
        title,
        error: title || "工具调用失败",
      };
    }
    if (status === "_DONE_") {
      return {
        type: "tool_completed",
        callId: orderId,
        toolName,
        title,
      };
    }
    return {
      type: "tool_started",
      callId: orderId,
      toolName,
      title,
    };
  }

  if (contentType === "2020") {
    const detail = parseJsonBlock(content);
    const callId = parentOrderId || orderId;
    if (!callId || !detail) {
      return undefined;
    }
    return {
      type: "tool_detail",
      callId,
      phase: detail.phase,
      value: detail.value,
    };
  }

  if (["1002", "3003", "3005"].includes(contentType) && content) {
    return {
      type: "display_progress",
      text: safeDisplayText(content),
      ...(orderId ? { sourceMessageId: orderId } : {}),
    };
  }
  return undefined;
}

function displayId(primary: unknown, fallback: unknown): string {
  const value = typeof primary === "string" ? primary : String(primary ?? "");
  if (value && value !== "-1") {
    return value;
  }
  return typeof fallback === "string" && fallback !== "-1" ? fallback : "";
}

function extractToolName(data: Record<string, unknown>, title: string): string {
  for (const key of ["toolName", "tool_name", "name"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return safeDisplayText(value.trim());
    }
  }
  const stripped = title.replace(/^\s*(?:调用工具|工具调用|tool call)\s*[:：]?\s*/i, "").trim();
  return stripped || "工具";
}

function parseJsonBlock(
  content: string,
): { phase: "input" | "output"; value: JsonValue } | undefined {
  if (!content) {
    return undefined;
  }
  let block: unknown;
  try {
    block = JSON.parse(content);
  } catch {
    return {
      phase: "output",
      value: boundedJsonValue(content),
    };
  }
  if (!isRecord(block)) {
    return {
      phase: "output",
      value: boundedJsonValue(block),
    };
  }
  const title = String(block.title ?? "").toLowerCase();
  const phase = title.includes("input") || title.includes("参数") ? "input" : "output";
  const rawValue = block.json ?? block.value ?? block.data ?? block;
  if (typeof rawValue === "string") {
    try {
      return { phase, value: boundedJsonValue(JSON.parse(rawValue)) };
    } catch {
      return { phase, value: boundedJsonValue(rawValue) };
    }
  }
  return { phase, value: boundedJsonValue(rawValue) };
}

/** 对进入持久层和前端协议的字符串做最小必要的凭据遮蔽与限长。 */
export function safeDisplayText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:token|access_token|api_key|password)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(
      /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[REDACTED]@",
    )
    .slice(0, MAX_DISPLAY_TEXT_LENGTH);
}

function boundedJsonValue(value: unknown): JsonValue {
  const sanitized = sanitizeJsonValue(value, 0);
  const encoded = JSON.stringify(sanitized);
  if (encoded.length <= MAX_DISPLAY_JSON_LENGTH) {
    return sanitized;
  }
  return {
    truncated: true,
    preview: encoded.slice(0, MAX_DISPLAY_JSON_LENGTH),
  };
}

function sanitizeJsonValue(value: unknown, depth: number): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return safeDisplayText(value);
  }
  if (depth >= MAX_JSON_DEPTH) {
    return "[TRUNCATED_DEPTH]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_COLLECTION_ITEMS).map((item) => sanitizeJsonValue(item, depth + 1));
  }
  if (isRecord(value)) {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_COLLECTION_ITEMS)) {
      result[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeJsonValue(item, depth + 1);
    }
    return result;
  }
  return safeDisplayText(String(value));
}

/** 识别 by-framework askUser 发出的 3013 表单，并保留恢复标识。 */
export function extractUserInput(message: DataMessage):
  | {
      interactionId: string;
      request: {
        questions: UserInteractionQuestion[];
        uiPayload: Record<string, JsonValue>;
      };
      resumeToken: Record<string, JsonValue>;
    }
  | undefined {
  if (!isRecord(message.data) || String(message.data.contentType ?? "") !== "3013") {
    return undefined;
  }
  const content = extractContent(message.data);
  if (!content) {
    return undefined;
  }
  let form: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed)) {
      return undefined;
    }
    form = parsed;
  } catch {
    return undefined;
  }

  const fields = Array.isArray(form.pluginMachineFields)
    ? form.pluginMachineFields.filter(isRecord)
    : [];
  const questions: UserInteractionQuestion[] = fields.map((field, index) => {
    const options = Array.isArray(field.optional)
      ? field.optional
          .map((option) =>
            isRecord(option)
              ? {
                  label: String(option.label ?? option.value ?? ""),
                  value: String(option.value ?? option.label ?? ""),
                  description: String(option.description ?? option.label ?? option.value ?? ""),
                }
              : {
                  label: String(option),
                  value: String(option),
                  description: String(option),
                },
          )
          .filter((option) => option.label)
      : [];
    return {
      header: String(field.fieldName ?? `问题 ${index + 1}`),
      question: String(field.description ?? field.fieldName ?? "请提供所需信息"),
      options:
        options.length >= 2
          ? options
          : [
              {
                label: "填写回答",
                value: "custom",
                description: "在输入框中提供自定义回答",
              },
              {
                label: "跳过",
                value: "skip",
                description: "暂不提供此项信息",
              },
            ],
    };
  });
  const interactionId =
    message.message_id ||
    String(message.data.orderId ?? "") ||
    `ask-user:${message.trace_id ?? ""}`;
  return {
    interactionId,
    request: {
      questions:
        questions.length > 0
          ? questions
          : [
              {
                header: "补充信息",
                question: "请提供继续任务所需的信息",
                options: [
                  {
                    label: "填写回答",
                    value: "custom",
                    description: "提供自定义回答",
                  },
                  {
                    label: "跳过",
                    value: "skip",
                    description: "暂不提供",
                  },
                ],
              },
            ],
      uiPayload: form as Record<string, JsonValue>,
    },
    resumeToken: {
      traceId: message.trace_id ?? "",
      messageId: message.message_id ?? interactionId,
      parentMessageId: message.parent_message_id ?? "",
      sourceAgentType: message.source_agent_type ?? "",
    },
  };
}

/** 按 metadata、状态消息、内容的优先级提取可读错误。 */
export function extractError(message: DataMessage): string {
  const metadataError = message.metadata?.error;
  if (typeof metadataError === "string" && metadataError) {
    return metadataError;
  }
  if (message.state_msg) {
    return message.state_msg;
  }
  return extractContent(message.data) || "by-framework execution failed";
}

/** 把 ioredis 的 XREAD 嵌套返回值展平为消息 ID 与 data 字段。 */
export function parseXreadRows(rows: unknown): Array<{ id: string; data: string }> {
  if (!Array.isArray(rows)) {
    return [];
  }
  const result: Array<{ id: string; data: string }> = [];
  for (const streamRow of rows) {
    if (!Array.isArray(streamRow) || !Array.isArray(streamRow[1])) {
      continue;
    }
    for (const item of streamRow[1]) {
      if (!Array.isArray(item) || typeof item[0] !== "string" || !Array.isArray(item[1])) {
        continue;
      }
      const fields = item[1];
      const dataIndex = fields.indexOf("data");
      const data = dataIndex >= 0 ? fields[dataIndex + 1] : undefined;
      if (typeof data === "string") {
        result.push({ id: item[0], data });
      }
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
