import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveBundledBaiyingResourcesDir } from "./plugin-paths.js";

describe("resolveBundledBaiyingResourcesDir", () => {
  it("resolves to an existing resources directory in this package", () => {
    const dir = resolveBundledBaiyingResourcesDir();
    expect(existsSync(path.join(dir, "agent"))).toBe(true);
  });
});
