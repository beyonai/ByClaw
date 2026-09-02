import { ContextCompiler } from "./context-compiler.js";
import { buildExpertTeamSystemPrompt } from "./expert-team-system-prompt.js";
import { AuthorizedAgentsProcessor } from "./processors/authorized-agents.js";
import { ContextCleanupProcessor } from "./processors/cleanup.js";
import { SessionContextProcessor } from "./processors/session-context.js";
import { SupervisorPolicyProcessor } from "./processors/supervisor-policy.js";
import { TaskPlanProcessor } from "./processors/task-plan.js";
import type {
  CompiledContext,
  ContextBuildInput,
  SystemContextCompiler,
} from "./types.js";

/**
 * 编排类型到 Context Pipeline 的唯一选择点。
 * 超级助手保持原有完整流水线；专家团只注入必要环境与成员快照。
 */
export class OrchestratorContextCompiler implements SystemContextCompiler {
  readonly #superAssistant = new ContextCompiler();
  readonly #expertTeam = new ContextCompiler([
    new SupervisorPolicyProcessor(),
    new SessionContextProcessor(),
    new TaskPlanProcessor(),
    new AuthorizedAgentsProcessor(),
    new ContextCleanupProcessor(),
  ]);

  compile(input: ContextBuildInput): CompiledContext {
    if (!input.orchestrator) {
      return this.#superAssistant.compile(input);
    }
    return this.#expertTeam.compile({
      ...input,
      baseSystemPrompt: buildExpertTeamSystemPrompt(input.orchestrator),
    });
  }
}
