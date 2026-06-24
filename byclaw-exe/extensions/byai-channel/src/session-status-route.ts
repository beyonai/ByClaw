import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { dispatchGatewayMethod } from "openclaw/plugin-sdk/gateway-method-runtime";
import { getSessionEntry } from "openclaw/plugin-sdk/session-store-runtime";
import { resolveByaiAccount, resolveDefaultByaiAccountId } from "./config.js";
import { getByaiRuntime } from "./runtime.js";
import {
  BYAI_CHANNEL_ID,
  resolveByaiAgentIdFromSessionKey,
  resolveByaiSessionKey,
  resolveSdkTargetAgentId,
} from "./session-key.js";

const ROUTE_PATH = "/plugins/byai-channel/session-status";

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function getQueryParam(req: IncomingMessage, name: string): string {
  const url = new URL(req.url ?? "/", "http://openclaw.local");
  return url.searchParams.get(name)?.trim() ?? "";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function buildSessionStatusPayload(params: {
  sessionKey: string;
  session: unknown;
}): Record<string, unknown> {
  const agentId = resolveByaiAgentIdFromSessionKey(params.sessionKey);
  if (!params.session || typeof params.session !== "object") {
    return {
      ok: true,
      exists: false,
      sessionKey: params.sessionKey,
      agentId,
      fresh: false,
      usedTokens: null,
      contextTokens: null,
      percent: null,
    };
  }

  const row = params.session as Record<string, unknown>;
  const fresh = row.totalTokensFresh !== false;
  const usedTokens = fresh ? numberOrNull(row.totalTokens) : null;
  const contextTokens = numberOrNull(row.contextTokens);
  const percent =
    usedTokens !== null && contextTokens !== null && contextTokens > 0
      ? Math.min(Math.round((usedTokens / contextTokens) * 100), 100)
      : null;

  return {
    ok: true,
    exists: true,
    sessionKey: params.sessionKey,
    agentId,
    fresh,
    usedTokens,
    contextTokens,
    percent,
    status: stringOrNull(row.status),
    hasActiveRun: boolOrNull(row.hasActiveRun),
    modelProvider: stringOrNull(row.modelProvider),
    model: stringOrNull(row.model),
    updatedAt: numberOrNull(row.updatedAt),
  };
}

function isGatewayDispatchScopeError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("Gateway method dispatch is reserved for plugin HTTP routes") ||
    message.includes("authenticated plugin request scope")
  );
}

async function resolveByaiSessionStatusFromStore(
  sessionKey: string,
): Promise<Record<string, unknown>> {
  return buildSessionStatusPayload({
    sessionKey,
    session: getSessionEntry({ sessionKey }),
  });
}

export async function resolveByaiSessionStatus(
  sessionKey: string,
): Promise<Record<string, unknown>> {
  let response: Awaited<ReturnType<typeof dispatchGatewayMethod>>;
  try {
    response = await dispatchGatewayMethod(
      "sessions.describe",
      { key: sessionKey },
      { timeoutMs: 5_000 },
    );
  } catch (err) {
    if (isGatewayDispatchScopeError(err)) {
      return await resolveByaiSessionStatusFromStore(sessionKey);
    }
    throw err;
  }
  if (!response.ok) {
    return {
      ok: false,
      sessionKey,
      agentId: resolveByaiAgentIdFromSessionKey(sessionKey),
      error: response.error ?? {
        code: "gateway_method_failed",
        message: "sessions.describe failed.",
      },
    };
  }

  const payload = response.payload as { session?: unknown } | undefined;
  return buildSessionStatusPayload({
    sessionKey,
    session: payload?.session,
  });
}

export function registerByaiSessionStatusRoute(api: OpenClawPluginApi): void {
  api.registerHttpRoute({
    path: ROUTE_PATH,
    auth: "gateway",
    match: "exact",
    gatewayRuntimeScopeSurface: "trusted-operator",
    handler: async (req, res) => {
      if ((req.method ?? "GET").toUpperCase() !== "GET") {
        res.setHeader("allow", "GET");
        sendJson(res, 405, {
          ok: false,
          error: {
            code: "method_not_allowed",
            message: "Use GET for session status.",
          },
        });
        return true;
      }

      const sessionId = getQueryParam(req, "sessionId");
      const rawAgentId = getQueryParam(req, "agentId");
      if (!sessionId) {
        sendJson(res, 200, {
          ok: false,
          error: {
            code: "invalid_request",
            message: "sessionId is required.",
          },
        });
        return true;
      }

      const accountId = resolveDefaultByaiAccountId(api.config);
      const account = resolveByaiAccount({ cfg: api.config, accountId });
      const runtime = getByaiRuntime();
      const routing = runtime.channel.routing.resolveAgentRoute({
        cfg: api.config,
        channel: BYAI_CHANNEL_ID,
        accountId: account.accountId,
        peer: { kind: "direct", id: sessionId },
      });
      const targetAgentId = resolveSdkTargetAgentId(routing.agentId, {
        agent_id: rawAgentId,
      });
      const sessionKey = resolveByaiSessionKey({
        routing,
        targetAgentId,
        sessionId,
        userId: sessionId,
        perSessionId: account.config.sessionKeyPerSessionId ?? false,
      });

      const status = await resolveByaiSessionStatus(sessionKey);
      if (status.ok === false) {
        sendJson(res, 200, {
          ...status,
          sessionId,
        });
        return true;
      }

      sendJson(res, 200, {
        ...status,
        sessionId,
      });
      return true;
    },
  });
}
