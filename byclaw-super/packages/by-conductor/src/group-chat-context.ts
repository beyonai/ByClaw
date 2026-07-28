import { createHash } from "node:crypto";

export const GROUP_CHAT_REF_SCHEMA_VERSION = "byclaw.group-chat-ref/v1" as const;
export const GROUP_CHAT_CONTEXT_SCHEMA_VERSION =
  "byclaw.group-chat-context/v1" as const;

export const GROUP_CHAT_CONTEXT_MAX_MESSAGES = 60;
export const GROUP_CHAT_CONTEXT_MAX_CHARACTERS = 30_000;

export interface GroupChatRefV1 {
  schemaVersion: typeof GROUP_CHAT_REF_SCHEMA_VERSION;
  conversationKey: string;
  /** 当前 @Super 消息 ID；BE 必须只返回严格早于该消息的历史。 */
  beforeMessageId: string;
}

export type GroupChatSpeakerV1 =
  | {
      type: "user";
      userCode: string;
      displayName?: string;
    }
  | {
      type: "agent";
      agentId: string;
      agentName: string;
    };

export interface GroupChatMessageV1 {
  messageId: string;
  sequence: number;
  createdAt: number;
  role: "user" | "assistant";
  speaker: GroupChatSpeakerV1;
  target?: {
    type: "agent";
    agentId: string;
    agentName?: string;
  };
  content: string;
  attachments?: Array<{
    fileId: string;
    fileName: string;
    mediaType?: string;
  }>;
}

export interface GroupChatContextV1 {
  schemaVersion: typeof GROUP_CHAT_CONTEXT_SCHEMA_VERSION;
  conversationKey: string;
  snapshot: {
    beforeMessageId: string;
    lastIncludedMessageId?: string;
    generatedAt: number;
  };
  messages: GroupChatMessageV1[];
  truncation: {
    truncated: boolean;
    omittedMessageCount: number;
    reason?: "message_limit" | "character_limit";
  };
}

/**
 * 入口动态上下文属于 Run 的不可变快照；执行时只把尚未导入的消息增量
 * 写入 Pi 原生 transcript，原始 Run 快照仍保留用于审计和重试。
 */
export interface RunIngressContextV1 {
  groupChat?: GroupChatContextV1;
  groupChatFingerprint?: string;
}

export function parseGroupChatRef(value: unknown): GroupChatRefV1 {
  const record = requiredRecord(value, "groupChat");
  if (record.schemaVersion !== GROUP_CHAT_REF_SCHEMA_VERSION) {
    throw new Error(
      `groupChat.schemaVersion must be ${GROUP_CHAT_REF_SCHEMA_VERSION}`,
    );
  }
  return {
    schemaVersion: GROUP_CHAT_REF_SCHEMA_VERSION,
    conversationKey: boundedString(
      record.conversationKey,
      "groupChat.conversationKey",
      512,
    ),
    beforeMessageId: boundedString(
      record.beforeMessageId,
      "groupChat.beforeMessageId",
      512,
    ),
  };
}

export function parseGroupChatContext(value: unknown): GroupChatContextV1 {
  const record = requiredRecord(value, "group chat context");
  if (record.schemaVersion !== GROUP_CHAT_CONTEXT_SCHEMA_VERSION) {
    throw new Error(
      `group chat context schemaVersion must be ${GROUP_CHAT_CONTEXT_SCHEMA_VERSION}`,
    );
  }
  const conversationKey = boundedString(
    record.conversationKey,
    "group chat context conversationKey",
    512,
  );
  const snapshotRecord = requiredRecord(
    record.snapshot,
    "group chat context snapshot",
  );
  const beforeMessageId = boundedString(
    snapshotRecord.beforeMessageId,
    "group chat context snapshot.beforeMessageId",
    512,
  );
  const snapshot = {
    beforeMessageId,
    ...(snapshotRecord.lastIncludedMessageId === undefined
      ? {}
      : {
          lastIncludedMessageId: boundedString(
            snapshotRecord.lastIncludedMessageId,
            "group chat context snapshot.lastIncludedMessageId",
            512,
          ),
        }),
    generatedAt: nonNegativeNumber(
      snapshotRecord.generatedAt,
      "group chat context snapshot.generatedAt",
    ),
  };

  if (!Array.isArray(record.messages)) {
    throw new Error("group chat context messages must be an array");
  }
  if (record.messages.length > GROUP_CHAT_CONTEXT_MAX_MESSAGES) {
    throw new Error(
      `group chat context messages exceeds ${GROUP_CHAT_CONTEXT_MAX_MESSAGES}`,
    );
  }
  const messages = record.messages.map(parseMessage);
  validateMessageOrder(messages);
  const characters = messages.reduce(
    (total, message) => total + message.content.length,
    0,
  );
  if (characters > GROUP_CHAT_CONTEXT_MAX_CHARACTERS) {
    throw new Error(
      `group chat context content exceeds ${GROUP_CHAT_CONTEXT_MAX_CHARACTERS} characters`,
    );
  }

  const truncationRecord = requiredRecord(
    record.truncation,
    "group chat context truncation",
  );
  if (typeof truncationRecord.truncated !== "boolean") {
    throw new Error("group chat context truncation.truncated must be boolean");
  }
  const omittedMessageCount = nonNegativeInteger(
    truncationRecord.omittedMessageCount,
    "group chat context truncation.omittedMessageCount",
  );
  const reason = truncationRecord.reason;
  if (
    reason !== undefined &&
    reason !== "message_limit" &&
    reason !== "character_limit"
  ) {
    throw new Error("group chat context truncation.reason is invalid");
  }

  return {
    schemaVersion: GROUP_CHAT_CONTEXT_SCHEMA_VERSION,
    conversationKey,
    snapshot,
    messages,
    truncation: {
      truncated: truncationRecord.truncated,
      omittedMessageCount,
      ...(reason ? { reason } : {}),
    },
  };
}

