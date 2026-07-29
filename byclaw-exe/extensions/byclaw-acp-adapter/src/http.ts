import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { ACP, HTTP } from "./constants.js";
import type { ByclawAcpPlanRequest, ResolvedByclawAcpAdapterConfig } from "./types.js";
import { createByclawAcpPlan } from "./planner.js";
import type { ByclawRegistry } from "./registry.js";
import type { ByclawAcpRunStore } from "./sqlite-store.js";

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader(HTTP.headers.contentType, HTTP.contentTypes.jsonUtf8);
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > HTTP.maxBodyBytes) {
        reject(new Error("Request body too large."));
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {});
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

export function registerByclawAcpHttpRoutes(params: {
  api: OpenClawPluginApi;
  config: ResolvedByclawAcpAdapterConfig;
  registry: ByclawRegistry;
  store: ByclawAcpRunStore;
}): void {
  const { api, config, registry, store } = params;
  const prefix = config.httpPathPrefix.replace(/\/+$/, "");

  api.registerHttpRoute({
    path: `${prefix}/registry`,
    auth: "gateway",
    match: "exact",
    handler: async (req, res) => {
      if (req.method !== HTTP.methods.get) {
        res.setHeader(HTTP.headers.allow, HTTP.methods.get);
        sendJson(res, HTTP.status.methodNotAllowed, { ok: false, error: { code: "method_not_allowed" } });
        return;
      }
      try {
        sendJson(res, HTTP.status.ok, { ok: true, data: await registry.snapshot() });
      } catch (error) {
        sendJson(res, HTTP.status.internalServerError, { ok: false, error: { message: String(error) } });
      }
    },
  });

  api.registerHttpRoute({
    path: `${prefix}/plan`,
    auth: "gateway",
    match: "exact",
    handler: async (req, res) => {
      if (req.method !== HTTP.methods.post) {
        res.setHeader(HTTP.headers.allow, HTTP.methods.post);
        sendJson(res, HTTP.status.methodNotAllowed, { ok: false, error: { code: "method_not_allowed" } });
        return;
      }
      try {
        const request = (await readJsonBody(req)) as ByclawAcpPlanRequest;
        const plan = createByclawAcpPlan({
          config,
          snapshot: await registry.snapshot(),
          request,
        });
        sendJson(res, HTTP.status.ok, { ok: true, data: { plan } });
      } catch (error) {
        sendJson(res, HTTP.status.badRequest, { ok: false, error: { message: String(error) } });
      }
    },
  });

  api.registerHttpRoute({
    path: `${prefix}/run`,
    auth: "gateway",
    match: "exact",
    handler: async (req, res) => {
      if (req.method !== HTTP.methods.post) {
        res.setHeader(HTTP.headers.allow, HTTP.methods.post);
        sendJson(res, HTTP.status.methodNotAllowed, { ok: false, error: { code: "method_not_allowed" } });
        return;
      }
      try {
        const request = (await readJsonBody(req)) as ByclawAcpPlanRequest;
        const plan = createByclawAcpPlan({
          config,
          snapshot: await registry.snapshot(),
          request,
        });
        const run = store.createRun({ plan, input: request.input ?? {} });
        sendJson(res, HTTP.status.ok, {
          ok: true,
          data: { run, plan, next: { type: ACP.nextType, params: plan.sessionsSpawn } },
        });
      } catch (error) {
        sendJson(res, HTTP.status.badRequest, { ok: false, error: { message: String(error) } });
      }
    },
  });
}
