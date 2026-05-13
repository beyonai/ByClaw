import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { ResolvedByclawSqliteConfig } from "./types.js";
import type { SqliteExecutor } from "./sqlite-executor.js";

const MAX_BODY_BYTES = 512 * 1024;

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
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
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    req.on("error", reject);
  });
}

function resolveStatusCode(result: ReturnType<SqliteExecutor["execute"]>): number {
  if (result.ok) {
    return 200;
  }
  return result.error.code === "invalid_request" || result.error.code === "write_disabled"
    ? 400
    : 500;
}

export function registerSqlExecuteHttpRoute(params: {
  api: OpenClawPluginApi;
  config: ResolvedByclawSqliteConfig;
  executor: SqliteExecutor;
}): void {
  params.api.registerHttpRoute({
    path: params.config.httpPath,
    auth: "gateway",
    handler: async (req, res) => {
      if (req.method !== "POST") {
        res.setHeader("allow", "POST");
        sendJson(res, 405, {
          ok: false,
          error: {
            code: "method_not_allowed",
            message: "Use POST for sqlExecute.",
          },
        });
        return;
      }

      try {
        const body = await readJsonBody(req);
        const result = params.executor.execute(body);
        sendJson(res, resolveStatusCode(result), result);
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          error: {
            code: "invalid_request",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    },
  });
}
