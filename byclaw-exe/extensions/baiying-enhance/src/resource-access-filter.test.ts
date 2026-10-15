import { describe, expect, it } from "vitest";
import { filterControlledResources } from "./resource-access-filter.js";
import { parseAuthorizedIds } from "./resource-authorization.js";

describe("shared employee resource use isolation", () => {
  const raw = {
    controlledResources: [
      { resourceId: "10", resourceCode: "report", resourceBizType: "SKILL", createBy: "1", active: true },
      { resourceId: "11", resourceCode: "mcp-private", resourceBizType: "MCP", createBy: "1", active: true },
    ],
    relSkills: [{ resourceId: "10", skillCode: "report", skillUrl: "private.zip" }, { skillCode: "builtin" }],
    skills: JSON.stringify(["report", "builtin"]),
    relTools: ["mcp-private", "builtin-tool"],
    relIds: ["10", "11", "12"],
    relResourceList: [{ resourceId: "10", targetContent: "secret" }, { resourceId: "12" }],
  };
  it("removes unauthorized definitions and references before workspace seeds and downloads", () => {
    const result = filterControlledResources(raw, new Set(), "2") as typeof raw;
    expect(result.relSkills).toEqual([{ skillCode: "builtin" }]);
    expect(result.skills).toBe(JSON.stringify(["builtin"]));
    expect(result.relTools).toEqual(raw.relTools);
    expect(result.relIds).toEqual(["12"]);
    expect(result.relResourceList).toEqual([{ resourceId: "12" }]);
    expect(raw.relSkills).toHaveLength(2);
  });
  it("preserves only the current user's allowed resources on a shared employee", () => {
    const result = filterControlledResources(raw, new Set(["10"]), "2") as typeof raw;
    expect(result.relSkills).toEqual(raw.relSkills);
    expect(result.relTools).toEqual(raw.relTools);
  });
  it("retains creator rights but never enables an off-shelf resource", () => {
    expect((filterControlledResources(raw, new Set(), "1") as typeof raw).relSkills).toEqual(raw.relSkills);
    const off = { ...raw, controlledResources: [{ ...raw.controlledResources[0], active: false }] };
    expect((filterControlledResources(off, new Set(["10"]), "1") as typeof raw).relSkills).toEqual([{ skillCode: "builtin" }]);
  });
  it("keeps legacy employee JSON unchanged and parses child use rights independently", () => {
    const legacy = { relTools: ["legacy"] };
    expect(filterControlledResources(legacy, new Set(), "")).toBe(legacy);
    const emptyPolicy = { ...legacy, controlledResources: [] };
    expect(filterControlledResources(emptyPolicy, new Set(), "")).toBe(emptyPolicy);
    const rights = { "10": "SKILL", "20": "DIG_EMPLOYEE", "30": "MCP", "40": "ALLOW_VIEW", "50": "CATALOG" };
    expect([...parseAuthorizedIds(rights)]).toEqual(["20"]);
    expect([...parseAuthorizedIds(rights, true)]).toEqual(["10", "20", "30"]);
  });
  it("uses resource IDs before skill codes shared with a different resource", () => {
    const value = {
      ...raw,
      relSkills: [{ resourceId: "12", skillCode: "report" }, { resourceId: "10", skillCode: "report" }],
      relResourceList: [{ resourceId: "12", resourceCode: "report" }],
    };
    const result = filterControlledResources(value, new Set(), "2") as typeof value;
    expect(result.relSkills).toEqual([{ resourceId: "12", skillCode: "report" }]);
    expect(result.relResourceList).toEqual(value.relResourceList);
    expect(result.relTools).toEqual(value.relTools);
  });
});
