import type {
  AgentProfile,
  CallerPrincipal,
  GroupChatRefV1,
  Run,
  RunAttachment,
  RunPage,
  RunPageCursor,
  RunService,
  Session,
  SessionContextInput,
  ThinkingLevel,
  LeaderModelSelection,
} from "@byclaw/by-conductor";
import {
  excludeAgentFromGroupChatContext,
  filterDelegableAgents,
  fingerprintGroupChatContext,
  resolveRunMessage,
} from "@byclaw/by-conductor";
import {
  type BeyondTokenClaims,
  type BeyondTokenVerifier,
} from "../auth/beyond-token.js";
import type { AuthorizedAgentCatalog } from "../business/agent-catalog.js";
import type { GroupChatContextProvider } from "../business/group-chat-context.js";
import { truncateForLog } from "../log-format.js";

interface RunIngressLogger {
  info(bindings: Record<string, unknown>, message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
}

export interface ResourceModelResolver {
  resolve(input: {
    resourceId: string;
    beyondToken: string;
    systemCode?: string;
  }): Promise<LeaderModelSelection>;
}

interface AuthenticatedIngressRequest {
  beyondToken: string;
  systemCode?: string;
}

export interface CreateSessionRunRequest extends AuthenticatedIngressRequest {
  /**
   * 用户文本。可选以支持"仅附件"请求；最终消息由 ingress 用 resolveRunMessage 兜底。
   */
  message?: string;
  thinkingLevel?: ThinkingLevel;
  context?: SessionContextInput;
  /** 已规范化的附件（由各入口在调用前 normalize）；缺省为空数组。 */
  attachments?: RunAttachment[];
  /**
   * 当前入口 Agent ID（仅 by-framework Worker 入口提供，用于排除超级助手自身）。
   * HTTP/SSE 入口不得由调用方指定，统一走 userCode 兜底规则。
   */
  sourceAgentId?: string;
  /**
   * by-framework 入站带来的外部 Session ID（仅 by-framework Worker 入口提供）。
   * 用于在 Session 上标记来源并供后续委派声明会话工作区；HTTP 入口不提供。
   */
  externalSessionId?: string;
  /** Gateway 只提供定位引用；正文由 Super 使用当前 Token 从 BE 权威读取。 */
  groupChatRef?: GroupChatRefV1;
}

export interface AppendSessionRunRequest extends CreateSessionRunRequest {
  sessionId: string;
}

/** 对外统一隐藏“资源不存在”和“资源属于其他调用者”的差异。 */
export class ResourceNotFoundError extends Error {
  constructor(resource: "Agent" | "Session" | "Run") {
    super(`${resource} not found`);
    this.name = "ResourceNotFoundError";
  }
}

/**
 * 统一 HTTP 与 by-framework Worker 的身份解析、Session 授权、Agent 快照和 Run 创建流程。
 * Session 是唯一授权根；Run 和 SSE 都通过 Run.sessionId 回溯 Session.owner。
 */
export class RunIngressService {
  readonly #lastKnownLeaderModels = new Map<string, LeaderModelSelection>();

  constructor(
    private readonly runService: RunService,
    private readonly verifyBeyondToken: BeyondTokenVerifier,
    private readonly agentCatalog: AuthorizedAgentCatalog,
    private readonly credentialMaxTtlMs = 7_200_000,
    private readonly groupChatContexts?: GroupChatContextProvider,
    private readonly logger?: RunIngressLogger,
    private readonly resourceModels?: ResourceModelResolver,
  ) {}

