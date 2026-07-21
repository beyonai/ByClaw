import { createWriteStream, promises as fs } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AdaptedManagedAgent, BaiyingHubSkillRef } from "./agent-adapter.js";
import { discoverBackendBaseUrl } from "./backend-service-discovery.js";
import {
  applyEnvAuthOverrides,
  loadAuthContext,
  mergeAuthHeaders,
  resolveAuthFilePath,
} from "./executor/auth.js";
import type { BaiyingRedisJsonStore } from "./redis-json-store.js";
import { resolveStateDir } from "./workspace-paths.js";

const execFileAsync = promisify(execFile);
const HUB_SKILL_METADATA_FILE = ".baiying-hub-skill.json";
const SKILL_DOC_FILE = "SKILL.md";

type LoggerLike = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

export type HubSkillMetadata = {
  skillCode: string;
  version: string;
  skillUrl: string;
  versionUrl: string;
  downloadedAt: string;
};

type HubSkillVersion = {
  version: string;
  skillUrl?: string;
};

export type HubSkillSyncResult = {
  changed: boolean;
  checked: number;
  downloaded: string[];
  skipped: string[];
  failed: string[];
};

const SENSITIVE_HEADER_PATTERN = /authorization|cookie|token|api[-_]?key|secret/i;
const SENSITIVE_URL_PARAM_PATTERN = /authorization|cookie|token|api[-_]?key|secret/i;

function nonEmptyString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function headersForLog(headers: Record<string, string>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [
        name,
        SENSITIVE_HEADER_PATTERN.test(name) ? "[REDACTED]" : value,
      ]),
    ),
  );
}

function urlForLog(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const name of url.searchParams.keys()) {
      if (SENSITIVE_URL_PARAM_PATTERN.test(name)) {
        url.searchParams.set(name, "[REDACTED]");
      }
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function normalizeHeaderName(name: string): string {
  const lower = name.trim().toLowerCase();
  if (lower === "authorization" || lower === "whale_agent_authorization") {
    return "Authorization";
  }
  if (lower === "beyond-token" || lower === "beyond_token") {
    return "Beyond-Token";
  }
  if (lower === "sso-token" || lower === "sso_token") {
    return "Sso-Token";
  }
  if (lower === "x-user-id" || lower === "usercode") {
    return "X-User-Id";
  }
  return "";
}

function copyAllowedHeadersInto(
  target: Record<string, string>,
  source: Record<string, unknown> | undefined | null,
  opts: { overwrite: boolean },
): void {
  if (!source) {
    return;
  }
  for (const [key, rawValue] of Object.entries(source)) {
    const headerName = normalizeHeaderName(key);
    const value = nonEmptyString(rawValue);
    if (!headerName || !value) {
      continue;
    }
    if (opts.overwrite || !target[headerName]) {
      target[headerName] = value;
    }
  }
}

async function loadRedisAuthHeaders(params: {
  redisJsonStore?: BaiyingRedisJsonStore;
}): Promise<Record<string, string>> {
  const store = params.redisJsonStore;
  if (!store?.getHashByKey) {
    return {};
  }
  const candidates: string[] = [];
  const userCode = nonEmptyString(process.env.USER_CODE);
  if (userCode) {
    const mapped = store.getStringByKey
      ? await store.getStringByKey(`SHARE_BFM_USER_CODE_${userCode}`).catch(() => null)
      : null;
    candidates.push(nonEmptyString(mapped), userCode);
  }
  candidates.push(nonEmptyString(process.env.USER_ID), nonEmptyString(process.env.BAIYING_USER_ID));

  for (const userId of Array.from(new Set(candidates.filter(Boolean)))) {
    const authHash = await store.getHashByKey(`user:${userId}:login:auth`).catch(() => null);
    if (!authHash) {
      continue;
    }
    const headers: Record<string, string> = {};
    copyAllowedHeadersInto(headers, authHash, { overwrite: true });
    if (!headers["X-User-Id"] && userCode) {
      headers["X-User-Id"] = userCode;
    }
    return headers;
  }
  return userCode ? { "X-User-Id": userCode } : {};
}

export async function buildHubSkillAuthHeaders(params: {
  redisJsonStore?: BaiyingRedisJsonStore;
  authFilePath?: string;
} = {}): Promise<Record<string, string>> {
  const authContext = await loadAuthContext(resolveAuthFilePath(params.authFilePath));
  const merged = mergeAuthHeaders({
    baseHeaders: {},
    authContext,
    ensureSessionCookie: true,
    ensureUserIdCookie: false,
  }).headers;
  applyEnvAuthOverrides(merged);

  const headers: Record<string, string> = {};
  copyAllowedHeadersInto(headers, merged, { overwrite: true });
  copyAllowedHeadersInto(headers, await loadRedisAuthHeaders(params), { overwrite: true });
  if (!headers["X-User-Id"]) {
    const userCode = nonEmptyString(process.env.USER_CODE);
    if (userCode) {
      headers["X-User-Id"] = userCode;
    }
  }
  return headers;
}

export function resolveHubSkillApiUrl(baseUrl: string, rawUrl: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/g, "");
  const url = rawUrl.trim();
  if (!url) {
    throw new Error("empty hub skill API URL");
  }
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  if (url.startsWith("/")) {
    const origin = new URL(normalizedBase).origin;
    return new URL(url, origin).toString();
  }
  return new URL(url, `${normalizedBase}/`).toString();
}

