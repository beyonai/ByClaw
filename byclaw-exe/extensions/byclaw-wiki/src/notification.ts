import { createHmac, randomUUID } from "node:crypto";
import type {
  CodegraphMode,
  NotificationRobotType,
  ResolvedNotificationConfig,
  ResolvedWikiRepositoryConfig,
} from "./types.js";

const DINGTALK_CUSTOM_ROBOT_WEBHOOK = "https://oapi.dingtalk.com/robot/send";
const DEFAULT_DOCUMENT_UPLOAD_BASE_URL = "http://43.139.67.47:8080/";

type UploadedDocumentationFile = {
  key: string;
  name: string;
  size: number;
  contentType: string;
};

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
  uploadedDocument?: UploadedDocumentationFile;
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

function resolveUploadUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return new URL(trimmed).toString();
  } catch {
    const baseUrl =
      process.env.BYCLAW_WIKI_COS_UPLOAD_BASE_URL?.trim() ||
      process.env.BYCLAW_WIKI_WEB_BASE_URL?.trim() ||
      DEFAULT_DOCUMENT_UPLOAD_BASE_URL;
    return new URL(trimmed.startsWith("/") ? trimmed : `/${trimmed}`, baseUrl).toString();
  }
}

async function parseDocumentUploadResponse(response: Response): Promise<UploadedDocumentationFile> {
  const payload = await response.json().catch(() => ({})) as {
    message?: string;
    files?: Array<Partial<UploadedDocumentationFile>>;
  };
  if (!response.ok) {
    throw new Error(payload.message || `document upload failed HTTP ${response.status}`);
  }
  const file = payload.files?.[0];
  if (!file?.key || !file.name || typeof file.size !== "number" || !file.contentType) {
    throw new Error("document upload response did not include a valid files[0] item");
  }
  return {
    key: file.key,
    name: file.name,
    size: file.size,
    contentType: file.contentType,
  };
}

async function uploadGeneratedDocument(
  params: DocumentationNotificationRequest,
  signal: AbortSignal,
): Promise<UploadedDocumentationFile | undefined> {
  const uploadUrl = resolveUploadUrl(params.config.documentUploadUrl);
  if (!uploadUrl) {
    return undefined;
  }

  const fileName = buildDocumentName(params);
  const formData = new FormData();
  const blob = new Blob([params.documentMarkdown.trim()], {
    type: "text/markdown; charset=utf-8",
  });
  formData.append("files", blob, fileName);
  const prefix = params.config.documentUploadPrefix.trim();
  if (prefix) {
    formData.append("prefix", prefix);
  }

  const response = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
    signal,
  });
  return await parseDocumentUploadResponse(response);
}

function buildMarkdown(params: DocumentationNotificationRequest): string {
  const question = params.question || params.query || "(未提供问题)";
  return [
    "有新文档需要审核：",
    "",
    `用户问：《${question}》`,
    "",
    "百应平台赋能助手 已生成文档，点击去审核是否更新到知识库",
  ].join("\n");
}

function buildPayload(params: {
  robotType: NotificationRobotType;
  config: ResolvedNotificationConfig;
  title: string;
  markdown: string;
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
        const btnUrl = config.dingtalkActionCardBtnUrl.trim();
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
    const uploadedDocument = await uploadGeneratedDocument(params, controller.signal);
    const markdown = buildMarkdown(params);
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
      uploadedDocument,
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
