import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { RepositoryError, type ByclawWikiRepositoryService } from "./repository-service.js";
import { BYCLAW_WIKI_HTTP_PATH } from "./types.js";

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

function readRepositoryRef(body: Record<string, unknown>) {
  return {
    repositoryUrl: typeof body.repositoryUrl === "string" ? body.repositoryUrl : "",
    branch: typeof body.branch === "string" ? body.branch : undefined,
    gitDepth: typeof body.gitDepth === "number" ? body.gitDepth : undefined,
    credentialRef: typeof body.credentialRef === "string" ? body.credentialRef : undefined,
  };
}

export function registerByclawWikiHttpRoute(params: {
  api: OpenClawPluginApi;
  service: ByclawWikiRepositoryService;
}): void {
  params.api.registerHttpRoute({
    path: BYCLAW_WIKI_HTTP_PATH,
    auth: "gateway",
    handler: async (req, res) => {
      if (req.method === "GET") {
        sendJson(res, 200, {
          ok: true,
          repositories: params.service.listStatuses(),
        });
        return;
      }

      if (req.method !== "POST") {
        res.setHeader("allow", "GET, POST");
        sendJson(res, 405, {
          ok: false,
          error: {
            code: "method_not_allowed",
            message: "Use GET for cached status or POST with repositoryUrl to prepare a checkout.",
          },
        });
        return;
      }

      try {
        const body = await readJsonBody(req);
        const ref = readRepositoryRef(body);
        const refresh = typeof body.refresh === "boolean" ? body.refresh : true;
        const status = await params.service.prepare(ref, { refresh });
        sendJson(res, 200, { ok: true, repository: status });
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          error: {
            code: error instanceof RepositoryError ? error.code.toLowerCase() : "prepare_failed",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    },
  });
}
