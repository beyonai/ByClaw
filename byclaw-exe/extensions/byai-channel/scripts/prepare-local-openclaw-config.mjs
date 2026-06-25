#!/usr/bin/env node
/**
 * Patch runtime/openclaw/openclaw.json for local gateway dev:
 * - plugin paths -> byclaw-exe/extensions (or BYCLAW_EXTENSIONS_ROOT)
 * - /by/.openclaw -> OPENCLAW_STATE_DIR
 * - secrets CLI paths -> local extension dist
 *
 * diagnostics-otel is intentionally omitted from plugins.load.paths:
 * deploy the BYAI fork into openclaw's bundled diagnostics-otel slot
 * (byai_diagnostics-otel/scripts/deploy-to-openclaw-bundled.mjs) so core grants
 * internalDiagnostics without openclaw source changes.
 *
 * Set BYCLAW_INCLUDE_OTEL_EXTENSION=1 to force a custom otel plugin path anyway
 * (internalDiagnostics will be unavailable unless origin is bundled/trusted).
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const sourceConfig = path.join(repoRoot, "runtime/openclaw/openclaw.json");
const stateDir = path.join(repoRoot, "runtime/openclaw");
const extensionsDir =
  process.env.BYCLAW_EXTENSIONS_ROOT?.trim() ||
  path.join(repoRoot, "byclaw-exe/extensions");
const outputPath =
  process.argv[2] ?? path.join(stateDir, "openclaw.local-gateway.json");
const includeOtelExtension = process.env.BYCLAW_INCLUDE_OTEL_EXTENSION === "1";

function replaceDeep(value) {
  if (typeof value === "string") {
    return value
      .replaceAll("/by/.openclaw", stateDir)
      .replaceAll("/app/dist-runtime/extensions", extensionsDir)
      .replaceAll("/app/dist/extensions", extensionsDir);
  }
  if (Array.isArray(value)) {
    return value.map(replaceDeep);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceDeep(v)]));
  }
  return value;
}

const raw = fs.readFileSync(sourceConfig, "utf8");
const config = replaceDeep(JSON.parse(raw));

config.plugins ??= {};
config.plugins.load ??= {};
config.plugins.load.paths = [
  path.join(extensionsDir, "baiying-enhance"),
  path.join(extensionsDir, "byai-channel"),
  path.join(extensionsDir, "byclaw-sqlite"),
];
if (includeOtelExtension) {
  config.plugins.load.paths.push(path.join(extensionsDir, "byai_diagnostics-otel"));
  console.warn(
    "BYCLAW_INCLUDE_OTEL_EXTENSION=1: legacy path; prefer deploy-to-openclaw-bundled.mjs for diagnostics-otel slot.",
  );
}

const secretsProvider = config.secrets?.providers?.["baiying-aimodel-redis"];
if (secretsProvider) {
  secretsProvider.command = process.execPath;
  secretsProvider.args = [
    path.join(extensionsDir, "baiying-enhance/dist/aimodel-secret-resolver-cli.js"),
  ];
}

fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
console.log(`Wrote local gateway config: ${outputPath}`);
console.log(`Extensions root: ${extensionsDir}`);
if (includeOtelExtension) {
  console.warn(
    "BYCLAW_INCLUDE_OTEL_EXTENSION=1: custom byai_diagnostics-otel path added; internalDiagnostics may be unavailable (origin=config).",
  );
} else {
  console.log(
    "diagnostics-otel: use BYAI fork deployed into openclaw bundled slot (deploy-to-openclaw-bundled.mjs).",
  );
}
