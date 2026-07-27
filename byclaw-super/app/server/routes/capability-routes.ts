import type { FastifyInstance } from "fastify";
import {
  authError,
  requestAuth,
  requestError,
} from "../http-request-utils.js";
import { agentCapabilityCompileBodySchema } from "../http-schemas.js";
import type {
  AgentCapabilityCompileBody,
  BuildHttpAppOptions,
} from "../http-types.js";

/** 注册无状态的 Agent 能力卡编译接口。 */
export function registerCapabilityRoutes(
  app: FastifyInstance,
  options: BuildHttpAppOptions,
): void {
  app.post<{ Body: AgentCapabilityCompileBody }>(
    "/v1/agent-capability-cards/compile",
    { schema: { body: agentCapabilityCompileBodySchema } },
    async (request, reply) => {
      try {
        const auth = requestAuth(request.headers);
        if (!auth) {
          return authError(reply, "Beyond-Token header is required");
        }
        await options.runIngress.resolvePrincipal(auth);
        const compiled = await options.capabilityCompiler.compile(request.body);
        return reply.send(compiled);
      } catch (error) {
        return requestError(reply, error);
      }
    },
  );
}
