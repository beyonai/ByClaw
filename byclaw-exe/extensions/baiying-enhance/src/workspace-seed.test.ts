import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAgentsMd,
  buildByaiBusinessExtensionsMd,
  buildSoul,
  MANAGED_SEED_MARKER,
  removeManagedBootstrapIfPresent,
} from "./workspace-seed.js";

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

describe("workspace-seed legacy bootstrap cleanup", () => {
  it("removeManagedBootstrapIfPresent deletes only plugin-managed BOOTSTRAP.md", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "baiying-bootstrap-cleanup-"));
    const managedBootstrap = path.join(ws, "BOOTSTRAP.md");
    await writeFile(managedBootstrap, `${MANAGED_SEED_MARKER}\n\nlegacy bootstrap`, "utf8");

    expect(await removeManagedBootstrapIfPresent(ws)).toBe(true);
    expect(await pathExists(managedBootstrap)).toBe(false);

    await writeFile(managedBootstrap, "# User bootstrap\n", "utf8");
    expect(await removeManagedBootstrapIfPresent(ws)).toBe(false);
    expect(await readFile(managedBootstrap, "utf8")).toBe("# User bootstrap\n");
  });
});

describe("workspace-seed corePersonaDefinition", () => {
  it("buildSoul uses instructions and pointer when corePersona is JSON extensions", () => {
    const md = buildSoul({
      corePersonaDefinition: JSON.stringify([
        { name: "拓展属性", key: "custom_x", value: "拓展属性" },
      ]),
      instructions: "围绕知识库回答。",
      integrationType: "NONE",
    });
    expect(md).toContain("围绕知识库回答。");
    expect(md).toContain("BYAI_BUSINESS_EXTENSIONS.md");
    expect(md).not.toContain('[{"name"');
  });

  it("buildSoul keeps narrative corePersona when not structured", () => {
    const md = buildSoul({
      corePersonaDefinition: "你是果百科专家。",
      instructions: "配角说明。",
      integrationType: "NONE",
    });
    expect(md).toContain("你是果百科专家。");
    expect(md).not.toContain("BYAI_BUSINESS_EXTENSIONS.md");
  });

  it("buildByaiBusinessExtensionsMd renders extensions", () => {
    const md = buildByaiBusinessExtensionsMd([
      { name: "拓展属性", key: "custom_x", value: "拓展属性" },
    ]);
    expect(md).toContain("# 百应业务拓展属性");
    expect(md).toContain("### 拓展属性");
    expect(md).toContain("custom_x");
  });

  it("buildAgentsMd includes 百应业务拓展属性 section", () => {
    const md = buildAgentsMd({
      corePersonaDefinition: JSON.stringify([
        { name: "拓展属性", key: "custom_x", value: "拓展属性" },
      ]),
    });
    expect(md).toContain("## 百应业务拓展属性");
    expect(md).toContain("**拓展属性**");
    expect(md).toContain("BYAI_BUSINESS_EXTENSIONS.md");
  });
});