function parseJsonBody(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function responseSucceeded(json: unknown): boolean {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return false;
  }
  const obj = json as Record<string, unknown>;
  if (obj.success === true) {
    return true;
  }
  if (obj.code === 0 || obj.resultCode === 0) {
    return true;
  }
  return false;
}

function parseVersionResponse(json: unknown): HubSkillVersion | null {
  if (!responseSucceeded(json) || !json || typeof json !== "object" || Array.isArray(json)) {
    return null;
  }
  const data = (json as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const record = data as Record<string, unknown>;
  const version = nonEmptyString(record.version);
  if (!version) {
    return null;
  }
  const skillUrl = nonEmptyString(record.skillUrl);
  return skillUrl ? { version, skillUrl } : { version };
}

async function fetchHubSkillVersion(params: {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}): Promise<HubSkillVersion> {
  const response = await fetch(params.url, {
    headers: params.headers,
    signal: AbortSignal.timeout(params.timeoutMs),
  });
  const bodyText = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`version request failed HTTP ${response.status}: ${bodyText.slice(0, 200)}`);
  }
  const parsed = parseVersionResponse(parseJsonBody(bodyText));
  if (!parsed) {
    throw new Error(`version response missing data.version: ${bodyText.slice(0, 200)}`);
  }
  return parsed;
}

async function readLocalMetadata(skillDir: string): Promise<HubSkillMetadata | null> {
  try {
    const raw = await fs.readFile(path.join(skillDir, HUB_SKILL_METADATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const skillCode = nonEmptyString(record.skillCode);
    const version = nonEmptyString(record.version);
    if (!skillCode || !version) {
      return null;
    }
    return {
      skillCode,
      version,
      skillUrl: nonEmptyString(record.skillUrl),
      versionUrl: nonEmptyString(record.versionUrl),
      downloadedAt: nonEmptyString(record.downloadedAt),
    };
  } catch {
    return null;
  }
}

export async function loadInstalledHubSkillRefs(params: {
  skillCodes: string[];
  stateDir?: string;
}): Promise<BaiyingHubSkillRef[]> {
  const skillsRoot = path.join(params.stateDir ?? resolveStateDir(), "skills");
  const refs: BaiyingHubSkillRef[] = [];
  for (const rawSkillCode of params.skillCodes) {
    const skillCode = nonEmptyString(rawSkillCode);
    if (!skillCode || path.basename(skillCode) !== skillCode) {
      continue;
    }
    const metadata = await readLocalMetadata(path.join(skillsRoot, skillCode));
    if (
      metadata?.skillCode !== skillCode ||
      !metadata.skillUrl ||
      !metadata.versionUrl
    ) {
      continue;
    }
    refs.push({
      skillCode,
      skillUrl: metadata.skillUrl,
      versionUrl: metadata.versionUrl,
    });
  }
  return refs;
}

async function hasSkillDoc(skillDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(skillDir, SKILL_DOC_FILE));
    return true;
  } catch {
    return false;
  }
}

