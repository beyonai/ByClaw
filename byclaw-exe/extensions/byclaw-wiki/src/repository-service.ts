import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  CodegraphQueryMode,
  CommandResult,
  RepositoryRef,
  RepositoryRuntimeStatus,
  ResolvedByclawWikiConfig,
  WikiPage,
  ZreadStatus,
} from "./types.js";
import { commandSummary, runCommand } from "./command.js";
import { sanitizePathSegment } from "./paths.js";
import {
  syncZreadConfig,
  zreadConfigPath,
  zreadLoginPath,
  type ZreadConfigSyncResult,
} from "./zread-aimodel.js";

type Logger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

type ResolvedRepositoryRef = Required<Pick<RepositoryRef, "repositoryUrl">> &
  Pick<RepositoryRef, "branch" | "credentialRef"> & {
    sanitizedRepositoryUrl: string;
    authenticatedUrl: string;
    localPath: string;
    cacheKey: string;
    gitDepth: number;
  };

type PrepareOptions = {
  refresh?: boolean;
};

export class RepositoryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

export function sanitizeRepositoryUrl(raw: string): string {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    if (url.password) {
      url.password = "***";
    }
    if (url.username) {
      url.username = "***";
    }
    return url.toString();
  } catch {
    return trimmed.replace(/\/\/[^/@]+@/u, "//***@").replace(/:[^/@]+@/u, ":***@");
  }
}

function isAuthFailure(text: string): boolean {
  return /authentication|auth failed|permission denied|could not read username|repository not found|access denied|401|403/iu.test(text);
}

function shortHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

async function exists(target: string): Promise<boolean> {
  return await fs.access(target).then(() => true).catch(() => false);
}

async function readJsonFile(target: string): Promise<unknown> {
  const content = await fs.readFile(target, "utf8");
  return JSON.parse(content) as unknown;
}

function titleFromSlug(slug: string): string {
  return slug
    .replace(/[-_]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\b\w/gu, (match) => match.toUpperCase()) || slug;
}

function extractPagesFromWikiJson(payload: unknown, versionRoot: string): WikiPage[] {
  const candidates: unknown[] = [];
  if (Array.isArray(payload)) {
    candidates.push(...payload);
  } else if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["pages", "files", "documents", "items"]) {
      if (Array.isArray(record[key])) {
        candidates.push(...record[key]);
      }
    }
  }

  return candidates.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const record = item as Record<string, unknown>;
    const rawFile = String(record.file ?? record.path ?? record.filename ?? record.name ?? "").trim();
    if (!rawFile || !rawFile.endsWith(".md")) {
      return [];
    }
    const file = rawFile.replace(/^\/+/u, "");
    const slug = String(record.slug ?? path.basename(file, ".md")).trim() || path.basename(file, ".md");
    return [{
      slug,
      title: String(record.title ?? titleFromSlug(slug)),
      file,
      path: path.join(versionRoot, file),
    }];
  });
}

export class ByclawWikiRepositoryService {
  private readonly statuses = new Map<string, RepositoryRuntimeStatus>();

  constructor(
    private readonly config: ResolvedByclawWikiConfig,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    await fs.mkdir(path.join(this.config.dataDir, "repos"), { recursive: true });
    await fs.mkdir(path.join(this.config.zreadHome, ".zread"), { recursive: true });
  }

  async stop(): Promise<void> {}

  listStatuses(): RepositoryRuntimeStatus[] {
    return [...this.statuses.values()].map((status) => ({ ...status }));
  }

  async getStatus(ref: RepositoryRef): Promise<RepositoryRuntimeStatus> {
    const resolved = this.resolveRepositoryRef(ref);
    return await this.readStatus(resolved);
  }

  async prepare(ref: RepositoryRef, options: PrepareOptions = {}): Promise<RepositoryRuntimeStatus> {
    const resolved = this.resolveRepositoryRef(ref);
    await this.ensureCheckout(resolved, options);
    const indexed = await this.ensureCodegraphIndex(resolved, { refresh: Boolean(options.refresh) });
    const updated = await this.readStatus(resolved);
    if (indexed) {
      updated.lastIndexedAt = new Date().toISOString();
    }
    updated.state = "ready";
    this.statuses.set(resolved.cacheKey, updated);
    return updated;
  }

