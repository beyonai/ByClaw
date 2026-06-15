import {
  resolveMainContextTemplateParamCode,
  resolveMainContextTemplateRedisKey,
} from "./main-context-template.js";
import type { BaiyingRedisJsonStore } from "./redis-json-store.js";
import type { BaiyingEnhancePluginConfig } from "./types.js";

const DEFAULT_MAIN_CONTEXT_TEMPLATE_POLL_MS = 2000;
const MIN_MAIN_CONTEXT_TEMPLATE_POLL_MS = 1000;

type LoggerLike = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error?: (message: string) => void;
};

export type MainContextTemplateChange = {
  redisKey: string;
  paramCode: string;
  signature: string;
  firstRun: boolean;
};

export type MainContextTemplateWatch = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Test/debug hook: force one immediate poll without waiting for the timer. */
  __pollNow?: () => Promise<void>;
};

function normalizePollMs(raw: unknown): number {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim()
        ? Number(raw.trim())
        : Number.NaN;
  if (!Number.isFinite(n)) {
    return DEFAULT_MAIN_CONTEXT_TEMPLATE_POLL_MS;
  }
  return Math.max(MIN_MAIN_CONTEXT_TEMPLATE_POLL_MS, Math.floor(n));
}

export function createMainContextTemplateWatch(params: {
  redisJsonStore: BaiyingRedisJsonStore;
  pluginConfig: BaiyingEnhancePluginConfig;
  logger: LoggerLike;
  onChange: (change: MainContextTemplateChange) => Promise<void> | void;
}): MainContextTemplateWatch {
  const redisKey = resolveMainContextTemplateRedisKey(params.pluginConfig.mainContextTemplateRedisKey);
  const paramCode = resolveMainContextTemplateParamCode(params.pluginConfig.mainContextTemplateParamCode);
  const label = `${redisKey}:${paramCode}`;
  const pollMs = normalizePollMs(params.pluginConfig.mainContextTemplatePollMs);

  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pollInFlight = false;
  let pollQueued = false;
  let signatureReady = false;
  let lastSignature = "";
  let missingLogged = false;

  const schedule = () => {
    if (stopped) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      void pollOnce().finally(schedule);
    }, pollMs);
    timer.unref?.();
  };

  const readSignature = async (): Promise<{
    payloadPresent: boolean;
    signature: string;
  }> => {
    if (!params.redisJsonStore.getHashJson) {
      return { payloadPresent: false, signature: "(hget-unavailable)" };
    }
    const payload = await params.redisJsonStore.getHashJson({ key: redisKey, field: paramCode });
    return {
      payloadPresent: payload !== null,
      signature: payload ? `${payload.key}:${payload.hash}` : "(missing)",
    };
  };

  const pollOnce = async (): Promise<void> => {
    if (pollInFlight) {
      pollQueued = true;
      return;
    }
    pollInFlight = true;
    try {
      do {
        pollQueued = false;
        try {
          const state = await readSignature();
          const firstRun = !signatureReady;
          const changed = firstRun || state.signature !== lastSignature;
          signatureReady = true;
          lastSignature = state.signature;

          if (!state.payloadPresent) {
            if (!missingLogged || changed) {
              params.logger.info(
                `baiying-enhance: main context template not found; waiting for Redis field ${label}`,
              );
              missingLogged = true;
            }
            continue;
          }

          missingLogged = false;
          if (!changed) {
            continue;
          }

          // 这里仅负责感知 Redis 模板变化；具体写哪些文件由 index.ts 注入的 onChange 决定。
          params.logger.info(
            `baiying-enhance: main context template ${firstRun ? "loaded" : "changed"} (${label}); refreshing main context files`,
          );
          await params.onChange({
            redisKey,
            paramCode,
            signature: state.signature,
            firstRun,
          });
        } catch (err) {
          params.logger.warn(
            `baiying-enhance: main context template poll failed key=${label}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      } while (pollQueued && !stopped);
    } finally {
      pollInFlight = false;
    }
  };

  return {
    start: async () => {
      if (!stopped) {
        return;
      }
      stopped = false;
      params.logger.info(
        `baiying-enhance: main context template watcher started (poll-only, interval=${pollMs}ms, field=${label})`,
      );
      await pollOnce();
      schedule();
    },
    stop: async () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    __pollNow: pollOnce,
  };
}
