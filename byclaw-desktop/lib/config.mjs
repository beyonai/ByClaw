/**
 * ByClaw 桌面端配置加载（业界惯例：用户配置目录）
 * 读取顺序：BYCLAW_CONFIG_FILE 环境变量 > $XDG_CONFIG_HOME/byclaw/config.json > ~/.config/byclaw/config.json
 * 严格模式：config.json 是唯一配置来源（缺失时返回默认值，不静默回退旧文件）
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
 * 加载完整配置：config.json 是唯一来源（严格模式）
 * @returns {{config: object, source: string}}
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
  }
  const merged = merge(DEFAULTS, config);
  if (!merged.worker.groupChatContextBaseUrl) {
    merged.worker.groupChatContextBaseUrl = merged.apiBaseUrl;
  }
  return { config: merged, source };
}

/** 生成配置模板（供首次运行提示） */
export function configTemplate() {
  return JSON.stringify(DEFAULTS, null, 2);
}
