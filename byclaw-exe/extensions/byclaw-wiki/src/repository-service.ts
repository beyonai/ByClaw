import fs from "node:fs/promises";
import path from "node:path";
import type { ResolvedByclawWikiConfig, ResolvedWikiRepositoryConfig, RepositorySyncStatus } from "./types.js";
import { commandSummary, runCommand } from "./command.js";
import { shouldRunWeeklySchedule } from "./schedule.js";

type Logger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

export class ByclawWikiRepositoryService {
  private readonly statuses = new Map<string, RepositorySyncStatus>();
  private syncPromise: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastScheduledRunKey: string | undefined;

  constructor(
    private readonly config: ResolvedByclawWikiConfig,
    private readonly logger: Logger,
  ) {
    for (const repository of config.repositories) {
      this.statuses.set(repository.id, {
        repositoryId: repository.id,
        remoteUrl: repository.remoteUrl,
        branch: repository.branch,
        localPath: repository.localPath,
        state: "idle",
        retryCount: 0,
      });
    }
  }

  async start(): Promise<void> {
    await fs.mkdir(path.join(this.config.dataDir, "repos"), { recursive: true });
    this.timer = setInterval(() => {
      this.checkScheduledSync();
      this.checkRetrySync();
    }, 60_000);
    this.timer.unref();

    if (this.config.runOnStartup) {
      void this.syncAll("startup");
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.syncPromise;
  }

  listStatuses(): RepositorySyncStatus[] {
    return [...this.statuses.values()].map((status) => ({ ...status }));
  }

  getRepository(id?: string): ResolvedWikiRepositoryConfig | undefined {
    const repositoryId = id?.trim() || this.config.defaultRepositoryId;
    return this.config.repositories.find((repository) => repository.id === repositoryId);
  }

  getStatus(id?: string): RepositorySyncStatus | undefined {
    const repository = this.getRepository(id);
    if (!repository) {
      return undefined;
    }
    const status = this.statuses.get(repository.id);
    return status ? { ...status } : undefined;
  }

  async syncAll(reason: string): Promise<void> {
    if (this.syncPromise) {
      return await this.syncPromise;
    }

    this.syncPromise = (async () => {
      this.logger.info(`byclaw-wiki: sync started (${reason})`);
      for (const repository of this.config.repositories) {
        await this.syncRepository(repository);
      }
      this.logger.info("byclaw-wiki: sync finished");
    })().finally(() => {
      this.syncPromise = null;
    });

    return await this.syncPromise;
  }

  async syncRepositoryById(id: string, reason = "manual"): Promise<RepositorySyncStatus> {
    const repository = this.getRepository(id);
    if (!repository) {
      throw new Error(`Unknown repository id: ${id}`);
    }
    await this.syncRepository(repository, reason);
    const status = this.statuses.get(repository.id);
    if (!status) {
      throw new Error(`Missing repository status: ${repository.id}`);
    }
    return { ...status };
  }

  async runCodegraph(params: {
    repositoryId?: string;
    mode: "explore" | "query" | "node" | "files" | "callers" | "callees" | "impact";
    query?: string;
    target?: string;
    symbol?: string;
    limit?: number;
    maxDepth?: number;
    filter?: string;
  }) {
    const repository = this.getRepository(params.repositoryId);
    if (!repository) {
      throw new Error(`Unknown repository id: ${params.repositoryId ?? this.config.defaultRepositoryId}`);
    }

    const codegraphDir = path.join(repository.localPath, ".codegraph");
    try {
      await fs.access(codegraphDir);
    } catch {
      const status = this.statuses.get(repository.id);
      const retryHint = status?.nextRetryAt ? ` Next retry at ${status.nextRetryAt}.` : "";
      throw new Error(
        `Repository ${repository.id} is not cloned or indexed yet.${retryHint} Last error: ${status?.lastError ?? "none"}`,
      );
    }

    const args = this.buildCodegraphArgs(params);
    return await runCommand(this.config.codegraphCommand, args, {
      cwd: repository.localPath,
      timeoutMs: this.config.commandTimeoutMs,
      maxOutputBytes: this.config.maxOutputBytes,
    });
  }

  private checkScheduledSync(): void {
    const decision = shouldRunWeeklySchedule({
      now: new Date(),
      timezone: this.config.timezone,
      dayOfWeek: this.config.syncDayOfWeek,
      hour: this.config.syncHour,
      minute: this.config.syncMinute,
      lastRunKey: this.lastScheduledRunKey,
    });
    if (!decision.run) {
      return;
    }
    this.lastScheduledRunKey = decision.key;
    void this.syncAll("schedule");
  }

  private checkRetrySync(): void {
    if (this.syncPromise) {
      return;
    }
    const now = Date.now();
    const due = this.config.repositories.some((repository) => {
      const status = this.statuses.get(repository.id);
      if (status?.state !== "error" || !status.nextRetryAt) {
        return false;
      }
      return Date.parse(status.nextRetryAt) <= now;
    });
    if (due) {
      void this.syncAll("retry");
    }
  }

  private buildCodegraphArgs(params: {
    mode: "explore" | "query" | "node" | "files" | "callers" | "callees" | "impact";
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
        throw new Error("mode=node requires target, symbol, or query.");
      }
      return ["node", target];
    }

    if (params.mode === "callers" || params.mode === "callees" || params.mode === "impact") {
      const symbol = params.symbol?.trim() || params.target?.trim() || params.query?.trim();
      if (!symbol) {
        throw new Error(`mode=${params.mode} requires symbol, target, or query.`);
      }
      return [params.mode, symbol];
    }

    const query = params.query?.trim() || params.target?.trim() || params.symbol?.trim();
    if (!query) {
      throw new Error(`mode=${params.mode} requires query, target, or symbol.`);
    }
    const args = [params.mode, query];
    if (params.mode === "query" && params.limit && params.limit > 0) {
      args.push("--limit", String(Math.trunc(params.limit)));
    }
    return args;
  }

