import type {
  ContextBuildInput,
  ContextBuildState,
  ContextProcessor,
} from "../types.js";

/** 清理空区段和首尾空白，保证最终组装结果稳定。 */
export class ContextCleanupProcessor implements ContextProcessor {
  readonly name = "context-cleanup";

  process(
    state: ContextBuildState,
    _input: ContextBuildInput,
  ): ContextBuildState {
    return {
      stableSystemPrompt: state.stableSystemPrompt.trim(),
      dynamicSystemSections: state.dynamicSystemSections.flatMap((section) => {
        const content = section.content.trim();
        return content ? [{ ...section, content }] : [];
      }),
    };
  }
}
