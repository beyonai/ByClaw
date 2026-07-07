#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const bridgePath = path.join(scriptDir, "byclaw-remote-claude-acp.mjs");
const timeoutMs = 5_000;

function writeMockFramework(tempDir) {
  const frameworkEntry = path.join(tempDir, "framework.cjs");
  fs.writeFileSync(
    frameworkEntry,
    String.raw`
const fs = require("node:fs");

class MockRedis {
  async quit() {}
}

exports.createRedis = function createRedis() {
  return new MockRedis();
};

exports.WorkerRegistry = class WorkerRegistry {
  constructor(redis) {
    this.redis = redis;
  }
};

exports.GatewayClient = class GatewayClient {
  constructor(registry, redis) {
    this.registry = registry;
    this.redis = redis;
  }

  async sendMessage(params) {
    if (params.targetAgentType !== "BYCLAW_CODE_test-user") {
      throw new Error("unexpected targetAgentType: " + params.targetAgentType);
    }
    if (params.sessionId !== "real-session-42") {
      throw new Error("unexpected sessionId: " + params.sessionId);
    }
    if (params.metadata.language !== "zh-CN") {
      throw new Error("unexpected language: " + params.metadata.language);
    }
    if (!params.content.includes("hello")) {
      throw new Error("missing prompt content");
    }
    fs.appendFileSync(process.env.MOCK_CALLS_PATH, JSON.stringify({
      targetAgentType: params.targetAgentType,
      sessionId: params.sessionId,
      language: params.metadata.language,
      content: params.content,
      bridge: params.extraPayload.ext_params.acp.bridge,
    }) + "\n");
    return {
      success: true,
      message_id: params.messageId,
      trace_id: params.traceId,
      status: "QUEUED",
    };
  }
};
`,
    "utf8",
  );
  return frameworkEntry;
}

function startBridge(frameworkEntry) {
  const mockCallsPath = path.join(path.dirname(frameworkEntry), "calls.jsonl");
  const child = spawn(process.execPath, [bridgePath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      BYCLAW_REMOTE_CLAUDE_FRAMEWORK_ENTRY: frameworkEntry,
      MOCK_CALLS_PATH: mockCallsPath,
      USER_CODE: "test-user",
    },
  });
  const messages = [];
  const stderr = [];
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    messages.push(JSON.parse(line));
  });
  readline.createInterface({ input: child.stderr }).on("line", (line) => {
    stderr.push(line);
  });
  return { child, messages, stderr, mockCallsPath };
}

function writeRequest(child, request) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...request })}\n`);
}

async function waitFor(messages, predicate) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const match = messages.find(predicate);
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for ACP bridge response");
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "byclaw-remote-claude-acp-"));
  const frameworkEntry = writeMockFramework(tempDir);
  const bridge = startBridge(frameworkEntry);
  try {
    writeRequest(bridge.child, { id: 1, method: "initialize", params: {} });
    const initialize = await waitFor(bridge.messages, (message) => message.id === 1);
    assert.equal(initialize.result.protocolVersion, 1);
    assert.equal(initialize.result.agentCapabilities.loadSession, false);

    writeRequest(bridge.child, { id: 2, method: "session/new", params: { cwd: process.cwd() } });
    const newSession = await waitFor(bridge.messages, (message) => message.id === 2);
    const sessionId = newSession.result.sessionId;
    assert.ok(sessionId, "session/new should return a sessionId");

    writeRequest(bridge.child, {
      id: 3,
      method: "session/prompt",
      params: {
        sessionId,
        prompt: [
          {
            type: "text",
            text: "byaiChannelSessionId: real-session-42\nhello",
          },
        ],
      },
    });

    const promptDone = await waitFor(bridge.messages, (message) => message.id === 3);
    assert.equal(promptDone.result.stopReason, "end_turn");
    assert.equal(
      bridge.messages.some((message) => message.method === "session/update"),
      false,
      "bridge must not consume Redis data_stream or mirror remote output to ACP",
    );
    const calls = fs.readFileSync(bridge.mockCallsPath, "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      {
        targetAgentType: "BYCLAW_CODE_test-user",
        sessionId: "real-session-42",
        language: "zh-CN",
        content: "byaiChannelSessionId: real-session-42\nhello",
        bridge: "byclaw-acp-adapter",
      },
    ]);
  } finally {
    bridge.child.kill("SIGTERM");
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
