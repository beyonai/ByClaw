import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { ByaiInboundMessage, ResolvedByaiAccount } from "./types.js";
import { registerWebhookContext } from "./session-context.js";

export interface WebhookHandlerDeps {
  account: ResolvedByaiAccount;
  cfg: OpenClawConfig;
  log?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
  onMessage: (message: ByaiInboundMessage) => Promise<void>;
}

/** 读取请求体 */
function readBody(req: IncomingMessage, maxSize = 10 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxSize) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/** 发送 JSON 响应 */
function respond(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createWebhookHandler(deps: WebhookHandlerDeps) {
  const { account, cfg, log, onMessage } = deps;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    log?.info?.(`[byai-channel] Received ${req.method} ${req.url}`);

    if (req.method !== "POST") {
      log?.warn?.(`[byai-channel] Method not allowed: ${req.method}`);
      respond(res, 405, { error: `[byai-channel] Method not allowed: ${req.method}` });
      return;
    }

    // 读取请求体
    let body: string;
    try {
      body = await readBody(req);
    } catch (err) {
      log?.error?.(`Failed to read request body: ${String(err)}`);
      respond(res, 400, { error: "Failed to read request body" });
      return;
    }

    // 解析请求
    let payload: {
      requestId: string;
      sessionId: string;
      userId: string;
      message: string;
      callbackUrl: string;
      accountId?: string;
    };

    try {
      payload = JSON.parse(body);
    } catch {
      respond(res, 400, { error: "Invalid JSON" });
      return;
    }

    // 验证必要字段
    if (!payload.requestId || !payload.message || !payload.callbackUrl) {
      respond(res, 400, { error: "Missing required fields: requestId, message, callbackUrl" });
      return;
    }

    const userId = payload.userId ?? "anonymous";
    const allowFrom = account.config.allowFrom ?? [];

    // 检查 allowlist
    if (allowFrom.length > 0 && !allowFrom.includes("*") && !allowFrom.includes(userId)) {
      log?.warn?.(`User ${userId} not in allowlist`);
      respond(res, 403, { error: "User not authorized" });
      return;
    }

    log?.info?.(`[byai-channel] Message from ${userId}: ${payload.message.slice(0, 100)}...`);

    // 构建入站消息对象
    const message: ByaiInboundMessage = {
      requestId: payload.requestId,
      sessionId: payload.sessionId ?? payload.requestId,
      userId,
      text: payload.message,
      callbackUrl: payload.callbackUrl,
      timestamp: Date.now(),
      accountId: account.accountId,
    };
    registerWebhookContext(message);

    // 立即返回 202 Accepted（异步处理）
    respond(res, 202, { ok: true, requestId: message.requestId });

    // 异步处理消息
    try {
      await onMessage(message);
    } catch (err) {
      log?.error?.(`[byai-channel] Failed to process message: ${String(err)}`);
      // 发送错误回调
      await sendReplyCallback(
        message.callbackUrl,
        message.requestId,
        message.sessionId,
        `Error processing message: ${String(err)}`,
        { done: true, log },
      );
    }
  };
}

// 发送回复回调的辅助函数
export async function sendReplyCallback(
  callbackUrl: string,
  requestId: string,
  sessionId: string,
  message: string,
  options: { done?: boolean; messageId?: string; log?: { error?: (msg: string) => void } } = {},
): Promise<boolean> {
  try {
    const response = await fetch(callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId,
        sessionId,
        message,
        messageId: options.messageId,
        done: options.done ?? false,
      }),
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => "unknown error");
      if (response.status === 404) {
        options.log?.info?.(`Callback skipped: connection not found (browser likely refreshed)`);
      }
      return false;
    }

    return true;
  } catch (err) {
    options.log?.error?.(`Failed to send callback: ${String(err)}`);
    return false;
  }
}
