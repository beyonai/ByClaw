import type { Run, RunService } from "@byclaw/by-conductor";
import {
  BeyondTokenAuthError,
  type BeyondTokenClaims,
  type BeyondTokenVerifier,
} from "./auth/beyond-token.js";
import type { AuthorizedAgentCatalog } from "./byclaw-be-agent-catalog.js";

const DEFAULT_TENANT_ID = "default";

export interface RunIngressRequest {
  message: string;
  beyondToken: string;
  systemCode?: string;
}

/** 统一 HTTP 与 by-framework Worker 的身份校验、Agent 快照和 Run 创建流程。 */
export class RunIngressService {
  /** 注入编排服务、Token 验证器和授权 Agent Catalog。 */
  constructor(
    private readonly runService: RunService,
    private readonly verifyBeyondToken: BeyondTokenVerifier,
    private readonly agentCatalog: AuthorizedAgentCatalog,
  ) {}

  /** 从 Token 获取用户身份和授权 Agent 快照，并创建内部 Thread 与 Run。 */
  async createRun(input: RunIngressRequest): Promise<Run> {
    const claims = await this.verify(input);
    const agentList = await this.agentCatalog.listAuthorizedAgents({
      beyondToken: input.beyondToken,
      ...(input.systemCode ? { systemCode: input.systemCode } : {}),
    });
    const thread = await this.runService.createThread({
      tenantId: DEFAULT_TENANT_ID,
      userCode: claims.userCode,
    });
    return this.runService.createRun({
      threadId: thread.id,
      message: input.message,
      agentList,
      metadata: { "Beyond-Token": input.beyondToken },
    });
  }

  /** 验证订阅 Token，并确保 Token 用户与 Run 所属用户一致。 */
  async verifyRunOwner(
    expectedUserCode: string,
    input: { beyondToken: string; systemCode?: string },
  ): Promise<BeyondTokenClaims> {
    const claims = await this.verify(input);
    if (claims.userCode !== expectedUserCode) {
      throw new BeyondTokenAuthError("Beyond-Token userCode does not match Run owner");
    }
    return claims;
  }

  /** 调用统一 Beyond-Token 验证器，并透传可选 systemCode。 */
  private verify(input: {
    beyondToken: string;
    systemCode?: string;
  }): Promise<BeyondTokenClaims> | BeyondTokenClaims {
    return this.verifyBeyondToken({
      token: input.beyondToken,
      ...(input.systemCode ? { systemCode: input.systemCode } : {}),
    });
  }
}
