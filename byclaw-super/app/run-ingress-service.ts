import type {
  CallerPrincipal,
  Run,
  RunService,
  Session,
} from "@byclaw/by-conductor";
import {
  type BeyondTokenClaims,
  type BeyondTokenVerifier,
} from "./auth/beyond-token.js";
import type { AuthorizedAgentCatalog } from "./byclaw-be-agent-catalog.js";

interface AuthenticatedIngressRequest {
  beyondToken: string;
  systemCode?: string;
}

export interface CreateSessionRunRequest extends AuthenticatedIngressRequest {
  message: string;
}

export interface AppendSessionRunRequest extends CreateSessionRunRequest {
  sessionId: string;
}

/** 对外统一隐藏“资源不存在”和“资源属于其他调用者”的差异。 */
export class ResourceNotFoundError extends Error {
  constructor(resource: "Session" | "Run") {
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
    const agentList = await this.listAgents(input);
    return this.runService.createSessionRun({
      owner: principal,
      message: input.message,
      agentList,
      // 明文只用于当前实例的快速路径；生产接管从 KMS 密文恢复。
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
    const agentList = await this.listAgents(input);
    return this.runService.createRun({
      sessionId: input.sessionId,
      message: input.message,
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
