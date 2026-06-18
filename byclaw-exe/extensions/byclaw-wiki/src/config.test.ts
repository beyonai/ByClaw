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
  it("defaults to beyonai ByClaw develop under OPENCLAW_STATE_DIR", () => {
    stubEnv("OPENCLAW_STATE_DIR", path.join(path.sep, "by", ".openclaw"));

    const config = resolveByclawWikiConfig({});

    assert.equal(config.toolName, "code_to_wiki");
    assert.equal(config.timezone, "Asia/Shanghai");
    assert.equal(config.syncDayOfWeek, 6);
    assert.equal(config.syncHour, 3);
    assert.equal(config.syncMinute, 0);
    assert.equal(config.retryInitialDelayMs, 5 * 60 * 1000);
    assert.equal(config.retryMaxDelayMs, 6 * 60 * 60 * 1000);
    assert.equal(config.retryMaxAttempts, 3);
    assert.equal(config.includeRawOutputInToolResult, true);
    assert.equal(config.gitDepth, 1);
    assert.equal(config.repositories.length, 1);
    assert.equal(config.repositories[0]?.id, "byclaw");
    assert.equal(config.repositories[0]?.remoteUrl, "https://github.com/beyonai/ByClaw.git");
    assert.equal(config.repositories[0]?.branch, "develop");
    assert.equal(
      config.repositories[0]?.localPath,
      path.join(path.sep, "by", ".openclaw", "byclaw-wiki", "repos", "byclaw"),
    );
  });

  it("falls back to ~/.openclaw/byclaw-wiki when OPENCLAW_STATE_DIR is blank", () => {
    stubEnv("OPENCLAW_STATE_DIR", " ");

    const config = resolveByclawWikiConfig({});

    assert.equal(config.dataDir, path.join(homedir(), ".openclaw", "byclaw-wiki"));
  });

  it("keeps configured repositories and resolves relative localPath under dataDir/repos", () => {
    stubEnv("OPENCLAW_STATE_DIR", path.join(path.sep, "state"));

    const config = resolveByclawWikiConfig({
      repositories: [
        {
          id: "Main Repo",
          remoteUrl: "https://github.com/example/main.git",
          branch: "develop",
          localPath: "main-checkout",
        },
      ],
      dataDir: "/tmp/wiki-data",
      runOnStartup: false,
    });

    assert.equal(config.runOnStartup, false);
    assert.equal(config.repositories[0]?.id, "main-repo");
    assert.equal(config.repositories[0]?.localPath, path.join(path.sep, "tmp", "wiki-data", "repos", "main-checkout"));
  });

  it("resolves relative dataDir under OPENCLAW_STATE_DIR", () => {
    stubEnv("OPENCLAW_STATE_DIR", path.join(path.sep, "state"));

    const config = resolveByclawWikiConfig({ dataDir: "wiki-cache" });

    assert.equal(config.dataDir, path.join(path.sep, "state", "wiki-cache"));
  });

  it("resolves notification config from plugin config", () => {
    const config = resolveByclawWikiConfig({
      notificationWebhookUrl: "https://example.test/direct",
      notificationDingtalkSecret: "SEC-example",
      notificationRobotType: "wecom",
      notificationMaxOutputChars: 1200,
      notificationMinOutputChars: 10,
    });

    assert.equal(config.notification.webhookUrl, "https://example.test/direct");
    assert.equal(config.notification.dingtalkSecret, "SEC-example");
    assert.equal(config.notification.robotType, "wecom");
    assert.equal(config.notification.maxOutputChars, 1200);
    assert.equal(config.notification.minOutputChars, 10);
  });
});
