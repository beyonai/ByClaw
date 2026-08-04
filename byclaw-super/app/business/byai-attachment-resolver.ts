import { createWriteStream } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  ATTACHMENT_INSPECTION_ERROR_CODES,
  AttachmentInspectionError,
  type AttachmentInspection,
  type AttachmentResolver,
  type RunAttachment,
} from "@byclaw/by-conductor";
import type { ByClawBeEndpointResolver } from "./endpoint-resolver.js";
import { appendPath, normalizeBaseUrl, type FetchLike } from "./byclaw-be-http.js";

/**
 * ByClaw BE 附件读取器（T17）：`AttachmentResolver` 的首个实现。
 *
 * 安全边界（对应计划 §4.6 与 `.dev/attachments-be-read-contract.md`）：
 * - 只按 `fileId` 经 BE `/commonFile/download` 读取，携带 Run 短期 Beyond-Token；
 *   绝不使用客户端自报的 `url`/`path`，不直接访问对象存储。
 * - 临时文件名由 `mkdtemp` 生成，与附件名无关；不解压任何压缩包、不创建符号链接，
 *   因此路径穿越 / 符号链接 / 压缩炸弹在构造上不成立。
 * - inspect 白名单只放通文本族格式（txt/md/json/csv/log/yaml/xml）；原文件下载
 *   不解析内容，因此允许二进制文档、图片和压缩包，但仍受统一字节上限约束。
 * - 每次 inspect 使用独立临时目录并在 finally 中清理；进程崩溃残留由启动后首次
 *   inspect 触发的惰性清扫（24h 前的 `inspect-*` 目录）回收。
 * - 输出有界：单文件字节上限 + 文本/结构输出字符上限；不返回 Token、内部绝对
 *   路径或下载 URL，原文件下载仅返回会话工作区内的相对路径。
 *
 * 已知缺口：BE `/commonFile/download` 暂无 `createBy` 归属校验（IDOR），
 * 需 BE 侧补齐，见契约文档"已知缺口"一节。
 */

type InspectInput = Parameters<AttachmentResolver["inspect"]>[0];
type MaterializeInput = Parameters<
  NonNullable<AttachmentResolver["materialize"]>
>[0];

export interface ByAiAttachmentResolverOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  endpointResolver?: ByClawBeEndpointResolver;
  /** 临时目录根；默认 `<os.tmpdir>/byclaw-super-attachments`。 */
  tempDir?: string;
  /** 单文件下载字节上限；默认 10 MiB。 */
  maxFileBytes?: number;
  /** text 模式返回的最大字符数；默认 8000。 */
  maxTextChars?: number;
  /** structure 模式返回的最大字符数；默认 4000。 */
  maxStructureChars?: number;
}

const DOWNLOAD_PATH = "/byaiService/commonFile/download";
const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_TEXT_CHARS = 8_000;
const DEFAULT_MAX_STRUCTURE_CHARS = 4_000;
const STALE_TEMP_DIR_TTL_MS = 24 * 60 * 60 * 1000;
/** 二进制嗅探窗口：前 8 KiB 出现 NUL 即判定非文本。 */
const SNIFF_BYTES = 8_192;
/** structure 模式 CSV 预览的最大行数。 */
const STRUCTURE_PREVIEW_ROWS = 5;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "csv", "log", "yaml", "yml", "xml",
]);
const TEXT_MEDIA_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/csv",
  "text/csv",
]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "gz", "gzip", "tgz", "tar", "7z", "rar", "bz2", "xz"]);
const BINARY_DOCUMENT_EXTENSIONS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tiff"]);

/** 通过 ByClaw BE 按 fileId 安全读取当前 Run 附件，并返回有界结果。 */
export class ByAiAttachmentResolver implements AttachmentResolver {
  readonly #fallbackBaseUrl: URL;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;
  readonly #endpointResolver: ByClawBeEndpointResolver | undefined;
  readonly #tempRoot: string;
  readonly #maxFileBytes: number;
  readonly #maxTextChars: number;
  readonly #maxStructureChars: number;
  #sweepStarted = false;

