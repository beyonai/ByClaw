import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { AuthorizedAgentsProcessor } from "./processors/authorized-agents.js";
import { ContextCleanupProcessor } from "./processors/cleanup.js";
import { GroupChatContextProcessor } from "./processors/group-chat-context.js";
import { SessionContextProcessor } from "./processors/session-context.js";
import { SessionWorkspaceProcessor } from "./processors/session-workspace.js";
import { SupervisorPolicyProcessor } from "./processors/supervisor-policy.js";
import { UserContextProcessor } from "./processors/user-context.js";
import type {
  CompiledContext,
  ContextBuildInput,
  ContextBuildState,
  ContextProcessor,
  ContextProcessorDiagnostic,
} from "./types.js";

/** 为诊断保留具体失败阶段，同时不吞掉原始异常。 */
export class ContextProcessorError extends Error {
  constructor(
    readonly processorName: string,
    options: { cause: unknown },
  ) {
    super(`Context processor failed: ${processorName}`, options);
    this.name = "ContextProcessorError";
  }
}

/**
 * 有序、同步、无外部 I/O 的上下文编译器。
 *
 * 初版只编译 Supervisor 基础规则和 Run 级授权 Agent；后续 Session、Skill、
 * 附件和 Step 状态都应通过新增 processor 扩展，而不是回到 Runtime 中拼字符串。
 */
export class ContextCompiler {
  constructor(
    private readonly processors: readonly ContextProcessor[] = [
      new SupervisorPolicyProcessor(),
      new SessionContextProcessor(),
      new SessionWorkspaceProcessor(),
      new UserContextProcessor(),
      new GroupChatContextProcessor(),
      new AuthorizedAgentsProcessor(),
      new ContextCleanupProcessor(),
    ],
  ) {}

  compile(input: ContextBuildInput): CompiledContext {
    let state: ContextBuildState = {
      stableSystemPrompt: "",
      dynamicSystemSections: [],
    };
    const diagnostics: ContextProcessorDiagnostic[] = [];

    for (const processor of this.processors) {
      const beforeCharacters = contextCharacters(state);
      const startedAt = performance.now();
      try {
        state = processor.process(state, input);
      } catch (cause) {
        throw new ContextProcessorError(processor.name, { cause });
      }
      const totalCharacters = contextCharacters(state);
      diagnostics.push({
        name: processor.name,
        durationMs: performance.now() - startedAt,
        charactersAdded: totalCharacters - beforeCharacters,
        totalCharacters,
      });
    }

    const dynamicSystemContext = state.dynamicSystemSections
      .map(({ content }) => content)
      .join("\n\n");
    const systemPrompt = [state.stableSystemPrompt, dynamicSystemContext]
      .filter(Boolean)
      .join("\n\n");

    return {
      stableSystemPrompt: state.stableSystemPrompt,
      dynamicSystemContext,
      systemPrompt,
      diagnostics: {
        fingerprint: createHash("sha256").update(systemPrompt).digest("hex"),
        totalCharacters: systemPrompt.length,
        // 初版使用保守的字符估算；接入具体模型 tokenizer 后可以替换该实现。
        estimatedTokens: Math.ceil(systemPrompt.length / 4),
        processors: diagnostics,
      },
    };
  }
}

function contextCharacters(state: ContextBuildState): number {
  return (
    state.stableSystemPrompt.length +
    state.dynamicSystemSections.reduce(
      (total, section) => total + section.content.length,
      0,
    )
  );
}
