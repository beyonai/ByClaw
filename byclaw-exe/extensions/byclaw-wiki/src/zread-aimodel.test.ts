import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { resolveByclawWikiConfig } from "./config.js";
import { syncZreadConfig, zreadConfigPath } from "./zread-aimodel.js";

const tempDirs: string[] = [];

const logger = {
  warn(): void {},
};

async function tempConfig(raw: Record<string, unknown> = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "byclaw-wiki-"));
  tempDirs.push(dataDir);
  return resolveByclawWikiConfig({
    dataDir,
    zreadHome: path.join(dataDir, "zread-home"),
    ...raw,
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("syncZreadConfig", () => {
  it("writes fallback plugin LLM config when Redis model resolution is disabled", async () => {
    const config = await tempConfig({
      zreadAimodelEnabled: false,
      zreadLlmProvider: "openai",
      zreadLlmModel: "glm-5.1",
      zreadLlmBaseUrl: "https://example.test/v1",
      zreadLlmApiKey: "test-api-key",
      zreadMaxConcurrent: 2,
      zreadMaxRetries: 1,
    });

    const result = await syncZreadConfig({ config, logger });

    assert.equal(result.ok, true);
    assert.equal(result.source, "config");
    assert.equal(result.configPath, zreadConfigPath(config.zreadHome));
    const content = await fs.readFile(result.configPath, "utf8");
    assert.match(content, /provider: 'openai'/u);
    assert.match(content, /model: 'glm-5\.1'/u);
    assert.match(content, /api_key: 'test-api-key'/u);
    assert.match(content, /base_url: 'https:\/\/example\.test\/v1'/u);
    assert.match(content, /max_concurrent: 2/u);
    assert.match(content, /max_retries: 1/u);
  });

  it("returns a clear error when neither Redis nor fallback config is available", async () => {
    const config = await tempConfig({
      zreadAimodelEnabled: false,
    });

    const result = await syncZreadConfig({ config, logger });

    assert.equal(result.ok, false);
    assert.equal(result.source, "none");
    assert.match(result.error, /Redis AI model resolution is disabled/u);
    assert.match(result.error, /No fallback Zread LLM config is complete/u);
  });
});
