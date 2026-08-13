#!/usr/bin/env node
/**
 * ByClaw 本地 Agent 启动器（纯 JS，跨平台）
 *
 * 职责：加载配置 → 组装环境变量 → 用系统 node（>=22.19）启动 openclaw gateway
 * 用法：
 *   - 桌面端 sidecar：由 main.mjs spawn（传入配置派生 env 覆盖）
 *   - 独立调试：npm run worker（自动读 ~/.config/byclaw/config.json）
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const require = createRequire(import.meta.url);

// ── 配置加载（独立运行时；桌面端已注入 env 时跳过）────────
function loadConfig() {
  const cfgPath =
    process.env.BYCLAW_CONFIG_FILE ||
    path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
      "byclaw",
      "config.json",
    );
  try {
    return JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch {
    return {};
  }
}

// ── openclaw CLI 定位（本地依赖；package.json 有 exports 限制，按包结构定位）──
function resolveOpenClawCli() {
  const entry = require.resolve("openclaw"); // <pkg>/dist/index.js（exports "." 允许）
  const pkgRoot = path.dirname(path.dirname(entry)); // <pkg>/
  const cli = path.join(pkgRoot, "openclaw.mjs"); // bin.openclaw
  if (!fs.existsSync(cli)) {
    throw new Error(`openclaw CLI 未找到: ${cli}（请先 npm install）`);
  }
  return cli;
}

// ── node 可执行文件定位（openclaw 要求 >=22.19）────────
// 注意：Electron 主进程的 process.execPath 是 Electron 二进制，不能当 node 用，
// 必须显式探测系统 node（nvm 优先，Windows 走 PATH）。
function resolveNodeBin() {
  if (process.env.BYCLAW_NODE_BIN) return process.env.BYCLAW_NODE_BIN;
  if (process.platform !== "win32") {
    const home = os.homedir();
    for (const v of ["v22.23.1", "v22.19.0"]) {
      const cand = path.join(home, ".nvm", "versions", "node", v, "bin", "node");
      if (fs.existsSync(cand)) return cand;
    }
  }
  return process.env.NODE || "node";
}

// ── 平台 PATH 注入（nvm node 目录；Windows 无需）────────
function platformPath() {
  const extra = [];
  if (process.platform !== "win32") {
    const home = os.homedir();
    for (const v of ["v22.23.1", "v22.19.0"]) {
      const dir = path.join(home, ".nvm", "versions", "node", v, "bin");
      if (fs.existsSync(dir)) {
        extra.push(dir);
        break;
      }
    }
  }
  return extra.length ? `${extra.join(path.delimiter)}${path.delimiter}${process.env.PATH || ""}` : process.env.PATH;
}

// ── 组装环境（桌面端已注入的 env 优先保留）──────────────
function buildEnv(overrides = {}) {
  const cfg = loadConfig();
  const redis = cfg.redis || {};
  const worker = cfg.worker || {};
  const env = { ...process.env, ...overrides };
  if (!env.USER_CODE) env.USER_CODE = cfg.userCode || "";
  if (!env.REDIS_HOST) env.REDIS_HOST = redis.host || "";
  if (!env.REDIS_PORT) env.REDIS_PORT = String(redis.port || 6379);
  if (!env.REDIS_PASSWORD) env.REDIS_PASSWORD = redis.password || "";
  if (!env.REDIS_MODE) env.REDIS_MODE = redis.mode || "standalone";
  if (!env.REDIS_KEY_SCHEMA_VERSION) env.REDIS_KEY_SCHEMA_VERSION = redis.keySchemaVersion || "v1";
  if (!env.BY_FRAMEWORK_READ_BLOCK_MS) env.BY_FRAMEWORK_READ_BLOCK_MS = String(worker.readBlockMs ?? 100);
  if (!env.BYAI_GROUP_CHAT_CONTEXT_BASE_URL) {
    env.BYAI_GROUP_CHAT_CONTEXT_BASE_URL = worker.groupChatContextBaseUrl || cfg.apiBaseUrl || "";
  }
  const localRoot = worker.localRoot || path.join(path.dirname(new URL(import.meta.url).pathname), "..");
  if (!env.OPENCLAW_STATE_DIR) env.OPENCLAW_STATE_DIR = path.join(localRoot, "runtime");
  if (!env.OPENCLAW_CONFIG_PATH) env.OPENCLAW_CONFIG_PATH = path.join(localRoot, "config", "openclaw.json");
  for (const [k, v] of Object.entries(cfg.env || {})) {
    if (v !== undefined && v !== null && env[k] === undefined) env[k] = String(v);
  }
  env.PATH = platformPath();
  return env;
}

/**
 * 启动 openclaw gateway（返回子进程）
 * @param {object} [overrides] 桌面端传入的 env 覆盖（已由 main.mjs 配置派生）
 */
export function startWorker(overrides = {}) {
  const cli = resolveOpenClawCli();
  const nodeBin = resolveNodeBin();
  const args = ["gateway", "--bind=loopback", "--allow-unconfigured", "--verbose"];
  const proc = spawn(nodeBin, [cli, ...args], {
    env: buildEnv(overrides),
    stdio: ["ignore", "pipe", "pipe"],
  });
  return proc;
}

// 独立运行：npm run worker
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`[worker] openclaw CLI: ${resolveOpenClawCli()}`);
  console.log(`[worker] node: ${resolveNodeBin()}`);
  const proc = startWorker();
  proc.stdout.on("data", (d) => process.stdout.write(d));
  proc.stderr.on("data", (d) => process.stderr.write(d));
  proc.on("exit", (code) => process.exit(code ?? 1));
}
