import type { OpenClawPluginApi } from "openclaw/plugin-sdk/compat";
import type { AgentRegistryState } from "./agent-state.js";
import { docAsyncState } from "./doc-async-state.js";

async function readJsonBody(req: any): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    req.on("data", (chunk: any) => {
      chunks.push(typeof chunk === "string" ? chunk : String(chunk ?? ""));
    });
    req.on("end", () => {
      const raw = chunks.join("").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

export function registerBaiyingHttpRoutes(params: {
  api: OpenClawPluginApi;
  registry: AgentRegistryState;
}): void {
  params.api.registerHttpRoute({
    path: "/plugins/baiying-enhance/health",
    auth: "gateway",
    handler: async (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          ok: true,
          plugin: "baiying-enhance",
          agents: params.registry.list().length,
        }),
      );
    },
  });

  params.api.registerHttpRoute({
    path: "/plugins/baiying-enhance/agents",
    auth: "gateway",
    handler: async (_req, res) => {
      const agents = params.registry.list().map((a) => ({
        agentId: a.agentId,
        modelRef: a.modelRef,
        sourceKey: a.sourceKey,
      }));
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, agents }));
    },
  });

  params.api.registerHttpRoute({
    path: "/plugins/baiying-enhance/doc-async/tasks",
    auth: "gateway",
    handler: async (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, tasks: docAsyncState.list(500) }));
    },
  });

  params.api.registerHttpRoute({
    path: "/plugins/baiying-enhance/doc-async/complete",
    auth: "gateway",
    handler: async (req, res) => {
      const body = await readJsonBody(req);
      const taskId =
        (typeof body.task_id === "string" && body.task_id.trim()) ||
        (typeof body.message_id === "string" && body.message_id.trim()) ||
        "";
      if (!taskId) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: "task_id is required" }));
        return;
      }

      if (body.success === false) {
        const task = docAsyncState.fail(
          taskId,
          (typeof body.error === "string" && body.error.trim()) || "doc async failed",
        );
        res.statusCode = task ? 200 : 404;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: !!task, task }));
        return;
      }

      const task = docAsyncState.complete(taskId, body.result ?? body);
      res.statusCode = task ? 200 : 404;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: !!task, task }));
    },
  });
}
