import {
  ByFrameworkConnector,
  type ByFrameworkConnectorOptions,
} from "@byclaw/connector-by-framework-common";

export const CODE_BY_FRAMEWORK_CONNECTOR_ID = "code-by-framework";

export type CodeByFrameworkConnectorOptions = Omit<
  ByFrameworkConnectorOptions,
  | "connectorId"
  | "targetAgentTypeResolver"
  | "agentReturnMode"
  | "promoteOutOfReasoningTextToOutput"
>;

/** 通过 by-framework Gateway/Redis 协议连接当前用户的 ByClaw Code Worker。 */
export class CodeByFrameworkConnector extends ByFrameworkConnector {
  constructor(options: CodeByFrameworkConnectorOptions = {}) {
    super({
      ...options,
      connectorId: CODE_BY_FRAMEWORK_CONNECTOR_ID,
      targetAgentTypeResolver: (request) => `BYCLAW_CODE_${request.userCode}`,
      // BYCLAW_CODE 的 Agent 回调会复用外层 messageId，连续委派时会被 BY_SUPER
      // WorkerRunner 当作已完成执行去重。改为直接结束会话流，与其直调链路一致。
      agentReturnMode: "direct",
      // BYCLAW_CODE 的子会话 assistant 正文使用 reasoningLogDelta/1002 承载。
      promoteOutOfReasoningTextToOutput: true,
    });
  }
}
