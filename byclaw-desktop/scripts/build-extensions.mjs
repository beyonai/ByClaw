#!/usr/bin/env node
/**
 * 构建 ByClaw 扩展（byclaw-exe/extensions → 输出目录）并应用 by-framework 补丁
 * 跨平台实现（替代 build-extensions.sh，patch 应用不依赖系统 patch 命令）
 * 用法: node scripts/build-extensions.mjs [输出目录，默认 <repo>/extensions]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.dirname(scriptDir);
const repoRoot = path.dirname(desktopDir);
const outDir = path.resolve(process.argv[2] || path.join(desktopDir, "extensions"));

const extSrc = path.join(repoRoot, "byclaw-exe", "extensions");
const patchFile = path.join(desktopDir, "patches", "by-framework-read-block.patch");
const EXTENSIONS = ["baiying-enhance", "byai-channel", "byclaw-sqlite"];

if (!fs.existsSync(extSrc)) {
  console.error(`ERROR: 未找到扩展源码: ${extSrc}`);
  process.exit(1);
}

const shell = process.platform === "win32";

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell, ...opts });
  if (r.status !== 0) {
    console.error(`ERROR: ${cmd} 退出码 ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

/**
 * 应用 unified diff patch（不依赖系统 patch 命令）
 * 解析 ---/+++ 与 +/- 行对，对目标文件做字符串替换；已应用时跳过
 */
function applyPatch(targetFile, patchText) {
  const content = fs.readFileSync(targetFile, "utf8");
  const hunks = [];
  let minus = null;
  for (const line of patchText.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      if (minus !== null) {
        hunks.push([minus, line.slice(1)]);
        minus = null;
      }
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      minus = line.slice(1);
    }
  }
  let updated = content;
  for (const [oldLine, newLine] of hunks) {
    if (!oldLine.trim()) continue;
    if (!updated.includes(oldLine)) {
      // 已应用或内容不匹配
      return { applied: false, reason: `未找到目标行: ${oldLine.slice(0, 60)}` };
    }
    updated = updated.replace(oldLine, newLine);
  }
  if (updated !== content) {
    fs.writeFileSync(targetFile, updated);
    return { applied: true };
  }
  return { applied: false, reason: "无变更" };
}

// 删除旧产物：旧版脚本（bash）部署的目录可能是只读（chmod -R a-w），先放开写权限
if (fs.existsSync(outDir)) {
  chmodWritableRecursive(outDir);
}
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const ext of EXTENSIONS) {
  console.log(`>>> 构建扩展: ${ext}`);
  const src = path.join(extSrc, ext);
  if (!fs.existsSync(src)) {
    console.warn(`  跳过（不存在）: ${src}`);
    continue;
  }
  run("npm", ["install", "--no-audit", "--no-fund"], { cwd: src });
  // 自愈：esbuild 等二进制可能因安装/复制丢失执行位（Permission denied / exit 126）
  ensureExecutable(path.join(src, "node_modules", ".bin"));
  run("npm", ["run", "build"], { cwd: src });
  const dest = path.join(outDir, ext);
  fs.cpSync(src, dest, { recursive: true });
  chmodWritableRecursive(dest);
}

console.log(">>> 应用 by-framework 补丁（任务消费灵敏度）");
const patchText = fs.readFileSync(patchFile, "utf8");
for (const ext of ["byai-channel", "baiying-enhance"]) {
  const runner = path.join(outDir, ext, "node_modules", "@byclaw", "by-framework", "dist", "runner.js");
  if (fs.existsSync(runner)) {
    chmodWritableRecursive(path.dirname(path.dirname(path.dirname(runner))));
    const r = applyPatch(runner, patchText);
    console.log(`  ${ext}: ${r.applied ? "补丁已应用" : `跳过（${r.reason}）`}`);
  }
}

console.log(`完成: ${outDir}`);

function chmodWritableRecursive(dir) {
  if (process.platform === "win32") return; // Windows 无权限位概念
  try {
    fs.chmodSync(dir, 0o755); // 目录自身也要放开（删文件需要父目录写权限）
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) chmodWritableRecursive(p);
      else fs.chmodSync(p, 0o644);
    }
  } catch { /* 忽略权限错误 */ }
}

/** 确保 .bin 下的可执行 shim 都有执行位（esbuild 等；npm 安装后二进制可能为 644） */
function ensureExecutable(binDir) {
  if (process.platform === "win32" || !fs.existsSync(binDir)) return;
  try {
    for (const name of fs.readdirSync(binDir)) {
      const p = path.join(binDir, name);
      try {
        // 符号链接先解析真实路径（chmod 符号链接本身不可靠）
        const target = fs.realpathSync(p);
        if (fs.existsSync(target)) fs.chmodSync(target, 0o755);
      } catch { /* 悬空链接忽略 */ }
    }
  } catch { /* 忽略 */ }
}
