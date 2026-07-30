import type { CallerPrincipal, RunAttachment } from "./types.js";

/** inspectAttachment 支持的读取模式。 */
export const ATTACHMENT_INSPECTION_MODES = [
  "metadata",
  "text",
  "structure",
] as const;
export type AttachmentInspectionMode =
  (typeof ATTACHMENT_INSPECTION_MODES)[number];

/** inspectAttachment 可能返回的结构化错误码；Leader 据此决定解释还是改委派。 */
export const ATTACHMENT_INSPECTION_ERROR_CODES = {
  /** attachmentId 不属于当前 Run 的附件集合（防工具层伪造 ID）。 */
  NOT_FOUND: "ATTACHMENT_NOT_FOUND",
  /** 缺少可用的执行凭证（Beyond-Token），无法向 BE 证明归属。 */
  CREDENTIAL_MISSING: "ATTACHMENT_CREDENTIAL_MISSING",
  /** 凭证已过期或被 BE 拒绝；不得回退到裸 URL 抓取。 */
  CREDENTIAL_EXPIRED: "ATTACHMENT_CREDENTIAL_EXPIRED",
  /** 当前用户对该 fileId 没有归属权；不泄露资源是否存在。 */
  FORBIDDEN: "ATTACHMENT_FORBIDDEN",
  /** 文件类型不在白名单内。 */
  TYPE_UNSUPPORTED: "ATTACHMENT_TYPE_UNSUPPORTED",
  /** 文件或解析结果超出单文件 / 单 Run 字节上限。 */
  TOO_LARGE: "ATTACHMENT_TOO_LARGE",
  /** 下载或解析过程出错（网络、签名校验、路径穿越等）。 */
  FETCH_FAILED: "ATTACHMENT_FETCH_FAILED",
} as const;
export type AttachmentInspectionErrorCode =
  (typeof ATTACHMENT_INSPECTION_ERROR_CODES)[keyof typeof ATTACHMENT_INSPECTION_ERROR_CODES];

/** inspectAttachment 的失败；携带稳定错误码，便于 Leader 与上层区分处理。 */
export class AttachmentInspectionError extends Error {
  readonly code: AttachmentInspectionErrorCode;
  constructor(
    code: AttachmentInspectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AttachmentInspectionError";
    this.code = code;
  }
}

/**
 * inspectAttachment 返回给 Leader 的有界结果。
 *
 * 安全约束：
 * - `text` / `structure` 必须由 Resolver 截断到有界长度，不得返回整份大文件正文。
 * - 不含 Token、内部下载 URL、宿主机临时路径；`note` 仅用于向 Leader 说明限制。
 * - 默认不写入 RunEvent；进入 Pi transcript 的也只是这份有界摘要。
 */
export interface AttachmentInspection {
  attachmentId: string;
  name: string;
  mediaType?: string;
  mode: AttachmentInspectionMode;
  /** text 模式下的有界 UTF-8 文本（已截断）。 */
  text?: string;
  /** structure 模式下的结构摘要（如行列概览、JSON 顶层键），有界。 */
  structure?: string;
  /** 实际读取/解析的字节数；metadata 模式可为 undefined。 */
  byteSize?: number;
  truncated: boolean;
  /** 向 Leader 说明的限制或提示，例如“仅前 N 字”。 */
  note?: string;
}

/**
 * downloadAttachment 落盘结果。`relativePath` 相对于当前 Pi Session 的工作目录，
 * 不暴露宿主机绝对路径、下载 URL 或执行凭证。
 */
export interface MaterializedAttachment {
  attachmentId: string;
  name: string;
  mediaType?: string;
  byteSize: number;
  relativePath: string;
}

/**
 * 传输无关的附件读取边界。首个实现为 app 层的 `ByAiAttachmentResolver`：
 * 用 Run 短期执行凭证调 BE，由 BE 按 fileId + 当前用户校验归属后返回有界内容，
 * 绝不信任客户端自报的 `url`。
 */
export interface AttachmentResolver {
  inspect(input: {
    attachment: RunAttachment;
    principal: CallerPrincipal;
    /** Run 短期执行凭证（Beyond-Token）；仅本次调用内存可见。 */
    credential: string;
    mode: AttachmentInspectionMode;
    signal: AbortSignal;
  }): Promise<AttachmentInspection>;
  /**
   * 把附件原始字节下载到调用方提供的可信会话目录。可选以兼容仅支持 inspect
   * 的 Resolver；工具参数不会向模型暴露 destinationDirectory。
   */
  materialize?(input: {
    attachment: RunAttachment;
    principal: CallerPrincipal;
    /** Run 短期执行凭证（Beyond-Token）；仅本次调用内存可见。 */
    credential: string;
    destinationDirectory: string;
    signal: AbortSignal;
  }): Promise<MaterializedAttachment>;
}
