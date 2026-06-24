import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { ByclawWikiRepositoryService } from "./repository-service.js";
import type { ResolvedByclawWikiConfig } from "./types.js";

const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > MAX_BODY_BYTES) {
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

export function registerByclawWikiHttpRoute(params: {
  api: OpenClawPluginApi;
  config: ResolvedByclawWikiConfig;
  service: ByclawWikiRepositoryService;
}): void {
  params.api.registerHttpRoute({
    path: params.config.httpPath,
    auth: "gateway",
    handler: async (req, res) => {
      if (req.method === "GET") {
        sendJson(res, 200, {
          ok: true,
          repositories: params.service.listStatuses(),
          schedule: {
            timezone: params.config.timezone,
            dayOfWeek: params.config.syncDayOfWeek,
            hour: params.config.syncHour,
            minute: params.config.syncMinute,
          },
        });
        return;
      }

      if (req.method !== "POST") {
        res.setHeader("allow", "GET, POST");
        sendJson(res, 405, {
          ok: false,
          error: {
            code: "method_not_allowed",
            message: "Use GET for status or POST for manual sync.",
          },
        });
        return;
      }

      try {
        const body = await readJsonBody(req);
        const repositoryId = typeof body.repositoryId === "string" ? body.repositoryId : undefined;
        if (repositoryId) {
          const status = await params.service.syncRepositoryById(repositoryId);
          sendJson(res, 200, { ok: true, repositories: [status] });
          return;
        }
        await params.service.syncAll("http");
        sendJson(res, 200, { ok: true, repositories: params.service.listStatuses() });
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          error: {
            code: "sync_failed",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    },
  });
}
