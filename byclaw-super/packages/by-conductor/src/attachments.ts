import type { AttachmentProvenance, RunAttachment } from "./types.js";

/** 附件输入错误；HTTP/Worker 捕获后映射为 400 / 失败事件，不静默丢弃。 */
export class AttachmentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentInputError";
  }
}

/** 仅有附件、无文本时使用的稳定内部提示语。 */
export const DEFAULT_ATTACHMENT_PROMPT = "请处理本次上传的附件";

/**
 * 确定 Run 的最终消息文本：优先使用非空 `message`；否则在存在附件时使用默认提示；
 * 两者皆空抛 {@link AttachmentInputError}。供 HTTP 与 Worker 入口共用，避免逻辑漂移。
 */
export function resolveRunMessage(
  message: string | undefined,
  attachments: readonly RunAttachment[],
): string {
  const text = typeof message === "string" ? message.trim() : "";
  if (text) {
    return text;
  }
  if (attachments.length > 0) {
    return DEFAULT_ATTACHMENT_PROMPT;
  }
  throw new AttachmentInputError("message or attachments is required");
}

/**
 * 原始附件输入：同时接受 HTTP 规范字段（`id`/`name`/`mediaType`/...）和
 * by-framework 文件字段（`fileId`/`fileName`/`fileType`/`fileSize`/`fileUrl`/`filePath`）。
 * `fileIp` 等基础设施字段一律忽略；凭据字段不在此结构中，也不会被读取。
 */
export interface RawAttachment {
  id?: string;
  fileId?: string;
  name?: string;
  fileName?: string;
  mediaType?: string;
  fileType?: string;
  size?: number;
  fileSize?: number;
  sourceType?: string;
  useType?: string;
  datasetId?: string;
  url?: string;
  fileUrl?: string;
  path?: string;
  filePath?: string;
}

/** 对外暴露的安全附件摘要：剥离 `url`/`path`/`datasetId` 等定位字段。 */
export type SafeAttachmentSummary = Pick<RunAttachment, "id" | "name"> & {
  mediaType?: string;
  size?: number;
};

const MAX_ATTACHMENTS_PER_RUN = 20;
const FIELD_LIMITS = {
  id: 200,
  name: 500,
  mediaType: 200,
  sourceType: 100,
  useType: 100,
  datasetId: 200,
  url: 2_000,
  path: 2_000,
} as const;

/**
 * 把任一入口的原始附件规范化成稳定的 `RunAttachment[]`。
 *
 * 规则：
 * - 单 Run 最多 {@link MAX_ATTACHMENTS_PER_RUN} 个；超出抛错。
 * - 字段映射优先用规范名，缺失时回退 by-framework 别名（见 {@link RawAttachment}）。
 * - `id` 缺失生成 Run 内稳定的 `attachment-{index}`；`name` 缺失同样兜底。
 * - 重复 `id` 去重，保留第一次出现。
 * - `size` 仅接受非负有限整数；字符串字段做 `trim` 与长度限制。
 * - 任何非法结构抛 {@link AttachmentInputError}，绝不静默丢弃。
 */
export function normalizeRunAttachments(
  raw: unknown,
  provenance: AttachmentProvenance,
): RunAttachment[] {
  if (!Array.isArray(raw)) {
    throw new AttachmentInputError("attachments must be an array");
  }
  if (raw.length > MAX_ATTACHMENTS_PER_RUN) {
    throw new AttachmentInputError(
      `attachments exceed the per-Run limit of ${MAX_ATTACHMENTS_PER_RUN}`,
    );
  }
  const seen = new Set<string>();
  const result: RunAttachment[] = [];
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new AttachmentInputError(
        `attachment at index ${index} must be an object`,
      );
    }
    const item = entry as Record<string, unknown>;
    const id =
      fieldString(item, ["id", "fileId"], "id", index) ??
      `attachment-${index}`;
    if (seen.has(id)) {
      return; // 去重，保留第一次出现
    }
    seen.add(id);
    const name =
      fieldString(item, ["name", "fileName"], "name", index) ??
      `attachment-${index}`;
    const mediaType = fieldString(item, ["mediaType", "fileType"], "mediaType", index);
    const sourceType = fieldString(item, ["sourceType"], "sourceType", index);
    const useType = fieldString(item, ["useType"], "useType", index);
    const datasetId = fieldString(item, ["datasetId"], "datasetId", index);
    const url = fieldString(item, ["url", "fileUrl"], "url", index);
    const path = fieldString(item, ["path", "filePath"], "path", index);
    const size = readSize(item, index);
    result.push({
      id,
      name,
      provenance,
      ...(mediaType ? { mediaType } : {}),
      ...(size !== undefined ? { size } : {}),
      ...(sourceType ? { sourceType } : {}),
      ...(useType ? { useType } : {}),
      ...(datasetId ? { datasetId } : {}),
      ...(url ? { url } : {}),
      ...(path ? { path } : {}),
    });
  });
  return result;
}

