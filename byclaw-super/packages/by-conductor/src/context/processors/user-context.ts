import type {
  ContextBuildInput,
  ContextBuildState,
  ContextProcessor,
  SystemContextSection,
} from "../types.js";

const SECTION_ID = "user-context";

/** 注入可信的调用者身份（userCode/userName），供 Leader 做个性化与多租户语境判断。 */
export class UserContextProcessor implements ContextProcessor {
  readonly name = "user-context";

  process(
    state: ContextBuildState,
    input: ContextBuildInput,
  ): ContextBuildState {
    const section = renderUserContext(input);
    return {
      ...state,
      dynamicSystemSections: [
        ...state.dynamicSystemSections.filter(({ id }) => id !== SECTION_ID),
        ...(section ? [section] : []),
      ],
    };
  }
}

function renderUserContext(
  input: ContextBuildInput,
): SystemContextSection | undefined {
  const { user } = input;
  if (!user) {
    return undefined;
  }
  const userName = user.userName?.trim();
  const lines = [
    "<user_context>",
    "This is trusted caller metadata.",
    `User code: ${user.userCode}`,
    ...(userName ? [`User name: ${userName}`] : []),
    "</user_context>",
  ];
  return { id: SECTION_ID, content: lines.join("\n") };
}
