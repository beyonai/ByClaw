import { describe, expect, it } from "vitest";
import {
  buildAgentsMd,
  buildByaiBusinessExtensionsMd,
  buildSoul,
} from "./workspace-seed.js";

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
