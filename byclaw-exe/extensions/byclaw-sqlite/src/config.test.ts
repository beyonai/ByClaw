import { homedir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveByclawSqliteConfig } from "./config.js";
import { getPluginRootDir } from "./paths.js";

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

describe("resolveByclawSqliteConfig", () => {
  it("defaults dbPath to OPENCLAW_STATE_DIR/memory/byclaw.sqlite", () => {
    stubEnv("OPENCLAW_STATE_DIR", path.join(path.sep, "by", ".openclaw"));

    const config = resolveByclawSqliteConfig({});

    assert.equal(config.dbPath, path.join(path.sep, "by", ".openclaw", "memory", "byclaw.sqlite"));
  });

  it("falls back to ~/.openclaw/memory/byclaw.sqlite when OPENCLAW_STATE_DIR is blank", () => {
    stubEnv("OPENCLAW_STATE_DIR", " ");

    const config = resolveByclawSqliteConfig({ dbPath: " " });

    assert.equal(config.dbPath, path.join(homedir(), ".openclaw", "memory", "byclaw.sqlite"));
  });

  it("keeps explicit relative dbPath resolved from plugin directory", () => {
    stubEnv("OPENCLAW_STATE_DIR", path.join(path.sep, "by", ".openclaw"));

    const config = resolveByclawSqliteConfig({ dbPath: "./custom.sqlite" });

    assert.equal(config.dbPath, path.join(getPluginRootDir(), "custom.sqlite"));
  });
});
