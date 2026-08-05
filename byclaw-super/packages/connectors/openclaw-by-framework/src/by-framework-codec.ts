import type {
  ExternalExecutionRef,
  JsonValue,
  UserInteractionQuestion,
} from "@byclaw/by-conductor";

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
export function stringMetadata(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value ? value : undefined;
}

/** 把任意中止原因规范化为 Error。 */
export function abortError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  const error = new Error(
    typeof reason === "string" ? reason : "Operation aborted",
  );
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

/** 识别 by-framework askUser 发出的 3013 表单，并保留恢复标识。 */
export function extractUserInput(message: DataMessage): {
  interactionId: string;
  request: {
    questions: UserInteractionQuestion[];
    uiPayload: Record<string, JsonValue>;
  };
  resumeToken: Record<string, JsonValue>;
} | undefined {
  if (
    !isRecord(message.data) ||
    String(message.data.contentType ?? "") !== "3013"
  ) {
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
                  description: String(
                    option.description ?? option.label ?? option.value ?? "",
                  ),
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
      question: String(
        field.description ?? field.fieldName ?? "请提供所需信息",
      ),
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
  return extractContent(message.data) || "OpenClaw execution failed";
}

/** 把 ioredis 的 XREAD 嵌套返回值展平为消息 ID 与 data 字段。 */
export function parseXreadRows(
  rows: unknown,
): Array<{ id: string; data: string }> {
  if (!Array.isArray(rows)) {
    return [];
  }
  const result: Array<{ id: string; data: string }> = [];
  for (const streamRow of rows) {
    if (!Array.isArray(streamRow) || !Array.isArray(streamRow[1])) {
      continue;
    }
    for (const item of streamRow[1]) {
      if (
        !Array.isArray(item) ||
        typeof item[0] !== "string" ||
        !Array.isArray(item[1])
      ) {
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
