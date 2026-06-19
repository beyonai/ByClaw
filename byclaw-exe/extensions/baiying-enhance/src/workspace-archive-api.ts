import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { discoverBackendBaseUrl } from "./backend-service-discovery.js";

const execFileAsync = promisify(execFile);

export type WorkspaceArchiveKind = "cancel_auth" | "delete";

type LoggerLike = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type WorkspaceArchiveStatus = {
  exists: boolean;
  objectKey?: string;
  archivePath?: string;
  sha256?: string;
};

export type WorkspaceArchiveApi = {
  status: (params: { userCode: string; resourceId: string; archiveKind: WorkspaceArchiveKind }) => Promise<WorkspaceArchiveStatus>;
  uploadWorkspace: (params: { userCode: string; resourceId: string; archiveKind: WorkspaceArchiveKind; workspaceDir: string }) => Promise<WorkspaceArchiveStatus>;
  downloadWorkspace: (params: { userCode: string; resourceId: string; archiveKind: WorkspaceArchiveKind; destinationWorkspaceDir: string }) => Promise<boolean>;
};

function archiveFetchTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.BAIYING_WORKSPACE_ARCHIVE_FETCH_TIMEOUT_MS || "5000", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
}

async function fetchArchive(url: string | URL, init?: RequestInit & { duplex?: "half" }): Promise<Response> {
  const timeoutMs = archiveFetchTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...(init ?? {}),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`workspace archive request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeUserCode(userCode?: string): string {
  return (userCode ?? process.env.USER_CODE ?? "").trim();
}

function archiveFileName(archiveKind: WorkspaceArchiveKind): string {
  return archiveKind === "delete" ? "del_latest.tar.gz" : "cancel_auth_latest.tar.gz";
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function createWorkspaceTarGz(workspaceDir: string, archiveKind: WorkspaceArchiveKind): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const scratch = await fs.mkdtemp(path.join(tmpdir(), "baiying-workspace-archive-"));
  const filePath = path.join(scratch, archiveFileName(archiveKind));
  await execFileAsync("tar", ["-czf", filePath, "-C", path.dirname(workspaceDir), path.basename(workspaceDir)]);
  return {
    filePath,
    cleanup: async () => {
      await fs.rm(scratch, { recursive: true, force: true });
    },
  };
}

async function extractWorkspaceTarGz(archiveFilePath: string, destinationWorkspaceDir: string): Promise<void> {
  await fs.mkdir(path.dirname(destinationWorkspaceDir), { recursive: true });
  await execFileAsync("tar", ["-xzf", archiveFilePath, "-C", path.dirname(destinationWorkspaceDir)]);
}

async function responseTextSafe(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function responseData(json: unknown): Record<string, unknown> {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return {};
  }
  const obj = json as Record<string, unknown>;
  return obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)
    ? (obj.data as Record<string, unknown>)
    : {};
}

function parseStatus(json: unknown): WorkspaceArchiveStatus {
  const data = responseData(json);
  return {
    exists: data.exists === true,
    objectKey: typeof data.objectKey === "string" ? data.objectKey : undefined,
    archivePath: typeof data.archivePath === "string" ? data.archivePath : undefined,
    sha256: typeof data.sha256 === "string" ? data.sha256 : undefined,
  };
}

function parseJsonSafe(text: string): unknown {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function assertSuccessJson(json: unknown): void {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("invalid JSON response");
  }
  const obj = json as Record<string, unknown>;
  if (obj.code !== 0) {
    throw new Error(typeof obj.msg === "string" ? obj.msg : "workspace archive API failed");
  }
}

function buildMultipartBody(filePath: string, filename: string): Promise<{ body: Readable; headers: Record<string, string> }> {
  return fs.stat(filePath).then((stat) => {
    const boundary = `----baiying-workspace-archive-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/gzip\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    async function* parts() {
      yield head;
      yield* createReadStream(filePath);
      yield tail;
    }
    return {
      body: Readable.from(parts()),
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(head.length + stat.size + tail.length),
      },
    };
  });
}

export function createWorkspaceArchiveApi(params: { logger?: LoggerLike } = {}): WorkspaceArchiveApi {
  const resolveBaseUrl = async (): Promise<string> => {
    const baseUrl = await discoverBackendBaseUrl({ logger: params.logger });
    if (!baseUrl) {
      throw new Error("backend service discovery returned no usable instance");
    }
    return baseUrl;
  };

  const urlFor = async (p: { userCode: string; resourceId: string; archiveKind: WorkspaceArchiveKind; suffix?: string }): Promise<string> => {
    const url = new URL(`${await resolveBaseUrl()}/open/api/inner/v1/workspace-archive/dig-employees/${encodeURIComponent(p.resourceId)}${p.suffix ?? ""}`);
    url.searchParams.set("userCode", p.userCode);
    url.searchParams.set("archiveKind", p.archiveKind);
    return url.toString();
  };

  const status = async ({ userCode, resourceId, archiveKind }: { userCode: string; resourceId: string; archiveKind: WorkspaceArchiveKind }) => {
    const normalizedUserCode = normalizeUserCode(userCode);
    const response = await fetchArchive(await urlFor({ userCode: normalizedUserCode, resourceId, archiveKind, suffix: "/status" }));
    const bodyText = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(`workspace archive status failed HTTP ${response.status}: ${bodyText}`);
    }
    const json = parseJsonSafe(bodyText);
    assertSuccessJson(json);
    return parseStatus(json);
  };

  return {
    status,
    uploadWorkspace: async ({ userCode, resourceId, archiveKind, workspaceDir }) => {
      const normalizedUserCode = normalizeUserCode(userCode);
      const archive = await createWorkspaceTarGz(workspaceDir, archiveKind);
      try {
        const sha256 = await sha256File(archive.filePath);
        const url = new URL(await urlFor({ userCode: normalizedUserCode, resourceId, archiveKind }));
        url.searchParams.set("sha256", sha256);
        const multipart = await buildMultipartBody(archive.filePath, archiveFileName(archiveKind));
        const response = await fetchArchive(url, {
          method: "POST",
          headers: multipart.headers,
          body: multipart.body,
          duplex: "half",
        } as RequestInit & { duplex: "half" });
        const bodyText = await response.text().catch(() => "");
        if (!response.ok) {
          throw new Error(`workspace archive upload failed HTTP ${response.status}: ${bodyText}`);
        }
        const json = parseJsonSafe(bodyText);
        assertSuccessJson(json);
        return parseStatus(json);
      } finally {
        await archive.cleanup();
      }
    },
    downloadWorkspace: async ({ userCode, resourceId, archiveKind, destinationWorkspaceDir }) => {
      const normalizedUserCode = normalizeUserCode(userCode);
      const archiveStatus = await status({ userCode: normalizedUserCode, resourceId, archiveKind });
      if (!archiveStatus.exists) {
        return false;
      }
      const scratch = await fs.mkdtemp(path.join(tmpdir(), "baiying-workspace-restore-"));
      const archiveFilePath = path.join(scratch, archiveFileName(archiveKind));
      try {
        const response = await fetchArchive(await urlFor({ userCode: normalizedUserCode, resourceId, archiveKind }));
        if (!response.ok || !response.body) {
          throw new Error(`workspace archive download failed HTTP ${response.status}: ${await responseTextSafe(response)}`);
        }
        await pipeline(Readable.fromWeb(response.body as any), createWriteStream(archiveFilePath));
        await extractWorkspaceTarGz(archiveFilePath, destinationWorkspaceDir);
        return true;
      } finally {
        await fs.rm(scratch, { recursive: true, force: true });
      }
    },
  };
}
