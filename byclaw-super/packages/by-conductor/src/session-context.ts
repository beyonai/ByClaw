/** 创建 Session 时允许调用方提供的稳定环境信息。 */
export interface SessionContextInput {
  locale?: string;
  timezone?: string;
}

/** Session 级业务上下文 V1；不包含聊天历史、凭证或任意自定义 Prompt。 */
export interface SessionContextV1 {
  schemaVersion: 1;
  locale?: string;
  timezone?: string;
}

/** 校验并规范化 Session 上下文；空字段不会进入持久化快照。 */
export function createSessionContext(
  input: SessionContextInput = {},
): SessionContextV1 {
  const locale = optionalLocale(input.locale);
  const timezone = optionalTimezone(input.timezone);
  return {
    schemaVersion: 1,
    ...(locale ? { locale } : {}),
    ...(timezone ? { timezone } : {}),
  };
}

/** 从持久化 JSON 恢复并重新校验，拒绝未知 schema 或损坏字段。 */
export function parseSessionContext(value: unknown): SessionContextV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid persisted Session context");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new Error(
      `Unsupported Session context schema: ${String(record.schemaVersion)}`,
    );
  }
  if (record.locale !== undefined && typeof record.locale !== "string") {
    throw new Error("Invalid persisted Session locale");
  }
  if (record.timezone !== undefined && typeof record.timezone !== "string") {
    throw new Error("Invalid persisted Session timezone");
  }
  return createSessionContext({
    ...(record.locale !== undefined ? { locale: record.locale } : {}),
    ...(record.timezone !== undefined ? { timezone: record.timezone } : {}),
  });
}

function optionalLocale(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  try {
    return new Intl.Locale(normalized).toString();
  } catch {
    throw new Error(`Invalid Session locale: ${normalized}`);
  }
}

function optionalTimezone(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  try {
    return new Intl.DateTimeFormat("en", {
      timeZone: normalized,
    }).resolvedOptions().timeZone;
  } catch {
    throw new Error(`Invalid Session timezone: ${normalized}`);
  }
}
