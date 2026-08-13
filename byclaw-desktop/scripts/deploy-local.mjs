#!/usr/bin/env node
/**
 * 一键部署 byclaw-desktop 到本地运行目录（跨平台，替代 deploy-local.sh）
 *   - 构建前端产物 + 扩展（含补丁）
 *   - 安装桌面端依赖
 *   - 生成运行时配置（openclaw.json 渲染 + config.json 模板）
 * 用法: node scripts/deploy-local.mjs
 * 环境: BYCLAW_LOCAL_ROOT 覆盖本地根目录（默认 ~/.local/share/byclaw）
 *       BYCLAW_SKIP_BUILD=1 跳过构建（仅配置生成）
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.dirname(scriptDir);
const localRoot = process.env.BYCLAW_LOCAL_ROOT || path.join(os.homedir(), ".local", "share", "byclaw");
const configDir = process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, "byclaw") : path.join(os.homedir(), ".config", "byclaw");
const nodeBin = process.env.BYCLAW_NODE_BIN || resolveNodeBin();
const shell = process.platform === "win32";

console.log("=== ByClaw 桌面端部署 ===");
console.log(`  本地根目录: ${localRoot}`);
console.log(`  配置目录:   ${configDir}`);

for (const d of ["runtime", "logs", "worker", "extensions", "desktop", "config"]) {
  fs.mkdirSync(path.join(localRoot, d), { recursive: true });
}

// 1. 构建前端 + 扩展（可跳过）
if (process.env.BYCLAW_SKIP_BUILD !== "1") {
  console.log(">>> 构建前端产物");
  runNode(path.join(scriptDir, "build-renderer.mjs"), [path.join(localRoot, "desktop", "renderer")]);
  console.log(">>> 构建扩展（含补丁）");
  runNode(path.join(scriptDir, "build-extensions.mjs"), [path.join(localRoot, "extensions")]);
} else {
  console.log(">>> 跳过构建（BYCLAW_SKIP_BUILD=1）");
}

// 2. 渲染 openclaw.json（占位符替换）
console.log(">>> 生成 openclaw.json");
let tpl = fs.readFileSync(path.join(desktopDir, "config", "openclaw.json.example"), "utf8");
tpl = tpl.replaceAll("<LOCAL_ROOT>", localRoot).replaceAll("<NODE_BIN>", nodeBin);
fs.writeFileSync(path.join(localRoot, "config", "openclaw.json"), tpl);

// 3. 用户配置（首次生成模板）
const userCfg = path.join(configDir, "config.json");
if (!fs.existsSync(userCfg)) {
  console.log(`>>> 生成用户配置模板: ${userCfg}（请填写后重启桌面端）`);
  fs.mkdirSync(configDir, { recursive: true });
  fs.copyFileSync(path.join(desktopDir, "config", "config.json.example"), userCfg);
} else {
  console.log(`>>> 用户配置已存在: ${userCfg}`);
}

// 4. 桌面端依赖
console.log(">>> 安装桌面端依赖");
run("npm", ["install", "--no-audit", "--no-fund"], { cwd: desktopDir });

console.log("");
console.log("=== 部署完成 ===");
console.log("下一步：");
console.log(`  1. 编辑 ${userCfg}（apiBaseUrl / userCode / redis / auth）`);
console.log("  2. 启动: npm start（或打包: npm run dist）");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function runNode(script, args) {
  run(nodeBin, [script, ...args]);
}

function resolveNodeBin() {
  if (process.platform !== "win32") {
    const home = os.homedir();
    for (const v of ["v22.23.1", "v22.19.0"]) {
      const cand = path.join(home, ".nvm", "versions", "node", v, "bin", "node");
      if (fs.existsSync(cand)) return cand;
    }
  }
  return process.env.NODE || "node";
}
