import type { FastifyInstance } from "fastify";
import {
  authError,
  requestAuth,
  requestError,
} from "../http-request-utils.js";
import {
  agentCapabilityCompileBodySchema,
  agentCapabilityParamSchema,
  agentCapabilityUpsertBodySchema,
} from "../http-schemas.js";
import type {
  AgentCapabilityCompileBody,
  AgentCapabilityParams,
  AgentCapabilityUpsertBody,
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

  app.put<{
    Params: AgentCapabilityParams;
    Body: AgentCapabilityUpsertBody;
  }>(
    "/v1/agents/:agentId/capability-card",
    {
      schema: {
        params: agentCapabilityParamSchema,
        body: agentCapabilityUpsertBodySchema,
      },
    },
    async (request, reply) => {
      try {
        const auth = requestAuth(request.headers);
        if (!auth) {
          return authError(reply, "Beyond-Token header is required");
        }
        if (!auth.systemCode) {
          return reply.code(400).send({
            error: "System-Code header is required",
          });
        }
        await options.runIngress.authorizeAgent(
          request.params.agentId,
          auth,
        );
        const { sourceVersion, ...compileInput } = request.body;
        const compiled = await options.capabilityCompiler.compile(compileInput);
        await options.capabilityCards.upsert({
          systemCode: auth.systemCode,
          agentId: request.params.agentId,
          ...(request.body.agent.code
            ? { agentCode: request.body.agent.code }
            : {}),
          agentName: request.body.agent.name,
          ...(sourceVersion ? { sourceVersion } : {}),
          compiled,
          now: Date.now(),
        });
        return reply.send({
          systemCode: auth.systemCode,
          agentId: request.params.agentId,
          ...(sourceVersion ? { sourceVersion } : {}),
          ...compiled,
        });
      } catch (error) {
        return requestError(reply, error);
      }
    },
  );
}
