type JsonRecord = Record<string, unknown>;

/**
 * 将 Pi/OpenAI Responses 的推理参数转换为火山方舟 Responses 格式。
 *
 * Pi 会生成 reasoning.summary 和 reasoning.encrypted_content；方舟 DeepSeek
 * 使用顶层 thinking.type，且会拒绝 reasoning.summary。
 */
export function adaptVolcengineArkResponsesPayload(payload: unknown): unknown {
  if (!isJsonRecord(payload) || !isJsonRecord(payload.reasoning)) {
    return payload;
  }

  const reasoning = payload.reasoning;
  const thinkingType = reasoning.effort === "none" ? "disabled" : "enabled";
  const {
    reasoning: _reasoning,
    include: rawInclude,
    ...rest
  } = payload;
  const adapted: JsonRecord = {
    ...rest,
    thinking: isJsonRecord(payload.thinking)
      ? payload.thinking
      : { type: thinkingType },
  };

  if (Array.isArray(rawInclude)) {
    const include = rawInclude.filter(
      (item) => item !== "reasoning.encrypted_content",
    );
    if (include.length > 0) {
      adapted.include = include;
    }
  } else if (rawInclude !== undefined) {
    adapted.include = rawInclude;
  }

  return adapted;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
