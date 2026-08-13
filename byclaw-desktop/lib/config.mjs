/**
 * ByClaw 桌面端配置加载（业界惯例：用户配置目录）
 * 读取顺序：BYCLAW_CONFIG_FILE 环境变量 > $XDG_CONFIG_HOME/byclaw/config.json > ~/.config/byclaw/config.json
 * 兜底：兼容旧的 online.env（byclaw-local/config/online.env）
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULTS = {
  apiBaseUrl: "",
  userCode: "",
  redis: { host: "", port: 6379, password: "", mode: "standalone", keySchemaVersion: "v1" },
  worker: {
    script: "",
    localRoot: "",
    readBlockMs: 100,
    groupChatContextBaseUrl: "",
  },
  auth: { token: "", sessionId: "" },
  env: {},
};

export function configFilePath() {
  if (process.env.BYCLAW_CONFIG_FILE) return process.env.BYCLAW_CONFIG_FILE;
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg ? path.join(xdg, "byclaw") : path.join(os.homedir(), ".config", "byclaw");
  return path.join(base, "config.json");
}

export function legacyEnvPath() {
  return path.join(os.homedir(), "hermes-workspace", "projects", "byclaw-local", "config", "online.env");
}

/** 解析简单 .env 文件（KEY=VALUE） */
export function parseEnvFile(filePath) {
  const out = {};
  try {
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (k) out[k] = v;
    }
  } catch { /* ignore */ }
  return out;
}

/** 深度合并（config 优先，defaults 兜底） */
function merge(defaults, config) {
  if (config === null || typeof config !== "object") return defaults;
  const out = { ...defaults };
  for (const k of Object.keys(config)) {
    if (config[k] !== undefined && config[k] !== null) {
      out[k] =
        defaults[k] && typeof defaults[k] === "object" && !Array.isArray(defaults[k])
          ? merge(defaults[k], config[k])
          : config[k];
    }
  }
  return out;
}

/**
 * 加载完整配置：config.json（优先）→ online.env（回退）→ 默认值
 * @returns {{config: object, source: string, legacyEnv: object}}
 */
export function loadConfig() {
  const cfgPath = configFilePath();
  let config = {};
  let source = "defaults";
  try {
    config = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    source = `config:${cfgPath}`;
  } catch (e) {
    if (e.code !== "ENOENT") console.warn(`[config] 解析失败 ${cfgPath}: ${e.message}`);
    // 回退：legacy online.env
    const legacy = parseEnvFile(legacyEnvPath());
    if (legacy.BYCLAW_BE_BASE_URL || legacy.REDIS_HOST) {
      config = {
        apiBaseUrl: legacy.BYCLAW_BE_BASE_URL,
        userCode: legacy.TEST_USER_CODE || "",
        redis: {
          host: legacy.REDIS_HOST,
          port: Number(legacy.REDIS_PORT || 6379),
          password: legacy.REDIS_PASSWORD || "",
          mode: legacy.REDIS_MODE || "standalone",
          keySchemaVersion: legacy.REDIS_KEY_SCHEMA_VERSION || "v1",
        },
        auth: { token: legacy.TEST_ACCESS_TOKEN || "", sessionId: legacy.TEST_SESSION_ID || "" },
      };
      source = `legacy:${legacyEnvPath()}`;
    }
  }
  const merged = merge(DEFAULTS, config);
  // 推导：worker 脚本默认路径（基于 localRoot）
  if (!merged.worker.script && merged.worker.localRoot) {
    merged.worker.script = path.join(merged.worker.localRoot, "worker", "start-worker.sh");
  }
  if (!merged.worker.groupChatContextBaseUrl) {
    merged.worker.groupChatContextBaseUrl = merged.apiBaseUrl;
  }
  return { config: merged, source };
}

/** 生成配置模板（供首次运行提示） */
export function configTemplate() {
  return JSON.stringify(DEFAULTS, null, 2);
}
