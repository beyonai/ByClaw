import { AgentCapabilityCompileError } from "@byclaw/by-conductor";
import type { FastifyReply } from "fastify";
import { BeyondTokenAuthError } from "../auth/beyond-token.js";
import { ByClawBeAgentCatalogError } from "../business/agent-catalog.js";
import { ResourceNotFoundError } from "../ingress/run-ingress-service.js";

/** 从请求头提取两个入站入口共用的认证信息。 */
export function requestAuth(headers: Record<string, unknown>) {
  const beyondToken = headerString(
    headers["beyond-token"] as string | string[] | undefined,
  );
  if (!beyondToken) {
    return undefined;
  }
  const systemCode = headerString(
    headers["system-code"] as string | string[] | undefined,
  );
  return {
    beyondToken,
    ...(systemCode ? { systemCode } : {}),
  };
}

/** 从 Fastify 请求头值中读取单个非空字符串。 */
export function headerString(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim() : "";
}

/** 返回与 ByClaw 后端 AccessTokenVerifyInterceptor 一致的 401 响应结构。 */
export function authError(reply: FastifyReply, message: string) {
  return reply.code(401).send({
    resultCode: 401,
    resultMsg: message,
    type: 1,
  });
}

/** 将鉴权、资源归属、上游和普通请求异常映射为稳定响应。 */
export function requestError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    error instanceof BeyondTokenAuthError ||
    (error instanceof ByClawBeAgentCatalogError && error.statusCode === 401)
  ) {
    return authError(reply, message);
  }
  if (error instanceof ResourceNotFoundError) {
    return reply.code(404).send({ error: message });
  }
  if (error instanceof AgentCapabilityCompileError) {
    return reply.code(error.statusCode).send({ error: message });
  }
  if (error instanceof ByClawBeAgentCatalogError) {
    return reply.code(502).send({ error: message });
  }
  return reply.code(400).send({ error: message });
}

/** 容错解析 SSE Last-Event-ID；非法值按首次订阅处理。 */
export function parseLastEventId(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * 复刻 @fastify/cors 的 origin 解析逻辑。
 * 被 hijack 的 SSE 响应需要自行决定 Access-Control-Allow-Origin。
 */
export function resolveAccessControlAllowOrigin(
  corsOrigin: string | boolean,
  origin: string,
): string | null {
  if (corsOrigin === false) {
    return null;
  }
  if (corsOrigin === true) {
    return origin || "*";
  }
  if (corsOrigin === "*") {
    return "*";
  }
  return corsOrigin;
}
