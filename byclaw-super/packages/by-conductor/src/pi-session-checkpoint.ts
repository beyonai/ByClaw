import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CURRENT_SESSION_VERSION,
  SessionManager,
  type SessionEntry,
  type SessionHeader,
} from "@earendil-works/pi-coding-agent";

/** 当前 by-conductor 已验证并锁定的 Pi SDK 版本。 */
export const SUPPORTED_PI_SDK_VERSION = "0.80.10";

/**
 * 可存入 PostgreSQL 的 Pi 原生会话检查点。
 * header/entries 保留 SessionManager 的树、工具结果和 compaction 语义。
 */
export interface PiSessionCheckpoint {
  piSdkVersion: string;
  sessionFormatVersion: number;
  header: SessionHeader;
  entries: SessionEntry[];
  activeLeafId: string | null;
  checksum: string;
}

export interface MaterializePiSessionOptions {
  directory: string;
  cwdOverride: string;
}

/** 检查点损坏、版本不兼容或树结构非法时使用的稳定异常。 */
export class InvalidPiSessionCheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPiSessionCheckpointError";
  }
}

/** 从一个已持久化的 Pi SessionManager 导出数据库检查点。 */
export function exportPiSessionCheckpoint(
  manager: SessionManager,
  piSdkVersion = SUPPORTED_PI_SDK_VERSION,
): PiSessionCheckpoint {
  const header = manager.getHeader();
  if (!header) {
    throw new InvalidPiSessionCheckpointError(
      "Pi SessionManager has no persistent session header",
    );
  }
  const entries = manager.getEntries();
  const activeLeafId = manager.getLeafId();
  return createPiSessionCheckpoint({
    piSdkVersion,
    header,
    entries,
    activeLeafId,
  });
}

/** 从数据库重组 header/entries 时创建带完整校验和的标准检查点。 */
export function createPiSessionCheckpoint(input: {
  piSdkVersion: string;
  header: SessionHeader;
  entries: SessionEntry[];
  activeLeafId: string | null;
}): PiSessionCheckpoint {
  const checkpointWithoutChecksum = {
    piSdkVersion: input.piSdkVersion,
    sessionFormatVersion: input.header.version ?? 1,
    header: structuredClone(input.header),
    entries: structuredClone(input.entries),
    activeLeafId: input.activeLeafId,
  };
  validateCheckpointStructure(checkpointWithoutChecksum);
  return {
    ...checkpointWithoutChecksum,
    checksum: checkpointChecksum(checkpointWithoutChecksum),
  };
}

/**
 * 校验数据库检查点，在实例私有目录重建标准 JSONL，并交给 Pi 原生 open() 恢复。
 * JSONL 是可删除运行缓存；checkpoint 才是持久化真相。
 */
export async function materializePiSessionCheckpoint(
  checkpoint: PiSessionCheckpoint,
  options: MaterializePiSessionOptions,
): Promise<{ manager: SessionManager; filePath: string }> {
  validatePiSessionCheckpoint(checkpoint);
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  await chmod(options.directory, 0o700);
  const filePath = join(options.directory, `${checkpoint.header.id}.jsonl`);
  const lines = [checkpoint.header, ...checkpoint.entries].map((entry) =>
    JSON.stringify(entry),
  );
  await writeFile(filePath, `${lines.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(filePath, 0o600);
  return {
    manager: SessionManager.open(filePath, options.directory, options.cwdOverride),
    filePath,
  };
}

/** 在读数据库后、写本地文件前执行完整版本、checksum 和树结构校验。 */
export function validatePiSessionCheckpoint(checkpoint: PiSessionCheckpoint): void {
  if (checkpoint.piSdkVersion !== SUPPORTED_PI_SDK_VERSION) {
    throw new InvalidPiSessionCheckpointError(
      `Unsupported Pi SDK version: ${checkpoint.piSdkVersion}`,
    );
  }
  if (checkpoint.sessionFormatVersion !== CURRENT_SESSION_VERSION) {
    throw new InvalidPiSessionCheckpointError(
      `Unsupported Pi session format version: ${checkpoint.sessionFormatVersion}`,
    );
  }
  const { checksum, ...withoutChecksum } = checkpoint;
  const expected = checkpointChecksum(withoutChecksum);
  if (checksum !== expected) {
    throw new InvalidPiSessionCheckpointError("Pi session checkpoint checksum mismatch");
  }
  validateCheckpointStructure(withoutChecksum);
}

type CheckpointWithoutChecksum = Omit<PiSessionCheckpoint, "checksum">;

/** SHA-256 覆盖版本、header、entries 和 active leaf，检测数据库或传输层篡改。 */
function checkpointChecksum(checkpoint: CheckpointWithoutChecksum): string {
  // PostgreSQL jsonb 会重排对象键；使用规范化 JSON 才能跨数据库往返保持 checksum。
  return createHash("sha256").update(stableJson(checkpoint)).digest("hex");
}

function stableJson(value: unknown): string {
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return "null";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => {
      const entry = record[key];
      return (
        entry !== undefined &&
        typeof entry !== "function" &&
        typeof entry !== "symbol"
      );
    })
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

/** 校验 V1 服务端线性 Session 所需的不变量，同时允许 Pi 的 append-only entry 类型扩展。 */
function validateCheckpointStructure(checkpoint: CheckpointWithoutChecksum): void {
  if (!isUuid(checkpoint.header.id)) {
    throw new InvalidPiSessionCheckpointError(
      `Pi session id must be a UUID: ${checkpoint.header.id}`,
    );
  }
  if (checkpoint.header.type !== "session") {
    throw new InvalidPiSessionCheckpointError("Pi checkpoint header type must be session");
  }
  if (checkpoint.header.version !== checkpoint.sessionFormatVersion) {
    throw new InvalidPiSessionCheckpointError(
      "Pi checkpoint header and format version do not match",
    );
  }

  const ids = new Set<string>();
  for (const entry of checkpoint.entries) {
    if (!entry.id || ids.has(entry.id)) {
      throw new InvalidPiSessionCheckpointError(
        `Duplicate or empty Pi session entry id: ${entry.id}`,
      );
    }
    if (entry.parentId !== null && !ids.has(entry.parentId)) {
      throw new InvalidPiSessionCheckpointError(
        `Pi session entry ${entry.id} references a missing or later parent`,
      );
    }
    ids.add(entry.id);
  }
  if (
    checkpoint.activeLeafId !== null &&
    !ids.has(checkpoint.activeLeafId)
  ) {
    throw new InvalidPiSessionCheckpointError(
      `Pi active leaf does not exist: ${checkpoint.activeLeafId}`,
    );
  }
  const lastEntryId = checkpoint.entries.at(-1)?.id ?? null;
  if (checkpoint.activeLeafId !== lastEntryId) {
    throw new InvalidPiSessionCheckpointError(
      "V1 persisted Pi sessions require the active leaf to be the last entry",
    );
  }
}

/** 业务 Session ID 固定为 UUID，避免把数据库内容解释为本地路径片段。 */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