  /** 创建新 Session，并在其中创建首个 Run。 */
  async createSessionRun(input: CreateSessionRunRequest): Promise<Run> {
    const authenticated = await this.authenticate(input);
    const principal = authenticated.principal;
    const attachments = input.attachments ?? [];
    const message = resolveRunMessage(input.message, attachments);
    const [catalog, loadedContext, leaderModel] = await Promise.all([
      this.listAgentsForRun(input),
      this.loadIngressContext(input),
      this.loadLeaderModel(input),
    ]);
    const agentList = this.excludeSelf(
      catalog.agents,
      input.sourceAgentId,
      principal.userCode,
    );
    const ingressContext = this.mergeIngressContext(
      loadedContext,
      catalog.error,
      leaderModel,
      input.externalSessionId,
    );
    const run = await this.runService.createSessionRun({
      owner: principal,
      ...(input.context ? { context: input.context } : {}),
      message,
      attachments,
      thinkingLevel: input.thinkingLevel ?? "off",
      agentList,
      ...(ingressContext ? { ingressContext } : {}),
      // Token 同时写入专用短期凭证表，供其他实例在 lease 接管后恢复。
      // externalSessionId 也放入 metadata 供本实例立即执行；持久化真值在 ingressContext。
      metadata: {
        "Beyond-Token": input.beyondToken,
        ...(input.externalSessionId
          ? { externalSessionId: input.externalSessionId }
          : {}),
      },
      executionCredential: {
        secret: input.beyondToken,
        expiresAt: authenticated.credentialExpiresAt,
      },
    });
    this.logRunReceived(
      principal,
      run.sessionId,
      run.id,
      message,
      agentList.length,
      attachments.length,
    );
    return run;
  }

  /** 校验 Session owner 后，在同一 Session/Pi 上下文中追加一个 Run。 */
  async createRun(input: AppendSessionRunRequest): Promise<Run> {
    const authenticated = await this.authenticate(input);
    const principal = authenticated.principal;
    await this.requireOwnedSession(input.sessionId, principal);
    const attachments = input.attachments ?? [];
    const message = resolveRunMessage(input.message, attachments);
    const [catalog, loadedContext, leaderModel] = await Promise.all([
      this.listAgentsForRun(input),
      this.loadIngressContext(input),
      this.loadLeaderModel(input),
    ]);
    const agentList = this.excludeSelf(
      catalog.agents,
      input.sourceAgentId,
      principal.userCode,
    );
    const ingressContext = this.mergeIngressContext(
      loadedContext,
      catalog.error,
      leaderModel,
      input.externalSessionId,
    );
    const run = await this.runService.createRun({
      sessionId: input.sessionId,
      message,
      attachments,
      thinkingLevel: input.thinkingLevel ?? "off",
      agentList,
      ...(ingressContext ? { ingressContext } : {}),
      // 追加 Run 同属 by-framework 入站时也需声明会话工作区。
      metadata: {
        "Beyond-Token": input.beyondToken,
        ...(input.externalSessionId
          ? { externalSessionId: input.externalSessionId }
          : {}),
      },
      executionCredential: {
        secret: input.beyondToken,
        expiresAt: authenticated.credentialExpiresAt,
      },
    });
    this.logRunReceived(
      principal,
      run.sessionId,
      run.id,
      message,
      agentList.length,
      attachments.length,
    );
    return run;
  }

  /** 验证凭证并构建 Worker binding 和 HTTP 授权共用的调用者身份。 */
  async resolvePrincipal(input: AuthenticatedIngressRequest): Promise<CallerPrincipal> {
    return (await this.authenticate(input)).principal;
  }

  /**
   * 使用权威 Agent Catalog 校验当前 Token 对指定 Agent 的实时使用权限。
   * 能力卡表不保存、复制或缓存用户与 Agent 的权限关系。
   */
  async authorizeAgent(
    agentId: string,
    input: AuthenticatedIngressRequest,
  ): Promise<AgentProfile> {
    await this.resolvePrincipal(input);
    const agents = await this.listAgents(input);
    const agent = agents.find((candidate) => candidate.id === agentId);
    if (!agent) {
      throw new ResourceNotFoundError("Agent");
    }
    return agent;
  }

  /** 一次验签同时得到 owner 与凭证有效期，避免同一请求重复验签。 */
  private async authenticate(input: AuthenticatedIngressRequest): Promise<{
    principal: CallerPrincipal;
    credentialExpiresAt: number;
  }> {
    const claims = await this.verify(input);
    const principal: CallerPrincipal = {
      userCode: claims.userCode,
      ...(claimString(claims.userName) || claimString(claims.user_name)
        ? { userName: claimString(claims.userName) || claimString(claims.user_name) }
        : {}),
    };
    const maxExpiresAt = Date.now() + this.credentialMaxTtlMs;
    const jwtExpiresAt =
      typeof claims.exp === "number" ? claims.exp * 1_000 : Number.POSITIVE_INFINITY;
    return {
      principal,
      credentialExpiresAt: Math.min(maxExpiresAt, jwtExpiresAt),
    };
  }

