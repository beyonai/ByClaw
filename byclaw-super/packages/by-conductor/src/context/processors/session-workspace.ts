import type {
  ContextBuildInput,
  ContextBuildState,
  ContextProcessor,
  SystemContextSection,
} from "../types.js";

const SECTION_ID = "session-workspace";

/** 将 by-framework 的外部 Session 映射为模型必须使用的用户可见会话空间。 */
export class SessionWorkspaceProcessor implements ContextProcessor {
  readonly name = SECTION_ID;

  process(
    state: ContextBuildState,
    input: ContextBuildInput,
  ): ContextBuildState {
    const section = renderSessionWorkspace(input.externalSessionId);
    return {
      ...state,
      dynamicSystemSections: [
        ...state.dynamicSystemSections.filter(({ id }) => id !== SECTION_ID),
        ...(section ? [section] : []),
      ],
    };
  }
}

function renderSessionWorkspace(
  externalSessionId: string | undefined,
): SystemContextSection | undefined {
  if (!externalSessionId) {
    return undefined;
  }
  const workspace = `/by/.sessions/${externalSessionId}/`;
  const content = [
    "<session_workspace>",
    "This request entered through by-framework. The following session workspace metadata is trusted.",
    `By-framework sessionId: ${JSON.stringify(externalSessionId)}`,
    `Canonical session workspace: ${JSON.stringify(workspace)}`,
    "Treat this canonical path as the current session space and working directory for every user-visible file operation.",
    "When asking a specialist to read or create files, explicitly tell it to use this canonical session workspace.",
    "The Leader runtime may expose an internal temporary path under /tmp/byclaw-super-pi/. It is implementation detail only: never call it the current session space, never include it in a delegated task, and never present it to the user as a file location.",
    "Any file path reported to the user must be under the canonical session workspace.",
    "</session_workspace>",
  ].join("\n");
  return { id: SECTION_ID, content };
}