  private async syncRepository(repository: ResolvedWikiRepositoryConfig, reason = "sync"): Promise<void> {
    const status = this.statuses.get(repository.id) ?? {
      repositoryId: repository.id,
      remoteUrl: repository.remoteUrl,
      branch: repository.branch,
      localPath: repository.localPath,
      state: "idle" as const,
    };
    status.state = "syncing";
    status.lastSyncStartedAt = new Date().toISOString();
    status.lastError = undefined;
    this.statuses.set(repository.id, status);

    try {
      await this.ensureCheckout(repository);
      await this.ensureCodegraphIndex(repository);
      status.lastCommit = await this.readGitCommit(repository);
      status.state = "ready";
      status.lastSyncFinishedAt = new Date().toISOString();
      status.lastIndexedAt = status.lastSyncFinishedAt;
      status.retryCount = 0;
      status.nextRetryAt = undefined;
      this.logger.info(`byclaw-wiki: ${repository.id} indexed (${reason})`);
    } catch (error) {
      status.state = "error";
      status.lastSyncFinishedAt = new Date().toISOString();
      status.lastError = error instanceof Error ? error.message : String(error);
      status.retryCount = (status.retryCount ?? 0) + 1;
      if (status.retryCount >= this.config.retryMaxAttempts) {
        status.nextRetryAt = undefined;
        this.logger.warn(
          `byclaw-wiki: ${repository.id} sync failed ${status.retryCount} time(s); automatic retries stopped: ${status.lastError}`,
        );
      } else {
        status.nextRetryAt = new Date(Date.now() + this.retryDelayMs(status.retryCount)).toISOString();
        this.logger.warn(
          `byclaw-wiki: ${repository.id} sync failed; retry ${status.retryCount} at ${status.nextRetryAt}: ${status.lastError}`,
        );
      }
    }
  }

  private retryDelayMs(retryCount: number): number {
    const exponent = Math.max(0, retryCount - 1);
    const delay = this.config.retryInitialDelayMs * 2 ** exponent;
    return Math.min(delay, this.config.retryMaxDelayMs);
  }

  private async ensureCheckout(repository: ResolvedWikiRepositoryConfig): Promise<void> {
    await fs.mkdir(path.dirname(repository.localPath), { recursive: true });
    const gitDir = path.join(repository.localPath, ".git");
    const hasCheckout = await fs
      .access(gitDir)
      .then(() => true)
      .catch(() => false);

    if (!hasCheckout) {
      this.logger.info(
        `byclaw-wiki: ${repository.id} cloning ${repository.remoteUrl}#${repository.branch} into ${repository.localPath}`,
      );
      const clone = await runCommand(
        this.config.gitCommand,
        [
          "clone",
          "--depth",
          String(this.config.gitDepth),
          "--branch",
          repository.branch,
          "--single-branch",
          repository.remoteUrl,
          repository.localPath,
        ],
        {
          timeoutMs: this.config.commandTimeoutMs,
          maxOutputBytes: this.config.maxOutputBytes,
        },
      );
      if (!clone.ok) {
        throw new Error(commandSummary(clone));
      }
      this.logger.info(`byclaw-wiki: ${repository.id} clone completed in ${clone.durationMs}ms`);
      return;
    }

    for (const args of [
      ["fetch", "--depth", String(this.config.gitDepth), "--prune", "origin", repository.branch],
      ["checkout", "-B", repository.branch, "FETCH_HEAD"],
    ]) {
      this.logger.info(`byclaw-wiki: ${repository.id} running git ${args.join(" ")}`);
      const result = await runCommand(this.config.gitCommand, args, {
        cwd: repository.localPath,
        timeoutMs: this.config.commandTimeoutMs,
        maxOutputBytes: this.config.maxOutputBytes,
      });
      if (!result.ok) {
        throw new Error(commandSummary(result));
      }
      this.logger.info(
        `byclaw-wiki: ${repository.id} git ${args[0] ?? "command"} completed in ${result.durationMs}ms`,
      );
    }
  }

  private async ensureCodegraphIndex(repository: ResolvedWikiRepositoryConfig): Promise<void> {
    const codegraphDir = path.join(repository.localPath, ".codegraph");
    const hasIndex = await fs
      .access(codegraphDir)
      .then(() => true)
      .catch(() => false);

    const commands = hasIndex
      ? [["sync", "."]]
      : [
          ["init", "."],
          ["index", "."],
        ];

    for (const args of commands) {
      this.logger.info(`byclaw-wiki: ${repository.id} running codegraph ${args.join(" ")}`);
      const result = await runCommand(this.config.codegraphCommand, args, {
        cwd: repository.localPath,
        timeoutMs: this.config.commandTimeoutMs,
        maxOutputBytes: this.config.maxOutputBytes,
      });
      if (!result.ok) {
        throw new Error(commandSummary(result));
      }
      this.logger.info(
        `byclaw-wiki: ${repository.id} codegraph ${args[0] ?? "command"} completed in ${result.durationMs}ms`,
      );
    }
  }

  private async readGitCommit(repository: ResolvedWikiRepositoryConfig): Promise<string | undefined> {
    const result = await runCommand(this.config.gitCommand, ["rev-parse", "HEAD"], {
      cwd: repository.localPath,
      timeoutMs: 30_000,
      maxOutputBytes: 4096,
    });
    return result.ok ? result.stdout.trim() || undefined : undefined;
  }
}
