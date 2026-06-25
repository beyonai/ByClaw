
import { createRedis, GatewayDataEmitter, SseMessageType } from "@byclaw/by-framework";
import { getByaiRuntime } from "./runtime";

export function generateRandomId() {
  return crypto.randomUUID().replace(/-/g, '');
}

let prevEmitIncrementKey = '';
// 用于累积流式内容的缓冲区
const streamSnapshots: Record<string, string> = {};
export async function emitIncrementalText(params: {
  key: string;
  rawText: string;
  normalize?: (text: string) => string;
  emit: (text: string, fullText: string) => Promise<void>;
}) {
  if (!params.rawText) {
    return;
  }
  if (params.key !== prevEmitIncrementKey) {
    Object.keys(streamSnapshots).forEach((key) => {
      if (key !== params.key) {
        delete streamSnapshots[key];
      }
    });
  }
  prevEmitIncrementKey = params.key;
  const fullText = params.normalize ? params.normalize(params.rawText) : params.rawText;
  if (!fullText.trim()) {
    return;
  }
  const previousText = streamSnapshots[params.key] ?? "";
  let nextText = fullText;
  if (previousText && fullText.startsWith(previousText)) {
    nextText = fullText.slice(previousText.length);
  }
  streamSnapshots[params.key] = fullText;
  if (!nextText) {
    return;
  }
  await params.emit(nextText, fullText);
}

export function getJsonMarkdown(json: unknown) {
  let text = '';
  if (typeof json === 'string') {
    try {
      JSON.parse(json);
      text = json;
    } catch {
      return json;
    }
  } else if (typeof json === 'object') {
    text = JSON.stringify(json, null, 2);
  }
  if (!text) {
    return "";
  }
  return `\`\`\`\n${text}\n\`\`\``;
}

export function ellipsis(text: string, maxLength: number = 50) {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + "...";
}

export function normalizeReasoningPreviewText(replyText: string) {
  return replyText
    .replace(/^Reasoning:\s*/, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return "";
      }
      const unwrapped =
        trimmed.startsWith("_") && trimmed.endsWith("_") && trimmed.length >= 2
          ? trimmed.slice(1, -1)
          : trimmed;
      return unwrapped.trim();
    })
    .join("\n")
    .trim();
}

export function getAgentDetailById(id?: string) {
  if (!id) {
    return undefined;
  }
  const config = getByaiRuntime().config.loadConfig();
  if (Array.isArray(config?.agents?.list)) {
    return config.agents.list.find((o: { id: string; name: string }) => o.id === id);
  }
  return undefined;
}

export function getAgentNameById(id?: string) {
  const detail = getAgentDetailById(id);
  return detail?.name ?? "";
}


export function getUserCode(): string | null {
  const code = String(process.env.USER_CODE ?? "").trim();
  return code || null;
}

export function getRedisInfo() {
  const { REDIS_USERNAME, REDIS_PASSWORD, REDIS_HOST, REDIS_PORT, REDIS_DATABASE } = process.env;
  if (!REDIS_HOST || !REDIS_PORT) {
    return null;
  }
  return {
    username: REDIS_USERNAME,
    password: REDIS_PASSWORD,
    host: REDIS_HOST,
    port: parseInt(REDIS_PORT, 10),
    db: parseInt(REDIS_DATABASE || "0", 10),
  };
}

function normalizeId(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

async function getUserId(userCode: string, redis: ReturnType<typeof createRedis>) {
  if (!userCode || !redis) {
    return "";
  }
  const userId = await redis.get(`SHARE_BFM_USER_CODE_${userCode}`)
  return normalizeId(userId);
}

export async function emitOutOfBandSdkEvent(params: {
  sessionId?: string;
  data: Record<string, any>;
  eventType: string;
}) {
  const redisInfo = getRedisInfo();
  if (!redisInfo) {
    return;
  }
  const userCode = getUserCode();
  if (!userCode) {
    return;
  }
  const redis = createRedis(redisInfo);
  const userId = await getUserId(userCode, redis);
  const emitter = new GatewayDataEmitter(redis, {
    dataStreamName: "byai_gateway:session_event:data_stream",
  });
  await emitter.emitEvent({
    data: {
      ...params.data,
      userId,
      userCode,
      created: Math.floor(Date.now() / 1000),
      contentType: SseMessageType.text,
      id: generateRandomId().toUpperCase(),
    },
    sessionId: params.sessionId || "",
    traceId: generateRandomId(),
    eventType: params.eventType,
  });
  redis.quit();
}

export function createRedisInstance() {
  const redisInfo = getRedisInfo();
  if (!redisInfo) {
    return null;
  }
  return createRedis(redisInfo);
}