  async runCodegraph(ref: RepositoryRef, params: {
    mode: CodegraphQueryMode;
    refresh?: boolean;
    query?: string;
    target?: string;
    symbol?: string;
    limit?: number;
    maxDepth?: number;
    filter?: string;
  }): Promise<CommandResult> {
    const status = await this.prepare(ref, { refresh: params.refresh });
    const args = this.buildCodegraphArgs(params);
    return await runCommand(this.config.codegraphCommand, args, {
      cwd: status.localPath,
      timeoutMs: this.config.commandTimeoutMs,
      maxOutputBytes: this.config.maxOutputBytes,
    });
  }

  async getZreadStatus(ref: RepositoryRef): Promise<{ status: RepositoryRuntimeStatus; zread: ZreadStatus }> {
    const status = await this.prepare(ref);
    const zreadConfig = await this.ensureZreadConfig({ required: false });
    return { status, zread: await this.readZreadStatus(status.localPath, zreadConfig) };
  }

  async generateWiki(ref: RepositoryRef, options: {
    draftAction?: "resume" | "clear" | "cancel";
    skipFailed?: boolean;
  }): Promise<{ status: RepositoryRuntimeStatus; zread: ZreadStatus; command: CommandResult }> {
    const status = await this.prepare(ref);
    const zreadConfig = await this.ensureZreadConfig({ required: true });
    const zread = await this.readZreadStatus(status.localPath, zreadConfig);
    if (!zread.installed) {
      throw new RepositoryError("ZREAD_NOT_INSTALLED", "zread CLI is not installed or not available on PATH.");
    }
    if (!zread.hasLogin && !zread.hasConfig) {
      throw new RepositoryError("ZREAD_AUTH_REQUIRED", "zread login or ~/.zread/config.yaml is required before generating Wiki.");
    }
    if (zread.hasDraft) {
      if (!options.draftAction) {
        throw new RepositoryError("ZREAD_DRAFT_ACTION_REQUIRED", "A Zread draft exists. Choose resume, clear, or cancel.");
      }
      if (options.draftAction === "cancel") {
        throw new RepositoryError("ZREAD_DRAFT_ACTION_REQUIRED", "Wiki generation cancelled because a Zread draft exists.");
      }
    }

    const args = ["generate", "--stdio", "-y"];
    if (zread.hasDraft && options.draftAction === "clear") {
      args.push("--draft", "clear");
    } else if (zread.hasDraft && options.draftAction === "resume") {
      args.push("--draft", "resume");
    }
    if (options.skipFailed) {
      args.push("--skip-failed");
    }
    const result = await runCommand(this.config.zreadCommand, args, {
      cwd: status.localPath,
      env: this.zreadEnv(),
      timeoutMs: this.config.zreadTimeoutMs,
      maxOutputBytes: this.config.zreadMaxOutputBytes,
    });
    if (!result.ok) {
      throw new RepositoryError("ZREAD_GENERATE_FAILED", commandSummary(result));
    }
    return { status: await this.readStatus(this.resolveRepositoryRef(ref)), zread: await this.readZreadStatus(status.localPath, zreadConfig), command: result };
  }

  async listWiki(ref: RepositoryRef, wikiVersion = "current"): Promise<{ status: RepositoryRuntimeStatus; version: string; rootPath: string; pages: WikiPage[] }> {
    const status = await this.prepare(ref);
    const rootPath = await this.resolveWikiRoot(status.localPath, wikiVersion);
    const version = await this.resolveWikiVersion(status.localPath, wikiVersion, rootPath);
    const pages = await this.readWikiPages(rootPath);
    return { status, version, rootPath, pages };
  }

  async readWikiPage(ref: RepositoryRef, wikiVersion: string, wikiPage: string): Promise<{ status: RepositoryRuntimeStatus; version: string; rootPath: string; page: WikiPage }> {
    if (!wikiPage.trim()) {
      throw new RepositoryError("ZREAD_PAGE_NOT_FOUND", "wikiPage is required.");
    }
    const listed = await this.listWiki(ref, wikiVersion);
    const target = wikiPage.trim();
    const page = listed.pages.find((item) => item.slug === target || item.file === target || path.basename(item.file, ".md") === target);
    if (!page) {
      throw new RepositoryError("ZREAD_PAGE_NOT_FOUND", `Wiki page not found: ${target}`);
    }
    return {
      ...listed,
      page: {
        ...page,
        markdown: await fs.readFile(page.path, "utf8"),
      },
    };
  }

  async clearWikiDraft(ref: RepositoryRef): Promise<{ status: RepositoryRuntimeStatus; zread: ZreadStatus }> {
    const status = await this.prepare(ref);
    await this.clearZreadDraft(status.localPath);
    return { status, zread: await this.readZreadStatus(status.localPath) };
  }