/** 剥离定位字段后的安全摘要，供 HTTP 响应、事件、消息历史使用。 */
export function toSafeAttachmentSummary(
  attachments: readonly RunAttachment[],
): SafeAttachmentSummary[] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    ...(attachment.mediaType ? { mediaType: attachment.mediaType } : {}),
    ...(attachment.size !== undefined ? { size: attachment.size } : {}),
  }));
}

/**
 * 生成附加到本轮 user message 的附件摘要文本块：只含
 * `id`/`name`/`mediaType`/`size`，绝不写入 `url`/`path`/`datasetId`。
 * 无附件时返回空串。
 */
export function formatAttachmentSummary(
  attachments: readonly RunAttachment[],
): string {
  if (attachments.length === 0) {
    return "";
  }
  const lines = attachments.map((attachment) => {
    const detail = [attachment.mediaType, formatBytes(attachment.size)].filter(
      Boolean,
    ).join(", ");
    return `- [${attachment.id}] ${attachment.name}${detail ? ` (${detail})` : ""}`;
  });
  return [
    "<attachments>",
    "本次输入包含以下附件：",
    ...lines,
    "委派时通过 attachmentIds 指定目标 Agent 需要接收的附件。",
    "</attachments>",
  ].join("\n");
}

/**
 * 将安全附件摘要作为本轮输入数据附加到 user message。
 * 附件属于用户本轮提供的内容，不进入 system prompt。
 */
export function formatUserMessageWithAttachments(
  message: string,
  attachments: readonly RunAttachment[],
): string {
  const attachmentSummary = formatAttachmentSummary(attachments);
  return attachmentSummary ? `${message}\n\n${attachmentSummary}` : message;
}

/**
 * 按工具传入的 attachmentIds 从当前 Run 的附件集合解析所选附件。
 * - 未传（undefined）→ 默认全部附件；
 * - 显式空数组 → 空集合（本次不带附件）；
 * - 含未知 ID → 抛 {@link AttachmentInputError}，绝不静默截断。
 */
export function resolveAttachmentSelection(
  attachments: readonly RunAttachment[],
  attachmentIds: readonly string[] | undefined,
): RunAttachment[] {
  if (attachmentIds === undefined) {
    return [...attachments];
  }
  const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  const selected: RunAttachment[] = [];
  for (const id of attachmentIds) {
    const found = byId.get(id);
    if (!found) {
      throw new AttachmentInputError(`unknown attachmentId: ${id}`);
    }
    selected.push(found);
  }
  return selected;
}

/** 把字节数转成人类可读的体积字符串；无 size 返回空串。 */
function formatBytes(size: number | undefined): string {
  if (size === undefined || !Number.isFinite(size) || size < 0) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${Math.round(size / (1024 * 1024))} MB`;
}

/** 读取并校验 size：仅接受非负有限整数；缺失返回 undefined；其余抛错。 */
function readSize(item: Record<string, unknown>, index: number): number | undefined {
  const value = item.size ?? item.fileSize;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new AttachmentInputError(
      `attachment at index ${index} has invalid size (must be a non-negative finite integer)`,
    );
  }
  return value;
}

/** 按候选键取首个非空 trim 字符串；类型错误或超长抛错；全空返回 undefined。 */
function fieldString(
  item: Record<string, unknown>,
  keys: readonly string[],
  label: string,
  index: number,
): string | undefined {
  const limit =
    FIELD_LIMITS[label as keyof typeof FIELD_LIMITS] ?? Number.POSITIVE_INFINITY;
  for (const key of keys) {
    const value = item[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== "string") {
      throw new AttachmentInputError(
        `attachment at index ${index} field ${label} must be a string`,
      );
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.length > limit) {
      throw new AttachmentInputError(
        `attachment at index ${index} field ${label} exceeds ${limit} characters`,
      );
    }
    return trimmed;
  }
  return undefined;
}
