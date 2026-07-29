import {
  GROUP_CHAT_CONTEXT_MAX_CHARACTERS,
  GROUP_CHAT_CONTEXT_MAX_MESSAGES,
  parseGroupChatContext,
  type GroupChatContextV1,
} from "@byclaw/by-conductor";
import type { ByClawBeEndpointResolver } from "./endpoint-resolver.js";

const GROUP_CHAT_CONTEXT_PATH = "/byaiService/internal/api/v1/group-chat/context";

type FetchLike = typeof globalThis.fetch;

export interface GroupChatContextProvider {
  /** 使用当前调用者 Token 读取严格早于 beforeMessageId 的可见群聊快照。 */
  load(input: {
    conversationKey: string;
    beforeMessageId: string;
    beyondToken: string;
    systemCode?: string;
  }): Promise<GroupChatContextV1>;
}

export interface ByClawBeGroupChatContextProviderOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  endpointResolver?: ByClawBeEndpointResolver;
}

export class ByClawBeGroupChatContextError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ByClawBeGroupChatContextError";
  }
}

/**
 * 群聊正文不接受 Gateway 直接透传；生产 Provider 使用已验签 Token 回源 ByClaw BE，
 * 并在进入 Run 前校验版本、边界、顺序和大小。
 */
export class ByClawBeGroupChatContextProvider
  implements GroupChatContextProvider
{
  readonly #fallbackBaseUrl: URL;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;
  readonly #endpointResolver: ByClawBeEndpointResolver | undefined;

  constructor(options: ByClawBeGroupChatContextProviderOptions) {
    this.#fallbackBaseUrl = normalizeBaseUrl(options.baseUrl);
    this.#timeoutMs = options.timeoutMs;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#endpointResolver = options.endpointResolver;
  }

  async load(input: {
    conversationKey: string;
    beforeMessageId: string;
    beyondToken: string;
    systemCode?: string;
  }): Promise<GroupChatContextV1> {
    const discoveredBaseUrl = await this.#endpointResolver?.resolve();
    const url = buildContextUrl(
      discoveredBaseUrl
        ? normalizeBaseUrl(discoveredBaseUrl)
        : this.#fallbackBaseUrl,
    );
    let response: Response;
    try {
      response = await this.#fetch(`127.0.0.1:8086/byaiServoce/internal/api/v1/group-chat/context`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Beyond-Token": input.beyondToken,
          ...(input.systemCode ? { "System-Code": input.systemCode } : {}),
        },
        body: JSON.stringify({
          conversationKey: input.conversationKey,
          beforeMessageId: input.beforeMessageId,
          maxMessages: GROUP_CHAT_CONTEXT_MAX_MESSAGES,
          maxCharacters: GROUP_CHAT_CONTEXT_MAX_CHARACTERS,
        }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new ByClawBeGroupChatContextError(
        error instanceof Error
          ? `ByClaw BE group chat request failed: ${error.message}`
          : "ByClaw BE group chat request failed",
      );
    }

    if (!response.ok) {
      throw new ByClawBeGroupChatContextError(
        `ByClaw BE group chat returned HTTP ${response.status}`,
        response.status,
      );
    }

    const payload = await parseResponse(response);
    if (
      payload.code !== 0 ||
      payload.success === false ||
      payload.data === undefined
    ) {
      throw new ByClawBeGroupChatContextError(
        `ByClaw BE group chat returned invalid result${
          typeof payload.msg === "string" && payload.msg
            ? `: ${payload.msg}`
            : ""
        }`,
      );
    }

    let context: GroupChatContextV1;
    try {
      context = parseGroupChatContext(payload.data);
    } catch (error) {
      throw new ByClawBeGroupChatContextError(
        error instanceof Error
          ? `ByClaw BE group chat context is invalid: ${error.message}`
          : "ByClaw BE group chat context is invalid",
      );
    }
    if (
      context.conversationKey !== input.conversationKey ||
      context.snapshot.beforeMessageId !== input.beforeMessageId
    ) {
      throw new ByClawBeGroupChatContextError(
        "ByClaw BE group chat context does not match the requested boundary",
      );
    }
    return context;
  }
}

async function parseResponse(
  response: Response,
): Promise<{
  code?: number;
  msg?: string;
  success?: boolean;
  data?: unknown;
}> {
  try {
    return (await response.json()) as {
      code?: number;
      msg?: string;
      success?: boolean;
      data?: unknown;
    };
  } catch {
    throw new ByClawBeGroupChatContextError(
      "ByClaw BE group chat returned invalid JSON",
    );
  }
}

function normalizeBaseUrl(value: string): URL {
  const url = new URL(value);
  url.pathname =
    url.pathname === "/"
      ? "/"
      : `/${url.pathname.replace(/^\/+|\/+$/g, "")}`;
  url.search = "";
  url.hash = "";
  return url;
}

function buildContextUrl(baseUrl: URL): URL {
  const url = new URL(baseUrl);
  const prefix = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  url.pathname = `${prefix}${GROUP_CHAT_CONTEXT_PATH}`;
  return url;
}