  private resolveRepositoryRef(ref: RepositoryRef): ResolvedRepositoryRef {
    const repositoryUrl = ref.repositoryUrl?.trim();
    if (!repositoryUrl) {
      throw new RepositoryError("INVALID_REQUEST", "repositoryUrl is required.");
    }
    const branch = ref.branch?.trim() || undefined;
    const sanitizedRepositoryUrl = sanitizeRepositoryUrl(repositoryUrl);
    const credentialRef = ref.credentialRef?.trim() || undefined;
    const token = credentialRef ? process.env[credentialRef]?.trim() : undefined;
    if (credentialRef && !token) {
      throw new RepositoryError("GIT_AUTH_REQUIRED", `Credential environment variable is not configured: ${credentialRef}`);
    }
    const authenticatedUrl = token ? this.buildAuthenticatedUrl(repositoryUrl, token) : repositoryUrl;
    const cacheKey = `${sanitizePathSegment(new URLishPath(repositoryUrl).basename)}-${shortHash(`${repositoryUrl}#${branch ?? "default"}`)}`;
    return {
      repositoryUrl,
      sanitizedRepositoryUrl,
      authenticatedUrl,
      branch,
      credentialRef,
      localPath: path.join(this.config.dataDir, "repos", cacheKey),
      cacheKey,
      gitDepth: Math.max(1, Math.trunc(ref.gitDepth ?? this.config.gitDepth)),
    };
  }

  private buildAuthenticatedUrl(repositoryUrl: string, token: string): string {
    try {
      const url = new URL(repositoryUrl);
      if (url.protocol !== "https:") {
        return repositoryUrl;
      }
      url.username = token;
      url.password = "";
      return url.toString();
    } catch {
      return repositoryUrl;
    }
  }

  private async readStatus(resolved: ResolvedRepositoryRef): Promise<RepositoryRuntimeStatus> {
    const cloned = await exists(path.join(resolved.localPath, ".git"));
    const codegraphIndexed = await exists(path.join(resolved.localPath, ".codegraph"));
    const zread = cloned ? await this.readZreadStatus(resolved.localPath) : undefined;
    const status: RepositoryRuntimeStatus = {
      repositoryUrl: resolved.sanitizedRepositoryUrl,
      sanitizedRepositoryUrl: resolved.sanitizedRepositoryUrl,
      branch: cloned ? await this.readGitBranch(resolved.localPath) : resolved.branch,
      localPath: resolved.localPath,
      state: cloned ? "ready" : "missing",
      cloned,
      codegraphIndexed,
      zreadWikiExists: zread?.hasCurrentWiki ?? false,
      zreadCurrentVersion: zread?.currentVersion,
      lastCommit: cloned ? await this.readGitCommit(resolved.localPath) : undefined,
      lastError: this.statuses.get(resolved.cacheKey)?.lastError,
      lastIndexedAt: this.statuses.get(resolved.cacheKey)?.lastIndexedAt,
    };
    this.statuses.set(resolved.cacheKey, status);
    return status;
  }

  private async ensureCheckout(resolved: ResolvedRepositoryRef, options: PrepareOptions): Promise<RepositoryRuntimeStatus> {
    await fs.mkdir(path.dirname(resolved.localPath), { recursive: true });
    const hasCheckout = await exists(path.join(resolved.localPath, ".git"));

    if (!hasCheckout) {
      const args = ["clone", "--depth", String(resolved.gitDepth), "--single-branch"];
      if (resolved.branch) {
        args.push("--branch", resolved.branch);
      }
      args.push(resolved.authenticatedUrl, resolved.localPath);
      this.logger.info(`byclaw-wiki: cloning ${resolved.sanitizedRepositoryUrl} into ${resolved.localPath}`);
      const result = await runCommand(this.config.gitCommand, args, {
        timeoutMs: this.config.commandTimeoutMs,
        maxOutputBytes: this.config.maxOutputBytes,
      });
      if (!result.ok) {
        this.throwGitError(result, resolved, "GIT_CLONE_FAILED");
      }
      return await this.readStatus(resolved);
    }

    if (options.refresh) {
      const commands = [
        ["fetch", "--depth", String(resolved.gitDepth), "--prune", "origin"],
        ["pull", "--ff-only"],
      ];
      for (const args of commands) {
        const result = await runCommand(this.config.gitCommand, args, {
          cwd: resolved.localPath,
          timeoutMs: this.config.commandTimeoutMs,
          maxOutputBytes: this.config.maxOutputBytes,
        });
        if (!result.ok) {
          this.throwGitError(result, resolved, "GIT_PULL_FAILED");
        }
      }
    }

    return await this.readStatus(resolved);
  }

