import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveWorkspaceArchiveRoot } from "./workspace-archive.js";

describe("workspace archive paths", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to .baiying-workspaces next to OPENCLAW_STATE_DIR", () => {
    vi.stubEnv("OPENCLAW_STATE_DIR", path.join(path.sep, "by", ".openclaw"));

    expect(resolveWorkspaceArchiveRoot()).toBe(path.join(path.sep, "by", ".baiying-workspaces"));
  });

  it("resolves relative workspaceArchiveDir under the state dir parent", () => {
    vi.stubEnv("OPENCLAW_STATE_DIR", path.join(path.sep, "by", ".openclaw"));

    expect(resolveWorkspaceArchiveRoot({ workspaceArchiveDir: ".custom-baiying" })).toBe(
      path.join(path.sep, "by", ".custom-baiying"),
    );
  });
});
