import { getSharedRedisJsonStore } from "./redis-json-store.js";
import { sessionModelOverrideRedisKey } from "./session-model-override.js";

/**
 * 运行时思考档位词表：必须与 ByClaw BE（SessionModelSelectionService.THINKING_LEVELS）
 * 和 byclaw-super（THINKING_LEVELS）一致，否则任一侧都会静默降级或直接抛错。
 */
export const RUNTIME_THINKING_LEVELS = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "adaptive",
    "max",
] as const;

export type RuntimeThinkingLevel = (typeof RUNTIME_THINKING_LEVELS)[number];

type LoggerLike = {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
};

/** 归一化档位；词表外取值返回 undefined。 */
export function normalizeRuntimeThinkingLevel(raw: unknown): RuntimeThinkingLevel | undefined {
    if (typeof raw !== "string" && typeof raw !== "number") {
        return undefined;
    }
    const value = String(raw).trim().toLowerCase();
    return (RUNTIME_THINKING_LEVELS as readonly string[]).includes(value)
        ? (value as RuntimeThinkingLevel)
        : undefined;
}

/** 从 Redis 记录读取档位：对象取 thinkingLevel，同时容忍裸字符串旧格式。 */
export function readThinkingLevelFromPayload(raw: unknown): RuntimeThinkingLevel | undefined {
    if (typeof raw === "string") {
        return normalizeRuntimeThinkingLevel(raw);
    }
    if (!raw || typeof raw !== "object") {
        return undefined;
    }
    return normalizeRuntimeThinkingLevel((raw as Record<string, unknown>).thinkingLevel);
}

/**
 * 读取本会话由 ByClaw BE 写入的最终思考档位（会话覆盖记录的档位轴）。
 *
 * <p>键与 `byai:chat:session_model:{sessionId}` 的模型覆盖共用一份记录：模型轴决定用哪个模型，
 * 档位轴决定这一轮用哪个思考档位。缺失、非法或 Redis 不可用时返回 undefined，
 * 调用方应保持会话现有档位不变。
 */
export async function resolveSessionThinkingLevel(params: {
    sessionId?: string;
    log: LoggerLike;
}): Promise<RuntimeThinkingLevel | undefined> {
    const sessionId = params.sessionId?.trim();
    if (!sessionId) {
        return undefined;
    }
    const store = getSharedRedisJsonStore({ logger: params.log });
    try {
        const payload = await store.getJsonByKey(sessionModelOverrideRedisKey(sessionId));
        return readThinkingLevelFromPayload(payload?.raw);
    } catch (error) {
        params.log.warn?.(
            `baiying-enhance: session thinking level read failed, sessionId=${sessionId}: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
        return undefined;
    }
}