  private throwGitError(result: CommandResult, resolved: ResolvedRepositoryRef, fallbackCode: string): never {
    const raw = commandSummary(result).replaceAll(resolved.authenticatedUrl, resolved.sanitizedRepositoryUrl);
    const code = isAuthFailure(raw) ? "GIT_AUTH_REQUIRED" : fallbackCode;
    const message = raw.replace(/\/\/[^/@]+@/gu, "//***@").replace(/:[^/@]+@/gu, ":***@");
    const status: RepositoryRuntimeStatus = {
      repositoryUrl: resolved.sanitizedRepositoryUrl,
      sanitizedRepositoryUrl: resolved.sanitizedRepositoryUrl,
      branch: resolved.branch,
      localPath: resolved.localPath,
      state: "error",
      cloned: false,
      codegraphIndexed: false,
      zreadWikiExists: false,
      lastError: message,
    };
    this.statuses.set(resolved.cacheKey, status);
    throw new RepositoryError(code, message);
  }

  private async ensureCodegraphIndex(resolved: ResolvedRepositoryRef, options: { refresh: boolean }): Promise<boolean> {
    const hasIndex = await exists(path.join(resolved.localPath, ".codegraph"));
    if (hasIndex && !options.refresh) {
      return false;
    }
    const commands = hasIndex ? [["sync", "."]] : [["init", "."], ["index", "."]];
    for (const args of commands) {
      const result = await runCommand(this.config.codegraphCommand, args, {
        cwd: resolved.localPath,
        timeoutMs: this.config.commandTimeoutMs,
        maxOutputBytes: this.config.maxOutputBytes,
      });
      if (!result.ok) {
        throw new RepositoryError("CODEGRAPH_INDEX_FAILED", commandSummary(result));
      }
    }
    return true;
  }

  private buildCodegraphArgs(params: {
    mode: CodegraphQueryMode;
    query?: string;
    target?: string;
    symbol?: string;
    limit?: number;
    maxDepth?: number;
    filter?: string;
  }): string[] {
    if (params.mode === "files") {
      const args = ["files", "."];
      if (params.filter?.trim()) {
        args.push("--filter", params.filter.trim());
      }
      if (params.maxDepth && params.maxDepth > 0) {
        args.push("--max-depth", String(Math.trunc(params.maxDepth)));
      }
      return args;
    }

    if (params.mode === "node") {
      const target = params.target?.trim() || params.symbol?.trim() || params.query?.trim();
      if (!target) {
        throw new RepositoryError("INVALID_REQUEST", "mode=node requires target, symbol, or query.");
      }
      return ["node", target];
    }

    if (params.mode === "callers" || params.mode === "callees" || params.mode === "impact") {
      const symbol = params.symbol?.trim() || params.target?.trim() || params.query?.trim();
      if (!symbol) {
        throw new RepositoryError("INVALID_REQUEST", `mode=${params.mode} requires symbol, target, or query.`);
      }
      return [params.mode, symbol];
    }

    const query = params.query?.trim() || params.target?.trim() || params.symbol?.trim();
    if (!query) {
      throw new RepositoryError("INVALID_REQUEST", `mode=${params.mode} requires query, target, or symbol.`);
    }
    const args = [params.mode, query];
    if (params.mode === "query" && params.limit && params.limit > 0) {
      args.push("--limit", String(Math.trunc(params.limit)));
    }
    return args;
  }

  private zreadEnv(): Record<string, string> {
    return {
      HOME: this.config.zreadHome,
    };
  }

  private async ensureZreadConfig(options: { required: boolean }): Promise<ZreadConfigSyncResult> {
    const result = await syncZreadConfig({ config: this.config, logger: this.logger });
    if (!result.ok) {
      this.logger.warn(`byclaw-wiki: Zread model config sync failed: ${result.error}`);
      if (options.required) {
        throw new RepositoryError("ZREAD_MODEL_CONFIG_FAILED", result.error);
      }
    }
    return result;
  }

