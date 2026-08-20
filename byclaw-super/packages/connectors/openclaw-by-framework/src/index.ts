import {
  ByFrameworkConnector,
  type ByFrameworkConnectorOptions,
} from "@byclaw/connector-by-framework-common";

export const OPENCLAW_BY_FRAMEWORK_CONNECTOR_ID = "openclaw-by-framework";

export type OpenClawConnectorOptions = Omit<
  ByFrameworkConnectorOptions,
  "connectorId" | "targetAgentTypeResolver" | "promoteOutOfReasoningTextToOutput"
>;

/** 通过公共 by-framework 传输连接当前用户的 OpenClaw Worker。 */
export class OpenClawByFrameworkConnector extends ByFrameworkConnector {
  constructor(options: OpenClawConnectorOptions = {}) {
    super({
      ...options,
      connectorId: OPENCLAW_BY_FRAMEWORK_CONNECTOR_ID,
      targetAgentTypeResolver: (request) =>
        request.agent.execution.targetAgentType?.trim() ||
        `BYCLAW_EXE_${request.userCode}`,
    });
  }
}

export type { RedisConnectionConfig } from "@byclaw/connector-by-framework-common";
