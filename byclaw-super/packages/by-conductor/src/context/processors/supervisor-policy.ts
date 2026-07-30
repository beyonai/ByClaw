import type {
  ContextBuildInput,
  ContextBuildState,
  ContextProcessor,
} from "../types.js";

/** 规范化稳定的 Supervisor 规则，并拒绝空的系统角色。 */
export class SupervisorPolicyProcessor implements ContextProcessor {
  readonly name = "supervisor-policy";

  process(
    state: ContextBuildState,
    input: ContextBuildInput,
  ): ContextBuildState {
    const stableSystemPrompt = input.baseSystemPrompt.trim();
    if (!stableSystemPrompt) {
      throw new Error("Supervisor base system prompt must not be empty");
    }
    return {
      ...state,
      stableSystemPrompt,
    };
  }
}
