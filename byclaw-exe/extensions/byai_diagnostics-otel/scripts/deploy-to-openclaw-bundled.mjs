#!/usr/bin/env node
/**
 * Plan 1: replace openclaw bundled `diagnostics-otel` with this BYAI fork (no core changes).
 *
 * Targets:
 *   $OPENCLAW_ROOT/dist/extensions/diagnostics-otel
 *   $OPENCLAW_ROOT/dist-runtime/extensions/diagnostics-otel
 *
 * Usage:
 *   OPENCLAW_ROOT=/path/to/openclaw node scripts/deploy-to-openclaw-bundled.mjs
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const openclawRoot =
  process.env.OPENCLAW_ROOT?.trim() ||
  path.resolve(extensionRoot, "../../../..", "../openclaw");

const deployTargets = [
  path.join(openclawRoot, "dist/extensions/diagnostics-otel"),
  path.join(openclawRoot, "dist-runtime/extensions/diagnostics-otel"),
];

const deployPackageJson = {
  name: "@openclaw/diagnostics-otel",
  version: "byai-bundled",
  private: true,
  description:
    "BYAI diagnostics-otel fork deployed into openclaw bundled diagnostics-otel slot (see byclaw-exe/extensions/byai_diagnostics-otel).",
  type: "module",
  openclaw: {
    extensions: ["./index.js"],
    compat: {
      pluginApi: ">=2026.5.28",
    },
  },
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) {
    return;
  }
  fs.copyFileSync(src, dest);
}

function removeIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

function deployToTarget(targetDir) {
  ensureDir(targetDir);
  copyIfExists(path.join(extensionRoot, "dist/index.js"), path.join(targetDir, "index.js"));
  copyIfExists(path.join(extensionRoot, "dist/index.js.map"), path.join(targetDir, "index.js.map"));
  fs.copyFileSync(
    path.join(extensionRoot, "openclaw.plugin.json"),
    path.join(targetDir, "openclaw.plugin.json"),
  );
  fs.writeFileSync(
    path.join(targetDir, "package.json"),
    `${JSON.stringify(deployPackageJson, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(targetDir, ".byai-diagnostics-otel-deployed"),
    `${new Date().toISOString()}\nsource=${extensionRoot}\n`,
    "utf8",
  );
  removeIfExists(path.join(targetDir, "api.js"));
  const nodeModulesSrc = path.join(extensionRoot, "node_modules");
  const nodeModulesDest = path.join(targetDir, "node_modules");
  if (!fs.existsSync(nodeModulesSrc)) {
    throw new Error(`Missing ${nodeModulesSrc}; run npm install in ${extensionRoot} first.`);
  }
  ensureDir(nodeModulesDest);
  execSync(`rsync -a --delete "${nodeModulesSrc}/" "${nodeModulesDest}/"`, {
    stdio: "inherit",
  });
}

console.log(`Extension root: ${extensionRoot}`);
console.log(`OpenClaw root:  ${openclawRoot}`);
if (!fs.existsSync(path.join(openclawRoot, "openclaw.mjs"))) {
  console.error(`OPENCLAW_ROOT does not look like an openclaw checkout: ${openclawRoot}`);
  process.exit(1);
}

console.log("Building BYAI diagnostics-otel fork...");
execSync("npm run build", { cwd: extensionRoot, stdio: "inherit" });

for (const target of deployTargets) {
  console.log(`Deploying -> ${target}`);
  deployToTarget(target);
}

console.log("");
console.log("Done. Config checklist:");
console.log("  - plugins.entries.diagnostics-otel.enabled: true");
console.log("  - do NOT add diagnostics-otel to plugins.load.paths");
console.log("  - remove byai_diagnostics-otel from plugins.allow / plugins.entries");
console.log("Restart gateway: nohup node openclaw.mjs gateway ...");
