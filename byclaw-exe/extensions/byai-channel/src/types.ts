import type { z } from "zod";
import type { ByaiChannelConfigSchema, ByaiSdkConfigSchema } from "./config-schema.js";

export type ByaiChannelConfig = z.infer<typeof ByaiChannelConfigSchema>;
export type ByaiSdkConfig = z.infer<typeof ByaiSdkConfigSchema>;

export interface ResolvedByaiAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  config: ByaiChannelConfig;
}

export interface ByaiInboundMessage {
  requestId: string;
  sessionId: string;
  userId: string;
  text: string;
  callbackUrl: string;
  timestamp: number;
  accountId: string;
}

export interface ByaiProbe {
  ok: boolean;
  listening: boolean;
  port?: number;
  error?: string;
}

// keep the same with byclaw-be [I18nUtil]
export type Language = "zh_CN" | "en_US";

/** SDK 模式入站消息（来自 Redis） */
export interface ByaiSdkInboundMessage {
  messageId: string;
  sessionId: string;
  userId: string;
  text: string;
  timestamp: number;
  traceId: string;
  traceParentSpanId?: string;
  langfuseParentObservationId?: string;
  files?: SdkInboundFile[];
  extraPayload?: Record<string, unknown>;
  accountId: string;
  language: Language;
  /** True when language came from non-empty `LANG` env or non-empty `metadata.language` (hook language templates). */
  languageProvided: boolean;
  /** Optional `metadata.channelExtension` from gateway (object or string). */
  channelExtension?: Record<string, unknown> | string;
  beyondToken?: string;
}

export type SdkInboundFile = {
  fileUrl?: string; // 这种格式的url：commonFile/preview?style=
  filePath?: string; // 这种格式的path：/by/.sessions/
  contentType?: string;
  mimeType?: string;
};

/** SDK 模式处理器依赖 */
export interface SdkProcessorDeps {
  message: ByaiSdkInboundMessage;
  account: ResolvedByaiAccount;
  cfg: import("openclaw/plugin-sdk").OpenClawConfig;
  abortController?: AbortController;
  log?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
  onReply: (text: string, options?: Record<string, any>) => Promise<void>;
  onReasoning?: (delta: string, text: string) => Promise<void>;
  onReasonEnd?: () => Promise<void>;
  onComplete?: () => Promise<void>;
}

/** SDK 运行时上下文 */
export interface SdkRuntimeContext {
  app: import("./sdk-app.js").ByaiSdkApp;
  account: ResolvedByaiAccount;
  cfg: import("openclaw/plugin-sdk").OpenClawConfig;
  log?: SdkProcessorDeps["log"];
}

export type ReplyPayload = {
  text?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  btw?: {
    question: string;
  };
  replyToId?: string;
  replyToTag?: boolean;
  /** True when [[reply_to_current]] was present but not yet mapped to a message id. */
  replyToCurrent?: boolean;
  /** Send audio as voice message (bubble) instead of audio file. Defaults to false. */
  audioAsVoice?: boolean;
  isError?: boolean;
  /** Marks this payload as a reasoning/thinking block. Channels that do not
   *  have a dedicated reasoning lane (e.g. WhatsApp, web) should suppress it. */
  isReasoning?: boolean;
  /** Marks this payload as a compaction status notice (start/end).
   *  Should be excluded from TTS transcript accumulation so compaction
   *  status lines are not synthesised into the spoken assistant reply. */
  isCompactionNotice?: boolean;
  /** Channel-specific payload data (per-channel envelope). */
  channelData?: Record<string, unknown>;
};

export type AgentEvent = {
  seq: number;
  stream: string;
  type?: string;
  runId: string;
  ts?: number;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
  data: Record<string, unknown>;
};

export type PluginHookAgentEndEvent = {
  runId?: string;
  messages: unknown[];
  success: boolean;
  error?: string;
  durationMs?: number;
};

export type PluginHookAgentContext = {
  runId?: string;
  jobId?: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  modelProviderId?: string;
  modelId?: string;
  messageProvider?: string;
  /** Channel/plugin id for channel-originated runs, e.g. `discord`. */
  channel?: string;
  /** Conversation target id for channel-originated runs. Mirrors `channelId` for compatibility. */
  chatId?: string;
  /** Sender identity for channel-originated runs when available. */
  senderId?: string;
  trigger?: string;
  channelId?: string;
  /** Resolved effective context-token budget after model/config/agent caps. */
  contextTokenBudget?: number;
  /** Native/configured reference window when a lower cap wins. */
  contextWindowReferenceTokens?: number;
};
