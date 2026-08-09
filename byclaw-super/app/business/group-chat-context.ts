import {
  GROUP_CHAT_CONTEXT_MAX_CHARACTERS,
  GROUP_CHAT_CONTEXT_MAX_MESSAGES,
  parseGroupChatContext,
  type GroupChatContextV1,
} from "@byclaw/by-conductor";
import type { ByClawBeEndpointResolver } from "./endpoint-resolver.js";
import { normalizeBaseUrl, postByClawBeJson, type FetchLike } from "./byclaw-be-http.js";

const GROUP_CHAT_CONTEXT_PATH = "/byaiService/internal/api/v1/group-chat/context";

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
    const data = await postByClawBeJson({
      fetchImpl: this.#fetch,
      ...(this.#endpointResolver ? { endpointResolver: this.#endpointResolver } : {}),
      fallbackBaseUrl: this.#fallbackBaseUrl,
      timeoutMs: this.#timeoutMs,
      path: GROUP_CHAT_CONTEXT_PATH,
      beyondToken: input.beyondToken,
      ...(input.systemCode ? { systemCode: input.systemCode } : {}),
      body: {
        conversationKey: input.conversationKey,
        beforeMessageId: input.beforeMessageId,
        maxMessages: GROUP_CHAT_CONTEXT_MAX_MESSAGES,
        maxCharacters: GROUP_CHAT_CONTEXT_MAX_CHARACTERS,
      },
      label: "group chat",
      toError: (message, statusCode) =>
        new ByClawBeGroupChatContextError(message, statusCode),
    });

    let context: GroupChatContextV1;
    try {
      context = parseGroupChatContext(data);
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