export function validateHubSkillZipEntryName(name: string): void {
  const normalized = name.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`unsafe zip entry path: ${name}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part === "..")) {
    throw new Error(`unsafe zip entry path: ${name}`);
  }
}

async function validateZipEntries(zipPath: string): Promise<void> {
  const { stdout } = await execFileAsync("unzip", ["-Z", "-1", zipPath], {
    maxBuffer: 20 * 1024 * 1024,
  });
  for (const line of stdout.split(/\r?\n/)) {
    const entry = line.trim();
    if (entry) {
      validateHubSkillZipEntryName(entry);
    }
  }
}

async function downloadToFile(params: {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  filePath: string;
}): Promise<void> {
  const response = await fetch(params.url, {
    headers: params.headers,
    signal: AbortSignal.timeout(params.timeoutMs),
  });
  if (!response.ok || !response.body) {
    const bodyText = await response.text().catch(() => "");
    const sentHeaders = Object.keys(params.headers).join(", ");
    throw new Error(
      `download failed HTTP ${response.status}: ${bodyText.slice(0, 200)} (url=${params.url} headers=[${sentHeaders}])`,
    );
  }
  await pipeline(Readable.fromWeb(response.body as any), createWriteStream(params.filePath));
}

async function findExtractedSkillRoot(params: {
  extractDir: string;
  skillCode: string;
}): Promise<string> {
  if (await hasSkillDoc(params.extractDir)) {
    return params.extractDir;
  }
  const entries = await fs.readdir(params.extractDir, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && entry.name !== "__MACOSX")
    .map((entry) => entry.name);
  const matching = dirs.includes(params.skillCode) ? [params.skillCode] : dirs;
  const roots: string[] = [];
  for (const dirName of matching) {
    const candidate = path.join(params.extractDir, dirName);
    if (await hasSkillDoc(candidate)) {
      roots.push(candidate);
    }
  }
  if (roots.length === 1) {
    return roots[0]!;
  }
  throw new Error(`downloaded skill zip must contain one ${SKILL_DOC_FILE}`);
}

async function atomicReplaceSkillDir(params: {
  sourceDir: string;
  targetDir: string;
}): Promise<void> {
  await fs.mkdir(path.dirname(params.targetDir), { recursive: true });
  const swapDir = `${params.targetDir}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const backupDir = `${params.targetDir}.bak-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.cp(params.sourceDir, swapDir, { recursive: true, force: true });
  let hadExisting = false;
  try {
    await fs.rename(params.targetDir, backupDir);
    hadExisting = true;
  } catch (err) {
    const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
    if (code !== "ENOENT") {
      await fs.rm(swapDir, { recursive: true, force: true });
      throw err;
    }
  }
  try {
    await fs.rename(swapDir, params.targetDir);
  } catch (err) {
    if (hadExisting) {
      await fs.rename(backupDir, params.targetDir).catch(() => undefined);
    }
    await fs.rm(swapDir, { recursive: true, force: true });
    throw err;
  }
  if (hadExisting) {
    await fs.rm(backupDir, { recursive: true, force: true });
  }
}

async function installDownloadedSkill(params: {
  skillCode: string;
  downloadUrl: string;
  versionUrl: string;
  version: string;
  headers: Record<string, string>;
  timeoutMs: number;
  targetDir: string;
}): Promise<void> {
  const scratch = await fs.mkdtemp(path.join(tmpdir(), "baiying-hub-skill-"));
  const zipPath = path.join(scratch, `${params.skillCode}.zip`);
  const extractDir = path.join(scratch, "extract");
  try {
    await fs.mkdir(extractDir, { recursive: true });
    await downloadToFile({
      url: params.downloadUrl,
      headers: params.headers,
      timeoutMs: params.timeoutMs,
      filePath: zipPath,
    });
    await validateZipEntries(zipPath);
    await execFileAsync("unzip", ["-q", zipPath, "-d", extractDir], {
      maxBuffer: 20 * 1024 * 1024,
    });
    const skillRoot = await findExtractedSkillRoot({ extractDir, skillCode: params.skillCode });
    await atomicReplaceSkillDir({ sourceDir: skillRoot, targetDir: params.targetDir });
    const metadata: HubSkillMetadata = {
      skillCode: params.skillCode,
      version: params.version,
      skillUrl: params.downloadUrl,
      versionUrl: params.versionUrl,
      downloadedAt: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(params.targetDir, HUB_SKILL_METADATA_FILE),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

export async function syncHubSkillsForManagedAgents(params: {
  managed: Array<Pick<AdaptedManagedAgent, "hubSkills">>;
  redisJsonStore?: BaiyingRedisJsonStore;
  logger?: LoggerLike;
  stateDir?: string;
  baseUrl?: string;
  timeoutMs?: number;
  trigger?: string;
}): Promise<HubSkillSyncResult> {
  const hasAnyHubSkills = params.managed.some((a) => (a.hubSkills?.length ?? 0) > 0);
  if (!hasAnyHubSkills) {
    return { changed: false, checked: 0, downloaded: [], skipped: [], failed: [] };
  }
  const baseUrl =
    params.baseUrl?.replace(/\/+$/g, "") ||
    (await discoverBackendBaseUrl({ logger: params.logger })).replace(/\/+$/g, "");
  if (!baseUrl) {
    throw new Error("backend service discovery returned no usable instance");
  }
  const timeoutMs = Math.max(1000, params.timeoutMs ?? 30_000);
  const headers = await buildHubSkillAuthHeaders({ redisJsonStore: params.redisJsonStore });
  const skillsRoot = path.join(params.stateDir ?? resolveStateDir(), "skills");
  const downloaded: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  const processed = new Set<string>();
  const trigger = nonEmptyString(params.trigger) || "managed-sync";
  const loggedHeaders = headersForLog(headers);

  for (const agent of params.managed) {
    for (const ref of agent.hubSkills ?? []) {
      if (processed.has(ref.skillCode)) {
        continue;
      }
      processed.add(ref.skillCode);

      try {
        const versionUrl = resolveHubSkillApiUrl(baseUrl, ref.versionUrl);
        const targetDir = path.join(skillsRoot, ref.skillCode);
        const local = await readLocalMetadata(targetDir);
        const localSkillDocExists = await hasSkillDoc(targetDir);
        params.logger?.info?.(
          `baiying-enhance: hub skill check request trigger=${trigger} requestType=version skillCode=${ref.skillCode} localVersion=${local?.version ?? "(none)"} url=${urlForLog(versionUrl)} headers=${loggedHeaders}`,
        );
        const version = await fetchHubSkillVersion({ url: versionUrl, headers, timeoutMs });
        const downloadUrl = resolveHubSkillApiUrl(baseUrl, version.skillUrl ?? ref.skillUrl);
        const changed =
          local?.skillUrl !== downloadUrl ||
          local?.version !== version.version ||
          !localSkillDocExists;
        params.logger?.info?.(
          `baiying-enhance: hub skill version checked trigger=${trigger} skillCode=${ref.skillCode} localVersion=${local?.version ?? "(none)"} remoteVersion=${version.version} changed=${changed}`,
        );
        if (!changed) {
          skipped.push(ref.skillCode);
          continue;
        }
        params.logger?.info?.(
          `baiying-enhance: hub skill check request trigger=${trigger} requestType=download skillCode=${ref.skillCode} localVersion=${local?.version ?? "(none)"} remoteVersion=${version.version} url=${urlForLog(downloadUrl)} headers=${loggedHeaders}`,
        );
        await installDownloadedSkill({
          skillCode: ref.skillCode,
          downloadUrl,
          versionUrl,
          version: version.version,
          headers,
          timeoutMs,
          targetDir,
        });
        downloaded.push(ref.skillCode);
        params.logger?.info?.(
          `baiying-enhance: hub skill synced trigger=${trigger} skillCode=${ref.skillCode} version=${version.version}`,
        );
      } catch (err) {
        failed.push(ref.skillCode);
        params.logger?.warn?.(
          `baiying-enhance: hub skill sync failed trigger=${trigger} skillCode=${ref.skillCode}: ${err instanceof Error ? err.message : String(err)}`,
        );
        break;
      }
    }
  }

  return {
    changed: downloaded.length > 0,
    checked: processed.size,
    downloaded,
    skipped,
    failed,
  };
}