  /** 固定 BE 地址与各类上限，允许测试注入 fetch 与独立临时目录。 */
  constructor(options: ByAiAttachmentResolverOptions) {
    this.#fallbackBaseUrl = normalizeBaseUrl(options.baseUrl);
    this.#timeoutMs = options.timeoutMs;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#endpointResolver = options.endpointResolver;
    this.#tempRoot = options.tempDir ?? join(tmpdir(), "byclaw-super-attachments");
    this.#maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.#maxTextChars = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
    this.#maxStructureChars = options.maxStructureChars ?? DEFAULT_MAX_STRUCTURE_CHARS;
  }

  /** 按模式读取附件；metadata 直接来自 Run 记录，text/structure 经 BE 下载后解析。 */
  async inspect(input: InspectInput): Promise<AttachmentInspection> {
    this.#sweepStaleTempDirs();
    const { attachment, mode } = input;
    if (mode === "metadata") {
      return metadataInspection(attachment);
    }
    assertInspectableType(attachment);
    const fileId = backendFileId(attachment);

    await mkdir(this.#tempRoot, { recursive: true });
    const workDir = await mkdtemp(join(this.#tempRoot, "inspect-"));
    try {
      const payloadPath = join(workDir, "payload.bin");
      const byteSize = await this.#download({
        fileId,
        credential: input.credential,
        signal: input.signal,
        destination: payloadPath,
      });
      // BE 对不存在的 fileId 返回 200 + 空 body，按"不存在"处理且不泄露更多细节。
      if (byteSize === 0) {
        throw new AttachmentInspectionError(
          ATTACHMENT_INSPECTION_ERROR_CODES.NOT_FOUND,
          "attachment content is empty or does not exist",
        );
      }
      const text = await readUtf8Text(payloadPath);
      return mode === "structure"
        ? structureInspection(attachment, text, byteSize, this.#maxStructureChars)
        : textInspection(attachment, text, byteSize, this.#maxTextChars);
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * 下载附件原始字节到当前 Pi Session 的隔离目录。文件名只取安全 basename，
   * 定位始终使用服务端校验过的 fileId，不信任附件自报的 url/path。
   */
  async materialize(input: MaterializeInput) {
    const { attachment } = input;
    const fileId = backendFileId(attachment);
    const fileName = safeAttachmentName(attachment.name);
    const attachmentDirectory = join(
      input.destinationDirectory,
      "attachments",
      fileId,
    );
    const destination = join(attachmentDirectory, fileName);

    await mkdir(attachmentDirectory, { recursive: true, mode: 0o700 });
    const workDir = await mkdtemp(join(attachmentDirectory, ".download-"));
    try {
      const payloadPath = join(workDir, "payload.bin");
      const byteSize = await this.#download({
        fileId,
        credential: input.credential,
        signal: input.signal,
        destination: payloadPath,
      });
      if (byteSize === 0) {
        throw new AttachmentInspectionError(
          ATTACHMENT_INSPECTION_ERROR_CODES.NOT_FOUND,
          "attachment content is empty or does not exist",
        );
      }
      await chmod(payloadPath, 0o600);
      // 只有新文件完整下载成功后才替换旧副本，避免失败时留下半文件。
      await rm(destination, { force: true });
      await rename(payloadPath, destination);
      return {
        attachmentId: attachment.id,
        name: attachment.name,
        ...(attachment.mediaType ? { mediaType: attachment.mediaType } : {}),
        byteSize,
        relativePath: relative(input.destinationDirectory, destination).replaceAll(
          "\\",
          "/",
        ),
      };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** 经 BE 流式下载附件到临时文件，返回实际字节数；超限与取消都有明确语义。 */
  async #download(input: {
    fileId: string;
    credential: string;
    signal: AbortSignal;
    destination: string;
  }): Promise<number> {
    const discovered = await this.#endpointResolver?.resolve().catch(() => undefined);
    const url = appendPath(
      discovered ? normalizeBaseUrl(discovered) : this.#fallbackBaseUrl,
      DOWNLOAD_PATH,
    );
    url.search = `fileId=${encodeURIComponent(input.fileId)}`;
    // 外部取消（Run 取消/接管）与单请求超时会合到同一个信号。
    const combinedSignal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(this.#timeoutMs),
    ]);

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers: { "Beyond-Token": input.credential },
        signal: combinedSignal,
      });
    } catch (error) {
      if (input.signal.aborted) {
        throw error;
      }
      if (combinedSignal.aborted) {
        throw new AttachmentInspectionError(
          ATTACHMENT_INSPECTION_ERROR_CODES.FETCH_FAILED,
          `attachment download timed out after ${this.#timeoutMs}ms`,
        );
      }
      throw new AttachmentInspectionError(
        ATTACHMENT_INSPECTION_ERROR_CODES.FETCH_FAILED,
        `attachment download failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new AttachmentInspectionError(
        ATTACHMENT_INSPECTION_ERROR_CODES.CREDENTIAL_EXPIRED,
        `ByClaw BE rejected the execution credential (HTTP ${response.status})`,
      );
    }
    if (response.status === 404) {
      throw new AttachmentInspectionError(
        ATTACHMENT_INSPECTION_ERROR_CODES.NOT_FOUND,
        "attachment does not exist",
      );
    }
    if (!response.ok) {
      throw new AttachmentInspectionError(
        ATTACHMENT_INSPECTION_ERROR_CODES.FETCH_FAILED,
        `ByClaw BE download returned HTTP ${response.status}`,
      );
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > this.#maxFileBytes) {
      throw new AttachmentInspectionError(
        ATTACHMENT_INSPECTION_ERROR_CODES.TOO_LARGE,
        `attachment exceeds the per-file limit of ${this.#maxFileBytes} bytes`,
      );
    }
    if (!response.body) {
      throw new AttachmentInspectionError(
        ATTACHMENT_INSPECTION_ERROR_CODES.FETCH_FAILED,
        "ByClaw BE download returned no body",
      );
    }

    const maxFileBytes = this.#maxFileBytes;
    let written = 0;
    const counting = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        written += chunk.length;
        if (written > maxFileBytes) {
          callback(
            new AttachmentInspectionError(
              ATTACHMENT_INSPECTION_ERROR_CODES.TOO_LARGE,
              `attachment exceeds the per-file limit of ${maxFileBytes} bytes`,
            ),
          );
          return;
        }
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
        counting,
        createWriteStream(input.destination),
      );
    } catch (error) {
      if (error instanceof AttachmentInspectionError) {
        throw error;
      }
      if (input.signal.aborted) {
        throw error;
      }
      throw new AttachmentInspectionError(
        ATTACHMENT_INSPECTION_ERROR_CODES.FETCH_FAILED,
        `attachment download failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return written;
  }

  /** 惰性清扫进程崩溃残留的过期临时目录；每进程最多触发一次，失败静默。 */
  #sweepStaleTempDirs(): void {
    if (this.#sweepStarted) {
      return;
    }
    this.#sweepStarted = true;
    void (async () => {
      try {
        const entries = await readdir(this.#tempRoot, { withFileTypes: true });
        const cutoff = Date.now() - STALE_TEMP_DIR_TTL_MS;
        await Promise.all(
          entries
            .filter((entry) => entry.isDirectory() && entry.name.startsWith("inspect-"))
            .map(async (entry) => {
              const fullPath = join(this.#tempRoot, entry.name);
              const info = await stat(fullPath).catch(() => undefined);
              if (info && info.mtimeMs < cutoff) {
                await rm(fullPath, { recursive: true, force: true }).catch(() => undefined);
              }
            }),
        );
      } catch {
        // 根目录不存在等情况无需处理。
      }
    })();
  }
}

/** metadata 模式：仅回 Run 记录内已有的安全字段，不发起 BE 调用。 */
function metadataInspection(attachment: RunAttachment): AttachmentInspection {
  return {
    attachmentId: attachment.id,
    name: attachment.name,
    ...(attachment.mediaType ? { mediaType: attachment.mediaType } : {}),
    mode: "metadata",
    ...(attachment.size !== undefined ? { byteSize: attachment.size } : {}),
    truncated: false,
    note: "元数据来自 Run 记录，未实时校验 BE 侧文件状态",
  };
}

/** text 模式：有界 UTF-8 文本。 */
function textInspection(
  attachment: RunAttachment,
  text: string,
  byteSize: number,
  maxChars: number,
): AttachmentInspection {
  const truncated = text.length > maxChars;
  return {
    attachmentId: attachment.id,
    name: attachment.name,
    ...(attachment.mediaType ? { mediaType: attachment.mediaType } : {}),
    mode: "text",
    text: truncated ? text.slice(0, maxChars) : text,
    byteSize,
    truncated,
    ...(truncated ? { note: `仅返回前 ${maxChars} 字符（全文 ${text.length} 字符）` } : {}),
  };
}

/** structure 模式：JSON 顶层结构 / CSV 行列概览 / 其他文本的行统计。 */
function structureInspection(
  attachment: RunAttachment,
  text: string,
  byteSize: number,
  maxChars: number,
): AttachmentInspection {
  const extension = extensionOf(attachment.name);
  const body = extension === "json"
    ? jsonStructure(text)
    : extension === "csv"
      ? csvStructure(text)
      : textStructure(text);
  const truncated = body.length > maxChars;
  return {
    attachmentId: attachment.id,
    name: attachment.name,
    ...(attachment.mediaType ? { mediaType: attachment.mediaType } : {}),
    mode: "structure",
    structure: truncated ? body.slice(0, maxChars) : body,
    byteSize,
    truncated,
    ...(truncated ? { note: `结构摘要截断为前 ${maxChars} 字符` } : {}),
  };
}

/** JSON 结构摘要：顶层键与值类型（对象）或长度与元素类型（数组）。 */
function jsonStructure(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AttachmentInspectionError(
      ATTACHMENT_INSPECTION_ERROR_CODES.FETCH_FAILED,
      "attachment declared as JSON but is not valid JSON",
    );
  }
  if (Array.isArray(parsed)) {
    const first = parsed[0];
    const elementSummary = Array.isArray(first)
      ? "array"
      : typeof first === "object" && first !== null
        ? `object（键：${Object.keys(first).slice(0, 20).join(", ")}）`
        : typeof first;
    return `JSON 数组，长度 ${parsed.length}，首元素类型：${elementSummary}`;
  }
  if (typeof parsed === "object" && parsed !== null) {
    const entries = Object.entries(parsed as Record<string, unknown>).slice(0, 50);
    const lines = entries.map(([key, value]) => {
      const kind = Array.isArray(value) ? `array(${value.length})` : typeof value;
      return `- ${key}: ${kind}`;
    });
    return [
      `JSON 对象，顶层 ${Object.keys(parsed as Record<string, unknown>).length} 个键：`,
      ...lines,
    ].join("\n");
  }
  return `JSON 标量：${typeof parsed}`;
}

/** CSV 结构摘要：列头、数据行数与前几行预览。 */
function csvStructure(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const header = lines[0] ?? "";
  const columns = header.split(",").map((column) => column.trim());
  const preview = lines.slice(0, STRUCTURE_PREVIEW_ROWS + 1);
  return [
    `CSV：${columns.length} 列，${Math.max(lines.length - 1, 0)} 行数据`,
    `列：${columns.join(" | ")}`,
    "预览：",
    ...preview,
  ].join("\n");
}

/** 其他文本的结构摘要：行数与前几行预览。 */
function textStructure(text: string): string {
  const lines = text.split(/\r?\n/);
  const preview = lines.slice(0, STRUCTURE_PREVIEW_ROWS);
  return [`文本：共 ${lines.length} 行`, "开头预览：", ...preview].join("\n");
}

/** 白名单校验：只放通文本族格式，其余返回结构化不支持。 */
function assertInspectableType(attachment: RunAttachment): void {
  const extension = extensionOf(attachment.name);
  const mediaType = attachment.mediaType?.toLowerCase() ?? "";
  if (
    ARCHIVE_EXTENSIONS.has(extension) ||
    mediaType === "application/zip" ||
    mediaType === "application/gzip" ||
    mediaType === "application/x-tar" ||
    mediaType === "application/x-7z-compressed" ||
    mediaType === "application/x-rar-compressed"
  ) {
    throw new AttachmentInspectionError(
      ATTACHMENT_INSPECTION_ERROR_CODES.TYPE_UNSUPPORTED,
      "压缩包不解压读取（防压缩炸弹）；请解压后以文本附件重新上传或委派",
    );
  }
  if (IMAGE_EXTENSIONS.has(extension) || mediaType.startsWith("image/")) {
    throw new AttachmentInspectionError(
      ATTACHMENT_INSPECTION_ERROR_CODES.TYPE_UNSUPPORTED,
      "图像内容暂未启用（需模型与 Pi SDK 安全图像块支持）；请委派给支持图像的 Agent",
    );
  }
  if (
    BINARY_DOCUMENT_EXTENSIONS.has(extension) ||
    mediaType === "application/pdf" ||
    mediaType.includes("officedocument") ||
    mediaType === "application/msword"
  ) {
    throw new AttachmentInspectionError(
      ATTACHMENT_INSPECTION_ERROR_CODES.TYPE_UNSUPPORTED,
      "二进制文档解析适配器暂未启用；请委派给支持该格式的 Agent",
    );
  }
  if (
    TEXT_EXTENSIONS.has(extension) ||
    mediaType.startsWith("text/") ||
    TEXT_MEDIA_TYPES.has(mediaType)
  ) {
    return;
  }
  throw new AttachmentInspectionError(
    ATTACHMENT_INSPECTION_ERROR_CODES.TYPE_UNSUPPORTED,
    `不支持的附件类型（extension=${extension || "unknown"}, mediaType=${mediaType || "unknown"}）`,
  );
}

/** 附件的 BE fileId：BE `files.fileId` 为数值序列，非全数字 ID 无法经 BE 读取。 */
function backendFileId(attachment: RunAttachment): string {
  if (!/^\d+$/.test(attachment.id)) {
    throw new AttachmentInspectionError(
      ATTACHMENT_INSPECTION_ERROR_CODES.FETCH_FAILED,
      "attachment has no backend fileId and cannot be resolved via ByClaw BE",
    );
  }
  return attachment.id;
}

/** 只保留附件名的最后一段，并移除控制字符，防止路径穿越与异常文件名。 */
function safeAttachmentName(name: string): string {
  const leaf = basename(name.replaceAll("\\", "/"))
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .trim();
  if (!leaf || leaf === "." || leaf === "..") {
    return "attachment";
  }
  return leaf.slice(0, 255);
}

/** 读取落盘文件并做文本真实性校验（NUL 嗅探 + 严格 UTF-8 解码）。 */
async function readUtf8Text(payloadPath: string): Promise<string> {
  const buffer = await readFile(payloadPath);
  const sniff = buffer.subarray(0, SNIFF_BYTES);
  if (sniff.includes(0)) {
    throw new AttachmentInspectionError(
      ATTACHMENT_INSPECTION_ERROR_CODES.TYPE_UNSUPPORTED,
      "附件内容不是有效文本（检测到二进制字节）",
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new AttachmentInspectionError(
      ATTACHMENT_INSPECTION_ERROR_CODES.FETCH_FAILED,
      "附件内容不是有效的 UTF-8 文本",
    );
  }
}

/** 取文件扩展名（小写、不含点）；无扩展名返回空串。 */
function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