/**
 * Super 自己的旧回答已经存在于 Pi checkpoint，不再从 BE 群聊快照重复注入。
 * 其他 Agent 和用户消息保留；当前用户消息由 beforeMessageId 截止保证不会重复。
 */
export function excludeAgentFromGroupChatContext(
  context: GroupChatContextV1,
  agentId: string | undefined,
): GroupChatContextV1 {
  const normalized = agentId?.trim();
  if (!normalized) {
    return structuredClone(context);
  }
  return {
    ...structuredClone(context),
    messages: context.messages
      .filter(
        (message) =>
          message.speaker.type !== "agent" ||
          message.speaker.agentId !== normalized,
      )
      .map((message) => structuredClone(message)),
  };
}

/** 指纹只用于诊断和恢复一致性，不记录正文。 */
export function fingerprintGroupChatContext(
  context: GroupChatContextV1,
): string {
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}

function parseMessage(value: unknown, index: number): GroupChatMessageV1 {
  const record = requiredRecord(value, `group chat message ${index}`);
  const role = record.role;
  if (role !== "user" && role !== "assistant") {
    throw new Error(`group chat message ${index}.role is invalid`);
  }
  const speakerRecord = requiredRecord(
    record.speaker,
    `group chat message ${index}.speaker`,
  );
  let speaker: GroupChatSpeakerV1;
  if (speakerRecord.type === "user") {
    speaker = {
      type: "user",
      userCode: boundedString(
        speakerRecord.userCode,
        `group chat message ${index}.speaker.userCode`,
        256,
      ),
      ...(speakerRecord.displayName === undefined
        ? {}
        : {
            displayName: boundedString(
              speakerRecord.displayName,
              `group chat message ${index}.speaker.displayName`,
              256,
            ),
          }),
    };
  } else if (speakerRecord.type === "agent") {
    speaker = {
      type: "agent",
      agentId: boundedString(
        speakerRecord.agentId,
        `group chat message ${index}.speaker.agentId`,
        256,
      ),
      agentName: boundedString(
        speakerRecord.agentName,
        `group chat message ${index}.speaker.agentName`,
        256,
      ),
    };
  } else {
    throw new Error(`group chat message ${index}.speaker.type is invalid`);
  }

  const target = record.target === undefined
    ? undefined
    : parseTarget(record.target, index);
  const attachments = record.attachments === undefined
    ? undefined
    : parseAttachments(record.attachments, index);
  return {
    messageId: boundedString(
      record.messageId,
      `group chat message ${index}.messageId`,
      512,
    ),
    sequence: nonNegativeInteger(
      record.sequence,
      `group chat message ${index}.sequence`,
    ),
    createdAt: nonNegativeNumber(
      record.createdAt,
      `group chat message ${index}.createdAt`,
    ),
    role,
    speaker,
    ...(target ? { target } : {}),
    content: boundedString(
      record.content,
      `group chat message ${index}.content`,
      GROUP_CHAT_CONTEXT_MAX_CHARACTERS,
      true,
    ),
    ...(attachments ? { attachments } : {}),
  };
}

function parseTarget(
  value: unknown,
  index: number,
): NonNullable<GroupChatMessageV1["target"]> {
  const record = requiredRecord(value, `group chat message ${index}.target`);
  if (record.type !== "agent") {
    throw new Error(`group chat message ${index}.target.type is invalid`);
  }
  return {
    type: "agent",
    agentId: boundedString(
      record.agentId,
      `group chat message ${index}.target.agentId`,
      256,
    ),
    ...(record.agentName === undefined
      ? {}
      : {
          agentName: boundedString(
            record.agentName,
            `group chat message ${index}.target.agentName`,
            256,
          ),
        }),
  };
}

function parseAttachments(
  value: unknown,
  messageIndex: number,
): NonNullable<GroupChatMessageV1["attachments"]> {
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error(
      `group chat message ${messageIndex}.attachments must be an array of at most 20 items`,
    );
  }
  return value.map((attachment, attachmentIndex) => {
    const record = requiredRecord(
      attachment,
      `group chat message ${messageIndex}.attachments.${attachmentIndex}`,
    );
    return {
      fileId: boundedString(
        record.fileId,
        `group chat message ${messageIndex}.attachments.${attachmentIndex}.fileId`,
        512,
      ),
      fileName: boundedString(
        record.fileName,
        `group chat message ${messageIndex}.attachments.${attachmentIndex}.fileName`,
        512,
      ),
      ...(record.mediaType === undefined
        ? {}
        : {
            mediaType: boundedString(
              record.mediaType,
              `group chat message ${messageIndex}.attachments.${attachmentIndex}.mediaType`,
              256,
            ),
          }),
    };
  });
}

function validateMessageOrder(messages: readonly GroupChatMessageV1[]): void {
  const messageIds = new Set<string>();
  let previousSequence = -1;
  for (const message of messages) {
    if (messageIds.has(message.messageId)) {
      throw new Error(`duplicate group chat messageId: ${message.messageId}`);
    }
    if (message.sequence <= previousSequence) {
      throw new Error("group chat message sequence must be strictly increasing");
    }
    messageIds.add(message.messageId);
    previousSequence = message.sequence;
  }
}

function requiredRecord(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function boundedString(
  value: unknown,
  name: string,
  maxLength: number,
  allowEmpty = false,
): string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  const normalized = allowEmpty ? value : value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > maxLength) {
    throw new Error(`${name} must contain at most ${maxLength} characters`);
  }
  return normalized;
}

function nonNegativeNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return Number(value);
}
