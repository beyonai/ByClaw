import {
  ByFrameworkConnector,
  type ByFrameworkConnectorOptions,
} from "@byclaw/connector-by-framework-common";

export const CODE_BY_FRAMEWORK_CONNECTOR_ID = "code-by-framework";

export type CodeByFrameworkConnectorOptions = Omit<
  ByFrameworkConnectorOptions,
  "connectorId" | "targetAgentTypeResolver"
>;

/** 通过 by-framework Gateway/Redis 协议连接当前用户的 ByClaw Code Worker。 */
export class CodeByFrameworkConnector extends ByFrameworkConnector {
  constructor(options: CodeByFrameworkConnectorOptions = {}) {
    super({
      ...options,
      connectorId: CODE_BY_FRAMEWORK_CONNECTOR_ID,
      targetAgentTypeResolver: (request) => `BYCLAW_CODE_${request.userCode}`,
    });
  }
}
