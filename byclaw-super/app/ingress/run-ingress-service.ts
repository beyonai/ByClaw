import type {
  AgentProfile,
  CallerPrincipal,
  Run,
  RunPage,
  RunPageCursor,
  RunService,
  Session,
  SessionContextInput,
  ThinkingLevel,
} from "@byclaw/by-conductor";
import { filterDelegableAgents } from "@byclaw/by-conductor";
import {
  type BeyondTokenClaims,
  type BeyondTokenVerifier,
} from "../auth/beyond-token.js";
import type { AuthorizedAgentCatalog } from "../business/agent-catalog.js";

interface AuthenticatedIngressRequest {
  beyondToken: string;
  systemCode?: string;
}

export interface CreateSessionRunRequest extends AuthenticatedIngressRequest {
  message: string;
  thinkingLevel?: ThinkingLevel;
  context?: SessionContextInput;
  /**
   * 当前入口 Agent ID（仅 by-framework Worker 入口提供，用于排除超级助手自身）。
   * HTTP/SSE 入口不得由调用方指定，统一走 userCode 兜底规则。
   */
  sourceAgentId?: string;
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
  constructor(
    private readonly runService: RunService,
    private readonly verifyBeyondToken: BeyondTokenVerifier,
    private readonly agentCatalog: AuthorizedAgentCatalog,
    private readonly credentialMaxTtlMs = 7_200_000,
  ) {}

  /** 创建新 Session，并在其中创建首个 Run。 */
  async createSessionRun(input: CreateSessionRunRequest): Promise<Run> {
    const authenticated = await this.authenticate(input);
    const principal = authenticated.principal;
    const agentList = this.excludeSelf(
      await this.listAgents(input),
      input.sourceAgentId,
      principal.userCode,
    );
    return this.runService.createSessionRun({
      owner: principal,
      ...(input.context ? { context: input.context } : {}),
      message: input.message,
      thinkingLevel: input.thinkingLevel ?? "off",
      agentList,
      // Token 同时写入专用短期凭证表，供其他实例在 lease 接管后恢复。
      metadata: { "Beyond-Token": input.beyondToken },
      executionCredential: {
        secret: input.beyondToken,
        expiresAt: authenticated.credentialExpiresAt,
      },
    });
  }

  /** 校验 Session owner 后，在同一 Session/Pi 上下文中追加一个 Run。 */
  async createRun(input: AppendSessionRunRequest): Promise<Run> {
    const authenticated = await this.authenticate(input);
    const principal = authenticated.principal;
    await this.requireOwnedSession(input.sessionId, principal);
    const agentList = this.excludeSelf(
      await this.listAgents(input),
      input.sourceAgentId,
      principal.userCode,
    );
    return this.runService.createRun({
      sessionId: input.sessionId,
      message: input.message,
      thinkingLevel: input.thinkingLevel ?? "off",
      agentList,
      metadata: { "Beyond-Token": input.beyondToken },
      executionCredential: {
        secret: input.beyondToken,
        expiresAt: authenticated.credentialExpiresAt,
      },
    });
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