  private async loadIngressContext(
    input: CreateSessionRunRequest,
  ): Promise<
    | {
        groupChat: Awaited<ReturnType<GroupChatContextProvider["load"]>>;
        groupChatFingerprint: string;
      }
    | undefined
  > {
    if (!input.groupChatRef) {
      return undefined;
    }
    if (!this.groupChatContexts) {
      this.warnGroupChatContextUnavailable(
        input,
        new Error("Group chat context provider is not configured"),
      );
      return undefined;
    }
    try {
      const loaded = await this.groupChatContexts.load({
        conversationKey: input.groupChatRef.conversationKey,
        beforeMessageId: input.groupChatRef.beforeMessageId,
        beyondToken: input.beyondToken,
        ...(input.systemCode ? { systemCode: input.systemCode } : {}),
      });
      const groupChat = excludeAgentFromGroupChatContext(
        loaded,
        input.sourceAgentId,
      );
      return {
        groupChat,
        groupChatFingerprint: fingerprintGroupChatContext(groupChat),
      };
    } catch (error) {
      this.warnGroupChatContextUnavailable(input, error);
      return undefined;
    }
  }

  /** 群聊是可选增强；回源失败只告警，不记录 Token/正文，也不阻断主 Run。 */
  private warnGroupChatContextUnavailable(
    input: CreateSessionRunRequest,
    error: unknown,
  ): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.logger?.warn(
      {
        conversationKey: input.groupChatRef?.conversationKey,
        beforeMessageId: input.groupChatRef?.beforeMessageId,
        errorName: normalized.name,
        errorMessage: normalized.message,
      },
      "群聊上下文不可用，本次按普通对话继续",
    );
  }

  /** 记录一次 Run 入站请求，便于在日志中追踪“谁、发了什么、会话维度”。不记录 Token 与凭证。 */
  private logRunReceived(
    principal: CallerPrincipal,
    sessionId: string,
    runId: string,
    message: string,
    agentCount: number,
    attachments: number,
  ): void {
    this.logger?.info(
      {
        userCode: principal.userCode,
        ...(principal.userName ? { userName: principal.userName } : {}),
        sessionId,
        runId,
        message: truncateForLog(message, 200),
        agentCount,
        attachments,
      },
      "收到 Run 请求",
    );
  }

  /** 校验当前调用者是否拥有 Session；不存在和越权统一抛出 ResourceNotFoundError。 */
  async authorizeSession(
    sessionId: string,
    input: AuthenticatedIngressRequest,
  ): Promise<Session> {
    return this.requireOwnedSession(sessionId, await this.resolvePrincipal(input));
  }

  /** 验签并按 Session owner 读取历史 Run；越权与不存在保持相同 404。 */
  async listSessionRuns(
    sessionId: string,
    input: AuthenticatedIngressRequest & {
      limit: number;
      before?: RunPageCursor;
    },
  ): Promise<RunPage> {
    const principal = await this.resolvePrincipal(input);
    const page = await this.runService.listOwnedSessionRuns(
      sessionId,
      principal,
      {
        limit: input.limit,
        ...(input.before ? { before: input.before } : {}),
      },
    );
    if (!page) {
      throw new ResourceNotFoundError("Session");
    }
    return page;
  }

  /** 校验当前调用者是否拥有 Run 所属 Session。 */
  async authorizeRun(
    runId: string,
    input: AuthenticatedIngressRequest,
  ): Promise<{ run: Run; session: Session }> {
    const principal = await this.resolvePrincipal(input);
    const run = await this.runService.getOwnedRun(runId, principal);
    if (!run) {
      throw new ResourceNotFoundError("Run");
    }
    const session = await this.runService.getOwnedSession(run.sessionId, principal);
    if (!session) {
      throw new ResourceNotFoundError("Run");
    }
    return { run, session };
  }

