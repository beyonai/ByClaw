import { homedir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveByclawWikiConfig } from "./config.js";

const envSnapshot = new Map<string, string | undefined>();

function stubEnv(key: string, value: string | undefined): void {
  if (!envSnapshot.has(key)) {
    envSnapshot.set(key, process.env[key]);
  }
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of envSnapshot) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  envSnapshot.clear();
});

describe("resolveByclawWikiConfig", () => {
  it("keeps only runtime command and cache defaults", () => {
    stubEnv("OPENCLAW_STATE_DIR", path.join(path.sep, "by", ".openclaw"));
    stubEnv("REDIS_HOST", undefined);
    stubEnv("REDIS_PORT", undefined);
    stubEnv("REDIS_USERNAME", undefined);
    stubEnv("REDIS_PASSWORD", undefined);
    stubEnv("REDIS_DATABASE", undefined);
    stubEnv("REDIS_DB", undefined);

    const config = resolveByclawWikiConfig({});

    assert.equal(config.dataDir, path.join(path.sep, "by", ".openclaw", "byclaw-wiki"));
    assert.equal(config.zreadHome, path.join(path.sep, "by", ".openclaw", "byclaw-wiki", "zread-home"));
    assert.equal(config.gitCommand, "git");
    assert.equal(config.codegraphCommand, "codegraph");
    assert.equal(config.zreadCommand, "zread");
    assert.equal(config.commandTimeoutMs, 300000);
    assert.equal(config.maxOutputBytes, 128 * 1024);
    assert.equal(config.zreadTimeoutMs, 30 * 60 * 1000);
    assert.equal(config.zreadMaxOutputBytes, 256 * 1024);
    assert.equal(config.redisHost, undefined);
    assert.equal(config.redisPort, undefined);
    assert.equal(config.redisUsername, undefined);
    assert.equal(config.redisPassword, undefined);
    assert.equal(config.redisDatabase, undefined);
    assert.equal(config.redisConnectTimeoutMs, 5000);
    assert.equal(config.zreadAimodelEnabled, true);
    assert.equal(config.zreadAimodelConfigRedisKey, "byai:aimodel:config");
    assert.equal(config.zreadAimodelTypeListRedisKey, "byai:aimodel:typelist");
    assert.equal(config.zreadAimodelTypeListField, "LLM");
    assert.equal(config.zreadAimodelModelId, undefined);
    assert.equal(config.zreadAimodelProvider, undefined);
    assert.equal(config.zreadLlmProvider, undefined);
    assert.equal(config.zreadLlmModel, undefined);
    assert.equal(config.zreadLlmBaseUrl, undefined);
    assert.equal(config.zreadLlmApiKey, undefined);
    assert.equal(config.zreadLlmApiKeyEnv, undefined);
    assert.equal(config.zreadMaxConcurrent, 1);
    assert.equal(config.zreadMaxRetries, 0);
    assert.equal(config.includeRawOutputInToolResult, true);
    assert.equal(config.gitDepth, 1);
  });

  it("falls back to ~/.openclaw/byclaw-wiki when OPENCLAW_STATE_DIR is blank", () => {
    stubEnv("OPENCLAW_STATE_DIR", " ");

    const config = resolveByclawWikiConfig({});

    assert.equal(config.dataDir, path.join(homedir(), ".openclaw", "byclaw-wiki"));
  });

  it("resolves relative dataDir under OPENCLAW_STATE_DIR", () => {
    stubEnv("OPENCLAW_STATE_DIR", path.join(path.sep, "state"));

    const config = resolveByclawWikiConfig({ dataDir: "wiki-cache" });

    assert.equal(config.dataDir, path.join(path.sep, "state", "wiki-cache"));
  });

  it("accepts command overrides and numeric strings", () => {
    const config = resolveByclawWikiConfig({
      dataDir: "/tmp/wiki-data",
      zreadHome: "/tmp/zread-home",
      gitCommand: "/usr/bin/git",
      codegraphCommand: "/usr/local/bin/codegraph",
      zreadCommand: "/opt/bin/zread",
      commandTimeoutMs: "1000",
      maxOutputBytes: "4096",
      zreadTimeoutMs: "2000",
      zreadMaxOutputBytes: "8192",
      redisHost: "redis.internal",
      redisPort: "6380",
      redisUsername: "default",
      redisPassword: "redis-password",
      redisDatabase: "2",
      redisConnectTimeoutMs: "3000",
      zreadAimodelEnabled: false,
      zreadAimodelConfigRedisKey: "custom:aimodel:config",
      zreadAimodelTypeListRedisKey: "custom:aimodel:typelist",
      zreadAimodelTypeListField: "llm",
      zreadAimodelModelId: "10004014",
      zreadAimodelProvider: "bigmodel-coding-plan",
      zreadLlmProvider: "openai",
      zreadLlmModel: "glm-5.1",
      zreadLlmBaseUrl: "https://example.test/v1",
      zreadLlmApiKey: "fallback-key",
      zreadLlmApiKeyEnv: "ZREAD_LLM_API_KEY",
      zreadMaxConcurrent: "3",
      zreadMaxRetries: "2",
      includeRawOutputInToolResult: false,
      gitDepth: "5",
    });

    assert.equal(config.dataDir, path.join(path.sep, "tmp", "wiki-data"));
    assert.equal(config.zreadHome, path.join(path.sep, "tmp", "zread-home"));
    assert.equal(config.gitCommand, "/usr/bin/git");
    assert.equal(config.codegraphCommand, "/usr/local/bin/codegraph");
    assert.equal(config.zreadCommand, "/opt/bin/zread");
    assert.equal(config.commandTimeoutMs, 1000);
    assert.equal(config.maxOutputBytes, 4096);
    assert.equal(config.zreadTimeoutMs, 2000);
    assert.equal(config.zreadMaxOutputBytes, 8192);
    assert.equal(config.redisHost, "redis.internal");
    assert.equal(config.redisPort, 6380);
    assert.equal(config.redisUsername, "default");
    assert.equal(config.redisPassword, "redis-password");
    assert.equal(config.redisDatabase, 2);
    assert.equal(config.redisConnectTimeoutMs, 3000);
    assert.equal(config.zreadAimodelEnabled, false);
    assert.equal(config.zreadAimodelConfigRedisKey, "custom:aimodel:config");
    assert.equal(config.zreadAimodelTypeListRedisKey, "custom:aimodel:typelist");
    assert.equal(config.zreadAimodelTypeListField, "LLM");
    assert.equal(config.zreadAimodelModelId, "10004014");
    assert.equal(config.zreadAimodelProvider, "bigmodel-coding-plan");
    assert.equal(config.zreadLlmProvider, "openai");
    assert.equal(config.zreadLlmModel, "glm-5.1");
    assert.equal(config.zreadLlmBaseUrl, "https://example.test/v1");
    assert.equal(config.zreadLlmApiKey, "fallback-key");
    assert.equal(config.zreadLlmApiKeyEnv, "ZREAD_LLM_API_KEY");
    assert.equal(config.zreadMaxConcurrent, 3);
    assert.equal(config.zreadMaxRetries, 2);
    assert.equal(config.includeRawOutputInToolResult, false);
    assert.equal(config.gitDepth, 5);
  });
});
