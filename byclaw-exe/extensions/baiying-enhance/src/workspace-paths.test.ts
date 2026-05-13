import path from "node:path";
import { describe, expect, it } from "vitest";
import { MANAGED_AGENT_PREFIX } from "./types.js";
import { resolveDefaultManagedWorkspacePath } from "./workspace-paths.js";

describe("resolveDefaultManagedWorkspacePath", () => {
  it("uses plain workspace/ for main agent id", () => {
    const p = resolveDefaultManagedWorkspacePath("main");
    expect(p.endsWith(`${path.sep}workspace`)).toBe(true);
    expect(p).not.toContain("workspace-main");
  });

  it("uses workspace-<id> under state dir for non-main agents", () => {
    const id = `${MANAGED_AGENT_PREFIX}10863047`;
    const p = resolveDefaultManagedWorkspacePath(id);
    expect(p).toContain(`workspace-${MANAGED_AGENT_PREFIX}10863047`);
  });
});