  private async readZreadStatus(localPath: string, zreadConfig?: ZreadConfigSyncResult): Promise<ZreadStatus> {
    const version = await runCommand(this.config.zreadCommand, ["version"], {
      cwd: localPath,
      env: this.zreadEnv(),
      timeoutMs: 30_000,
      maxOutputBytes: 4096,
    });
    const currentPath = path.join(localPath, ".zread", "wiki", "current");
    const rootPath = await exists(currentPath) ? await this.resolveWikiRoot(localPath, "current").catch(() => currentPath) : currentPath;
    const pages = await exists(rootPath) ? await this.readWikiPages(rootPath).catch(() => []) : [];
    const configPath = zreadConfig?.configPath ?? zreadConfigPath(this.config.zreadHome);
    const hasConfig = await exists(configPath);
    const hasLogin = await exists(zreadLoginPath(this.config.zreadHome));
    const modelSource = zreadConfig?.ok ? zreadConfig.source : hasConfig ? "existing" : "none";
    return {
      installed: version.ok,
      version: version.ok ? (version.stdout || version.stderr).trim() || undefined : undefined,
      hasLogin,
      hasConfig,
      configPath,
      homePath: this.config.zreadHome,
      modelConfigured: hasConfig,
      modelSource,
      modelProvider: zreadConfig?.ok ? zreadConfig.provider : undefined,
      modelName: zreadConfig?.ok ? zreadConfig.model : undefined,
      modelBaseUrl: zreadConfig?.ok ? zreadConfig.baseUrl : undefined,
      modelConfigError: zreadConfig && !zreadConfig.ok ? zreadConfig.error : undefined,
      hasCurrentWiki: await exists(currentPath),
      hasDraft: await exists(path.join(localPath, ".zread", "wiki", "drafts")),
      currentVersion: await this.resolveWikiVersion(localPath, "current", rootPath).catch(() => undefined),
      pageCount: pages.length,
    };
  }

  private async resolveWikiRoot(localPath: string, wikiVersion = "current"): Promise<string> {
    const raw = wikiVersion.trim() || "current";
    const root = raw === "current"
      ? path.join(localPath, ".zread", "wiki", "current")
      : path.join(localPath, ".zread", "wiki", "versions", raw);
    if (!(await exists(root))) {
      throw new RepositoryError("ZREAD_WIKI_NOT_FOUND", `Zread wiki version not found: ${raw}`);
    }
    return await fs.realpath(root).catch(() => root);
  }

  private async resolveWikiVersion(localPath: string, wikiVersion: string, rootPath: string): Promise<string> {
    if (wikiVersion !== "current") {
      return wikiVersion;
    }
    const versionsDir = path.join(localPath, ".zread", "wiki", "versions");
    const relative = path.relative(versionsDir, rootPath);
    return relative && !relative.startsWith("..") ? relative.split(path.sep)[0] ?? "current" : "current";
  }

  private async readWikiPages(rootPath: string): Promise<WikiPage[]> {
    const wikiJson = path.join(rootPath, "wiki.json");
    if (await exists(wikiJson)) {
      const pages = extractPagesFromWikiJson(await readJsonFile(wikiJson), rootPath);
      if (pages.length > 0) {
        return pages;
      }
    }
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => {
        const slug = path.basename(entry.name, ".md");
        return {
          slug,
          title: titleFromSlug(slug),
          file: entry.name,
          path: path.join(rootPath, entry.name),
        };
      });
  }

  private async clearZreadDraft(localPath: string): Promise<void> {
    await fs.rm(path.join(localPath, ".zread", "wiki", "drafts"), { recursive: true, force: true });
  }

  private async readGitCommit(localPath: string): Promise<string | undefined> {
    const result = await runCommand(this.config.gitCommand, ["rev-parse", "HEAD"], {
      cwd: localPath,
      timeoutMs: 30_000,
      maxOutputBytes: 4096,
    });
    return result.ok ? result.stdout.trim() || undefined : undefined;
  }

  private async readGitBranch(localPath: string): Promise<string | undefined> {
    const result = await runCommand(this.config.gitCommand, ["branch", "--show-current"], {
      cwd: localPath,
      timeoutMs: 30_000,
      maxOutputBytes: 4096,
    });
    return result.ok ? result.stdout.trim() || undefined : undefined;
  }
}

class URLishPath {
  readonly basename: string;

  constructor(raw: string) {
    const trimmed = raw.trim().replace(/\/+$/u, "").replace(/\.git$/u, "");
    const last = trimmed.split(/[/:]/u).filter(Boolean).pop();
    this.basename = last || "repository";
  }
}
