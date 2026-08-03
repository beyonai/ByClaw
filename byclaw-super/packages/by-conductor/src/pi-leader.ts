import {
  SessionManager,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentCapabilityCardService,
  PiAgentCapabilityDraftGenerator,
  type AgentCapabilityCompileInput,
  type AgentCapabilityCompileResult,
  type AgentCapabilityCompiler,
} from "./application/agent-capability.js";
import { ContextCompiler } from "./context/index.js";
import { SUPER_ASSISTANT_SYSTEM_PROMPT } from "./context/super-assistant-system-prompt.js";
import type { LeaderSession, LeaderSessionFactory } from "./ports/leader.js";
import type { LlmProviderConfig } from "./llm-provider.js";
import { createPiModelRuntime, type PiRuntimeProviderConfig } from "./pi-model-provider.js";
import {
  PiLeaderSession,
  type PiLeaderCompactionConfig,
} from "./pi-leader-session.js";
import { materializePiSessionCheckpoint } from "./pi-session-checkpoint.js";
import type { LeaderCheckpointStore } from "./ports/repositories.js";

export interface PiRuntimeConfig {
  llmProvider: LlmProviderConfig;
  cwd?: string;
  systemPrompt?: string;
  contextCompiler?: ContextCompiler;
  checkpointStore?: LeaderCheckpointStore;
  /** 用于隔离同一主机上的多个实例，不会直接拼入文件路径。 */
  instanceId?: string;
  /** 实例级缓存根目录；工厂会在下面再创建 instance hash 子目录。 */
  sessionCacheDirectory?: string;
  compaction?: {
    enabled?: boolean;
    reserveTokens?: number;
    keepRecentTokens?: number;
  };
}

/** 管理 Pi ModelRuntime 生命周期、Session 隔离缓存与 checkpoint 恢复。 */
export class PiLeaderSessionFactory
  implements LeaderSessionFactory, AgentCapabilityCompiler
{
  private constructor(
    private readonly runtime: Awaited<ReturnType<typeof ModelRuntime.create>>,
    private readonly selectedModel: NonNullable<ReturnType<ModelRuntime["getModel"]>>,
    private readonly cwd: string,
    private readonly systemPrompt: string,
    private readonly contextCompiler: ContextCompiler,
    private readonly capabilityCompiler: AgentCapabilityCompiler,
    private readonly checkpointStore: LeaderCheckpointStore | undefined,
    private readonly sessionCacheDirectory: string,
    private readonly requestAdapter: PiRuntimeProviderConfig["requestAdapter"],
    private readonly thinkingBudgets: PiRuntimeProviderConfig["thinkingBudgets"],
    private readonly compaction: PiLeaderCompactionConfig,
  ) {}

  /** 初始化模型运行时，并准备实例隔离的 Session 缓存目录。 */
  static async create(config: PiRuntimeConfig): Promise<PiLeaderSessionFactory> {
    const { runtime, selectedModel, requestAdapter, thinkingBudgets } =
      await createPiModelRuntime(config.llmProvider);
    const cacheRoot =
      config.sessionCacheDirectory ?? join(tmpdir(), "byclaw-super-pi");
    const instanceCacheDirectory = join(
      cacheRoot,
      cacheScope(config.instanceId ?? `process-${process.pid}`),
    );
    await rm(instanceCacheDirectory, { recursive: true, force: true });
    await mkdir(instanceCacheDirectory, { recursive: true, mode: 0o700 });
    const leaderRoot = config.cwd ?? join(instanceCacheDirectory, "root");
    if (!config.cwd) {
      await mkdir(leaderRoot, { recursive: true, mode: 0o700 });
    }
    return new PiLeaderSessionFactory(
      runtime,
      selectedModel,
      leaderRoot,
      config.systemPrompt ?? SUPER_ASSISTANT_SYSTEM_PROMPT,
      config.contextCompiler ?? new ContextCompiler(),
      new AgentCapabilityCardService(
        new PiAgentCapabilityDraftGenerator(runtime, selectedModel),
      ),
      config.checkpointStore,
      instanceCacheDirectory,
      requestAdapter,
      thinkingBudgets,
      {
        enabled: config.compaction?.enabled ?? true,
        reserveTokens: config.compaction?.reserveTokens ?? 16_384,
        keepRecentTokens: config.compaction?.keepRecentTokens ?? 20_000,
      },
    );
  }

  /** 从 committed checkpoint 恢复，或创建新的隔离 Pi Session。 */
  async create(sessionId: string): Promise<LeaderSession> {
    const directory = join(this.sessionCacheDirectory, sessionId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const sessionCwd = join(directory, "files");
    await mkdir(sessionCwd, { recursive: true, mode: 0o700 });
    const stored = await this.checkpointStore?.load(sessionId);
    const manager = stored
      ? (
          await materializePiSessionCheckpoint(stored.checkpoint, {
            directory,
            cwdOverride: this.cwd,
          })
        ).manager
      : SessionManager.create(this.cwd, directory, { id: sessionId });
    return PiLeaderSession.create(
      this.runtime,
      this.selectedModel,
      sessionCwd,
      this.systemPrompt,
      this.contextCompiler,
      manager,
      stored?.revision ?? 0,
      this.requestAdapter,
      this.thinkingBudgets,
      this.compaction,
    );
  }

  compile(
    input: AgentCapabilityCompileInput,
  ): Promise<AgentCapabilityCompileResult> {
    return this.capabilityCompiler.compile(input);
  }

  async health(): Promise<{ healthy: boolean; model: string }> {
    return {
      healthy: true,
      model: `${this.selectedModel.provider}/${this.selectedModel.id}`,
    };
  }
}

function cacheScope(instanceId: string): string {
  return createHash("sha256").update(instanceId).digest("hex").slice(0, 24);
}
