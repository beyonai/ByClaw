#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultTarget = path.join(os.homedir(), ".openclaw", "extensions", "byclaw-acp-adapter");
const targetDir =
  process.env.OPENCLAW_EXTENSION_TARGET ||
  process.env.BYCLAW_ACP_ADAPTER_OPENCLAW_TARGET ||
  defaultTarget;

const excludedNames = new Set([".git", ".tmp", "node_modules", ".DS_Store"]);

function shouldCopy(source) {
  const relative = path.relative(rootDir, source);
  if (!relative) {
    return true;
  }
  return !relative.split(path.sep).some((part) => excludedNames.has(part));
}

function assertBuilt() {
  const distEntry = path.join(rootDir, "dist", "index.js");
  if (!fs.existsSync(distEntry)) {
    throw new Error("dist/index.js is missing. Run npm run build:fast before installing.");
  }
}

function main() {
  assertBuilt();
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(rootDir, targetDir, {
    recursive: true,
    filter: shouldCopy,
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        targetDir,
        entry: path.join(targetDir, "dist", "index.js"),
        manifest: path.join(targetDir, "openclaw.plugin.json"),
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
