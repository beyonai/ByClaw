import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { ACP, DEFAULTS, GATEWAY } from "./constants.js";
import type { ByclawAcpPlanRequest, ResolvedByclawAcpAdapterConfig } from "./types.js";
import { createByclawAcpPlan } from "./planner.js";
import type { ByclawRegistry } from "./registry.js";
import type { ByclawAcpRunStore } from "./sqlite-store.js";

type GatewayContext = Parameters<Parameters<OpenClawPluginApi["registerGatewayMethod"]>[1]>[0];

function normalizeParams(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}

function respondError(context: GatewayContext, error: unknown): void {
  context.respond(false, undefined, {
    code: GATEWAY.errorCode,
    message: error instanceof Error ? error.message : String(error),
  });
}

export function registerByclawAcpGatewayMethods(params: {
  api: OpenClawPluginApi;
  config: ResolvedByclawAcpAdapterConfig;
  registry: ByclawRegistry;
  store: ByclawAcpRunStore;
}): void {
  const { api, config, registry, store } = params;

  api.registerGatewayMethod(
    GATEWAY.methods.registry,
    async (context) => {
      try {
        context.respond(true, await registry.snapshot());
      } catch (error) {
        respondError(context, error);
      }
    },
    { scope: GATEWAY.scopes.read },
  );

  api.registerGatewayMethod(
    GATEWAY.methods.plan,
    async (context) => {
      try {
        const request = normalizeParams(context.params) as ByclawAcpPlanRequest;
        const plan = createByclawAcpPlan({
          config,
          snapshot: await registry.snapshot(),
          request,
        });
        context.respond(true, { plan });
      } catch (error) {
        respondError(context, error);
      }
    },
    { scope: GATEWAY.scopes.read },
  );

  api.registerGatewayMethod(
    GATEWAY.methods.run,
    async (context) => {
      try {
        const request = normalizeParams(context.params) as ByclawAcpPlanRequest;
        const plan = createByclawAcpPlan({
          config,
          snapshot: await registry.snapshot(),
          request,
        });
        const run = store.createRun({ plan, input: request.input ?? {} });
        context.respond(true, {
          run,
          plan,
          next: {
            type: ACP.nextType,
            params: plan.sessionsSpawn,
          },
        });
      } catch (error) {
        respondError(context, error);
      }
    },
    { scope: GATEWAY.scopes.write },
  );

  api.registerGatewayMethod(
    GATEWAY.methods.runsList,
    async (context) => {
      try {
        const request = normalizeParams(context.params);
        context.respond(true, { runs: store.listRuns(Number(request.limit ?? DEFAULTS.runListLimit)) });
      } catch (error) {
        respondError(context, error);
      }
    },
    { scope: GATEWAY.scopes.read },
  );

  api.registerGatewayMethod(
    GATEWAY.methods.runsShow,
    async (context) => {
      try {
        const request = normalizeParams(context.params);
        const runId = typeof request.runId === "string" ? request.runId : "";
        if (!runId) {
          throw new Error("runId is required.");
        }
        const run = store.getRun(runId);
        if (!run) {
          throw new Error(`ACP run not found: ${runId}`);
        }
        context.respond(true, { run });
      } catch (error) {
        respondError(context, error);
      }
    },
    { scope: GATEWAY.scopes.read },
  );
}
