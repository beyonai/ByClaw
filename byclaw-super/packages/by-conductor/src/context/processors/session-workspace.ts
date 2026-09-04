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
    "Use this canonical session workspace for temporary artifacts and temporary files, including intermediate outputs.",
    `Files provided by the user are normally available at ${JSON.stringify(`${workspace}{fileName}`)}; use the actual attachment name or known path instead of inventing one.`,
    "For any task involving files—including locating, listing, reading, parsing, editing, converting, or creating a file—do not perform the file operation yourself. Delegate it to a suitable authorized specialist via delegateAgent.",
    "In the delegated task, explicitly include the canonical session workspace and the relevant file path. Ask the specialist to place temporary artifacts and temporary files under this workspace; let the specialist decide where final deliverables belong according to the task and user requirements.",
    "The Leader runtime may expose an internal temporary path under /tmp/byclaw-super-pi/. It is implementation detail only: never call it the current session space, never include it in a delegated task, and never present it to the user as a file location.",
    "Report the actual file paths returned by specialists; final deliverables may be stored outside the session workspace.",
    "</session_workspace>",
  ].join("\n");
  return { id: SECTION_ID, content };
}
