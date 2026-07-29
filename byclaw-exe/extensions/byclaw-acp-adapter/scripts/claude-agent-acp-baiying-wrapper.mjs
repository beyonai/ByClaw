#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DEFAULTS, ENV, JSON_INDENT_SPACES, PATHS } from "./constants.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionsDir = path.resolve(scriptDir, "../..");
const byclawRoot = path.resolve(scriptDir, "../../../..");
const resolverCli = path.join(extensionsDir, ...PATHS.resolverCli);
const openclawRoot =
  process.env[ENV.openclawRoot] || path.resolve(byclawRoot, ...PATHS.defaultOpenclawRootParts);
const claudeAgentAcpBin = path.join(openclawRoot, ...PATHS.claudeAgentAcpBin);

function resolveModelId() {
  return String(process.env[ENV.byclawAcpClaudeModelId] || DEFAULTS.wrapperModelId).trim();
}

function resolveAnthropicBaseUrl() {
  return String(
    process.env[ENV.byclawAcpClaudeAnthropicBaseUrl] ||
      DEFAULTS.wrapperAnthropicBaseUrl,
  ).trim();
}

function resolveAimodelAuthToken(modelId) {
  if (!existsSync(resolverCli)) {
    throw new Error(`Baiying aimodel resolver is missing: ${resolverCli}`);
  }
  const request = `${JSON.stringify({
    protocolVersion: DEFAULTS.aimodelResolverProtocolVersion,
    ids: [`model:${modelId}`],
  })}\n`;
  const result = spawnSync(process.execPath, [resolverCli], {
    input: request,
    encoding: "utf8",
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Baiying aimodel resolver failed with code ${result.status}: ${result.stderr.trim()}`,
    );
  }
  const parsed = JSON.parse(result.stdout);
  const token = parsed?.values?.[`model:${modelId}`];
  if (typeof token !== "string" || !token.trim()) {
    const message =
      parsed?.errors?.[`model:${modelId}`]?.message || `missing token for model:${modelId}`;
    throw new Error(message);
  }
  return token.trim();
}

function buildChildEnv() {
  const modelId = resolveModelId();
  const token = resolveAimodelAuthToken(modelId);
  const env = {
    ...process.env,
    ANTHROPIC_AUTH_TOKEN: token,
    ANTHROPIC_BASE_URL: resolveAnthropicBaseUrl(),
    BYCLAW_ACP_CLAUDE_AUTH_MODEL_ID: modelId,
  };
  if (process.env[ENV.byclawAcpKeepAnthropicApiKey] !== "1") {
    delete env.ANTHROPIC_API_KEY;
  }
  return env;
}

function runAuthCheck() {
  const env = buildChildEnv();
  console.log(
    JSON.stringify(
      {
        ok: true,
        modelId: env.BYCLAW_ACP_CLAUDE_AUTH_MODEL_ID,
        hasAnthropicAuthToken: Boolean(env.ANTHROPIC_AUTH_TOKEN),
        anthropicBaseUrl: env.ANTHROPIC_BASE_URL,
        claudeAgentAcpBin,
        resolverCli,
      },
      null,
      JSON_INDENT_SPACES,
    ),
  );
}

if (process.argv.includes("--byclaw-acp-auth-check")) {
  runAuthCheck();
  process.exit(0);
}

if (!existsSync(claudeAgentAcpBin)) {
  console.error(`Claude Agent ACP binary is missing: ${claudeAgentAcpBin}`);
  process.exit(1);
}

let childEnv;
try {
  childEnv = buildChildEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const child = spawn(process.execPath, [claudeAgentAcpBin, ...process.argv.slice(2)], {
  env: childEnv,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    child.kill(signal);
  });
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