  /** owner 校验后返回 Run 及其 Delegation，供 HTTP 查询接口映射为对外 DTO。 */
  async getRunDetails(
    runId: string,
    input: AuthenticatedIngressRequest,
  ): Promise<NonNullable<Awaited<ReturnType<RunService["getRunDetails"]>>>> {
    const { run } = await this.authorizeRun(runId, input);
    const details = await this.runService.getRunDetails(run.id);
    if (!details) {
      throw new ResourceNotFoundError("Run");
    }
    return details;
  }

  private async requireOwnedSession(
    sessionId: string,
    principal: CallerPrincipal,
  ): Promise<Session> {
    const session = await this.runService.getOwnedSession(sessionId, principal);
    if (!session) {
      throw new ResourceNotFoundError("Session");
    }
    return session;
  }

  private listAgents(input: AuthenticatedIngressRequest) {
    return this.agentCatalog.listAuthorizedAgents({
      beyondToken: input.beyondToken,
      ...(input.systemCode ? { systemCode: input.systemCode } : {}),
    });
  }

  /**
   * Agent 目录是 Run 的可选增强：回源失败时用空授权快照继续，
   * 由 Leader 直接回答，同时把错误保留为用户可见提示。
   */
  private async listAgentsForRun(
    input: AuthenticatedIngressRequest,
  ): Promise<{ agents: AgentProfile[]; error?: string }> {
    try {
      return { agents: await this.listAgents(input) };
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.logger?.warn(
        {
          errorName: normalized.name,
          errorMessage: normalized.message,
        },
        "数字员工列表不可用，本次由超级助手直接处理",
      );
      return { agents: [], error: normalized.message };
    }
  }

  private mergeIngressContext(
    context: Awaited<ReturnType<RunIngressService["loadIngressContext"]>>,
    agentCatalogError: string | undefined,
    leaderModel: LeaderModelSelection | undefined,
    externalSessionId: string | undefined,
  ) {
    if (!context && !agentCatalogError && !leaderModel && !externalSessionId) {
      return undefined;
    }
    return {
      ...(context ?? {}),
      ...(externalSessionId ? { externalSessionId } : {}),
      ...(agentCatalogError ? { agentCatalogError } : {}),
      ...(leaderModel ? { leaderModel } : {}),
    };
  }

  /** 每个新 Run 回源当前资源模型；失败时沿用该资源进程内最后一次有效选择。 */
  private async loadLeaderModel(
    input: CreateSessionRunRequest,
  ): Promise<LeaderModelSelection | undefined> {
    const resourceId = input.sourceAgentId?.trim();
    if (!resourceId || !this.resourceModels) {
      return undefined;
    }
    try {
      const model = await this.resourceModels.resolve({
        resourceId,
        beyondToken: input.beyondToken,
        ...(input.systemCode ? { systemCode: input.systemCode } : {}),
      });
      this.#lastKnownLeaderModels.set(resourceId, model);
      return model;
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const fallback = this.#lastKnownLeaderModels.get(resourceId);
      this.logger?.warn(
        {
          resourceId,
          errorName: normalized.name,
          errorMessage: normalized.message,
          retainedLastKnownModel: Boolean(fallback),
        },
        "超级助手模型绑定不可用，本次沿用最后一次有效模型",
      );
      return fallback;
    }
  }

  /**
   * 应用"不可委派自身"策略：Worker 提供 sourceAgentId 时精确排除当前入口，
   * 否则按鉴权主体的 userCode 兜底排除 `{userCode}_main`。两者并集。
   * 过滤后为空仍允许创建 Run，由 Leader 直接回答。
   */
  private excludeSelf(
    agents: AgentProfile[],
    sourceAgentId: string | undefined,
    principalUserCode: string,
  ): AgentProfile[] {
    return filterDelegableAgents({
      agents,
      ...(sourceAgentId ? { sourceAgentId } : {}),
      principalUserCode,
    });
  }

  private verify(
    input: AuthenticatedIngressRequest,
  ): Promise<BeyondTokenClaims> | BeyondTokenClaims {
    return this.verifyBeyondToken({
      token: input.beyondToken,
      ...(input.systemCode ? { systemCode: input.systemCode } : {}),
    });
  }
}

function claimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
