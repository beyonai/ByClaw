#!/usr/bin/env node
/**
 * 构建 byclaw-fe 前端产物并拷贝到 renderer/（跨平台，替代 build-renderer.sh）
 * 用法: node scripts/build-renderer.mjs [输出目录，默认 <repo>/renderer]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.dirname(scriptDir);
const repoRoot = path.dirname(desktopDir);
const outDir = path.resolve(process.argv[2] || path.join(desktopDir, "renderer"));

const feDir = path.join(repoRoot, "byclaw-fe");
if (!fs.existsSync(feDir)) {
  console.error(`ERROR: 未找到 byclaw-fe: ${feDir}`);
  process.exit(1);
}

// Windows 上 pnpm/npm 是 .cmd，需要 shell；Linux/macOS 直接执行
const shell = process.platform === "win32";

function run(cmd, args, opts = {}) {
  console.log(`>>> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell, ...opts });
  if (r.status !== 0) {
    console.error(`ERROR: ${cmd} 退出码 ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

console.log(">>> 构建 byclaw-fe...");
// 注意：--no-audit/--no-fund 是 npm 的 flag，pnpm 不支持（会报 Unknown options）
run("pnpm", ["install"]);
run("pnpm", ["run", "build"]);

console.log(`>>> 拷贝产物 -> ${outDir}`);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.cpSync(path.join(feDir, "dist"), outDir, { recursive: true });

const size = fs.readdirSync(outDir, { recursive: true }).length;
console.log(`完成: ${outDir}（${size} 个文件）`);
