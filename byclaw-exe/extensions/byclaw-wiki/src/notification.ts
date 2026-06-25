import { createHmac, randomUUID } from "node:crypto";
import type {
  CodegraphMode,
  NotificationRobotType,
  ResolvedNotificationConfig,
  ResolvedWikiRepositoryConfig,
} from "./types.js";

const DINGTALK_CUSTOM_ROBOT_WEBHOOK = "https://oapi.dingtalk.com/robot/send";

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

function resolveBaseWebhookUrl(config: ResolvedNotificationConfig): string | undefined {
  const webhookUrl = config.webhookUrl?.trim();
  if (!webhookUrl) {
    if (config.robotType !== "dingtalk" || !config.dingtalkAccessToken?.trim()) {
      return undefined;
    }
    const url = new URL(DINGTALK_CUSTOM_ROBOT_WEBHOOK);
    url.searchParams.set("access_token", config.dingtalkAccessToken.trim());
    return url.toString();
  }
  return webhookUrl;
}

function resolveWebhookUrl(config: ResolvedNotificationConfig): string | undefined {
  const webhookUrl = resolveBaseWebhookUrl(config);
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

function resolveNotificationTitle(params: DocumentationNotificationRequest): string {
  return params.documentTitle || "Byclaw Wiki: 操作文档待更新";
}

function buildDocumentName(params: DocumentationNotificationRequest): string {
  const rawName = params.documentTitle || params.question || params.query || "openclaw-document";
  const baseName =
    rawName
      .trim()
      .replace(/[\\/]+/gu, "-")
      .replace(/[\r\n\t]+/gu, " ")
      .replace(/\s+/gu, "-")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/-+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 80) || "byclaw-document";
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14);
  return `${baseName}-${timestamp}.md`;
}

function appendQueryParams(rawUrl: string, queryParams: URLSearchParams): string {
  const hashIndex = rawUrl.indexOf("#");
  const beforeHash = hashIndex >= 0 ? rawUrl.slice(0, hashIndex) : rawUrl;
  const hash = hashIndex >= 0 ? rawUrl.slice(hashIndex) : "";
  const separator = beforeHash.includes("?")
    ? beforeHash.endsWith("?") || beforeHash.endsWith("&")
      ? ""
      : "&"
    : "?";
  return `${beforeHash}${separator}${queryParams.toString()}${hash}`;
}

function buildActionCardButtonUrl(params: DocumentationNotificationRequest): string {
  const rawUrl = params.config.dingtalkActionCardBtnUrl.trim();
  if (!rawUrl) {
    return "";
  }

  const queryParams = new URLSearchParams();
  if (params.config.resourceId?.trim()) {
    queryParams.set("resourceId", params.config.resourceId.trim());
  }
  queryParams.set("directoryPath", params.config.directoryPath.trim() || "/");
  queryParams.set("docName", buildDocumentName(params));
  queryParams.set("doc", truncateText(params.documentMarkdown.trim(), params.config.maxOutputChars));
  queryParams.set("language", "zh-CN");
  return appendQueryParams(rawUrl, queryParams);
}

function buildMarkdown(params: DocumentationNotificationRequest): string {
  const title = resolveNotificationTitle(params);
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

function buildPayload(params: {
  robotType: NotificationRobotType;
  config: ResolvedNotificationConfig;
  title: string;
  markdown: string;
  buttonUrl?: string;
}): unknown {
  const { robotType, config, title, markdown } = params;
  switch (robotType) {
    case "wecom":
      return {
        msgtype: "markdown",
        markdown: {
          content: markdown,
        },
      };
    case "dingtalk":
      {
        const btnTitle = config.dingtalkActionCardBtnTitle.trim() || "通过";
        const btnUrl = params.buttonUrl ?? config.dingtalkActionCardBtnUrl.trim();
        return {
          msgtype: "actionCard",
          msgUuid: randomUUID(),
          actionCard: {
            title,
            text: markdown,
            btnTitle,
            btnUrl,
            singleTitle: btnTitle,
            singleURL: btnUrl,
          },
        };
      }
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

    const title = resolveNotificationTitle(params);
    const markdown = buildMarkdown(params);
    const buttonUrl = buildActionCardButtonUrl(params);
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(
        buildPayload({
          robotType: params.config.robotType,
          config: params.config,
          title,
          markdown,
          buttonUrl,
        }),
      ),
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
