import { homedir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveByclawSqliteConfig } from "./config.js";
import { getPluginRootDir } from "./paths.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveByclawSqliteConfig", () => {
  it("defaults dbPath to OPENCLAW_STATE_DIR/memory/byclaw.sqlite", () => {
    vi.stubEnv("OPENCLAW_STATE_DIR", path.join(path.sep, "by", ".openclaw"));

    const config = resolveByclawSqliteConfig({});

    expect(config.dbPath).toBe(path.join(path.sep, "by", ".openclaw", "memory", "byclaw.sqlite"));
  });

  it("falls back to ~/.openclaw/memory/byclaw.sqlite when OPENCLAW_STATE_DIR is blank", () => {
    vi.stubEnv("OPENCLAW_STATE_DIR", " ");

    const config = resolveByclawSqliteConfig({ dbPath: " " });

    expect(config.dbPath).toBe(path.join(homedir(), ".openclaw", "memory", "byclaw.sqlite"));
  });

  it("keeps explicit relative dbPath resolved from plugin directory", () => {
    vi.stubEnv("OPENCLAW_STATE_DIR", path.join(path.sep, "by", ".openclaw"));

    const config = resolveByclawSqliteConfig({ dbPath: "data/custom.sqlite" });

    expect(config.dbPath).toBe(path.join(getPluginRootDir(), "data", "custom.sqlite"));
  });
});
