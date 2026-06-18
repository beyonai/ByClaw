import { createHmac, randomUUID } from "node:crypto";
import type {
  CodegraphMode,
  NotificationRobotType,
  ResolvedNotificationConfig,
  ResolvedWikiRepositoryConfig,
} from "./types.js";

export type DocumentationNotificationRequest = {
  config: ResolvedNotificationConfig;
  repository: ResolvedWikiRepositoryConfig;
  mode?: CodegraphMode;
  question?: string;
  query?: string;
  documentTitle?: string;
  documentMarkdown: string;
};

export type DocumentationNotificationResult = {
  attempted: boolean;
  ok?: boolean;
  skippedReason?: string;
  statusCode?: number;
  error?: string;
};

function resolveWebhookUrl(config: ResolvedNotificationConfig): string | undefined {
  const webhookUrl = config.webhookUrl?.trim();
  if (!webhookUrl) {
    return undefined;
  }
  if (config.robotType !== "dingtalk" || !config.dingtalkSecret?.trim()) {
    return webhookUrl;
  }

  const timestamp = String(Date.now());
  const secret = config.dingtalkSecret.trim();
  const sign = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(`${timestamp}\n${secret}`, "utf8")
    .digest("base64");
  const url = new URL(webhookUrl);
  url.searchParams.set("timestamp", timestamp);
  url.searchParams.set("sign", sign);
  return url.toString();
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 30))}\n\n... output truncated ...`;
}

function buildMarkdown(params: DocumentationNotificationRequest): string {
  const title = params.documentTitle || "Byclaw Wiki: 操作文档待更新";
  const question = params.question || params.query || "(未提供问题)";
  const documentMarkdown = truncateText(params.documentMarkdown.trim(), params.config.maxOutputChars);
  return [
    `# ${title}`,
    "",
    `- 仓库: ${params.repository.id}`,
    `- 分支: ${params.repository.branch}`,
    `- 问题: ${question}`,
    "",
    "## 操作文档草稿",
    "",
    documentMarkdown,
    "",
    "请审核是否需要更新到知识库。",
  ].join("\n");
}

function buildPayload(robotType: NotificationRobotType, markdown: string): unknown {
  switch (robotType) {
    case "wecom":
      return {
        msgtype: "markdown",
        markdown: {
          content: markdown,
        },
      };
    case "dingtalk":
      return {
        msgtype: "markdown",
        msgUuid: randomUUID(),
        markdown: {
          title: "Byclaw Wiki 文档更新提醒",
          text: markdown,
        },
      };
    case "feishu":
      return {
        msg_type: "text",
        content: {
          text: markdown,
        },
      };
    case "generic":
    default:
      return {
        type: "byclaw_wiki_documentation_update_candidate",
        markdown,
      };
  }
}

async function parseRobotResponse(response: Response): Promise<{ ok: boolean; error?: string }> {
  const body = await response.text().catch(() => "");
  if (!body.trim()) {
    return {
      ok: response.ok,
      error: response.ok ? undefined : response.statusText,
    };
  }

  try {
    const payload = JSON.parse(body) as { errcode?: number | string; errmsg?: string };
    if (payload.errcode !== undefined && String(payload.errcode) !== "0") {
      return {
        ok: false,
        error: `errcode=${payload.errcode}, errmsg=${payload.errmsg ?? ""}`.trim(),
      };
    }
    return {
      ok: response.ok,
      error: response.ok ? undefined : body,
    };
  } catch {
    return {
      ok: response.ok,
      error: response.ok ? undefined : body,
    };
  }
}

export async function sendDocumentationNotification(
  params: DocumentationNotificationRequest,
): Promise<DocumentationNotificationResult> {
  const documentMarkdown = params.documentMarkdown.trim();
  if (documentMarkdown.length < params.config.minOutputChars) {
    return {
      attempted: false,
      skippedReason: "output_below_threshold",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  timer.unref();

  try {
    const webhookUrl = resolveWebhookUrl(params.config);
    if (!webhookUrl) {
      return {
        attempted: false,
        skippedReason: "webhook_not_configured",
      };
    }

    const markdown = buildMarkdown(params);
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(buildPayload(params.config.robotType, markdown)),
      signal: controller.signal,
    });
    const robotResponse = await parseRobotResponse(response);

    return {
      attempted: true,
      ok: response.ok && robotResponse.ok,
      statusCode: response.status,
      error: response.ok && robotResponse.ok ? undefined : robotResponse.error ?? response.statusText,
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
