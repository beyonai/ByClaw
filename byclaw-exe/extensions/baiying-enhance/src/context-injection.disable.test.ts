import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adaptAgentJson } from "./agent-adapter.js";
import { buildSoul, buildToolsMd, seedManagedAgentWorkspace } from "./workspace-seed.js";
import { buildSubagentRoutingMarkdown } from "./subagent-routing-seed.js";
import { buildExecutorResourceContext } from "./resource-metadata-context.js";
import type { AdaptedManagedAgent } from "./agent-adapter.js";

/**
 * T-06 / T-07 / T-08 / T-09 / T-14 — context-injection exclusion: the four
 * retired types must not reach `associatedResources`, `TOOLS.md` / `SOUL.md`,
 * the sub-agent routing markdown or the executor `selected_resource`, while
 * normal types (`DOC` / `ATOM` / `KG_*` / `SKILL` / ...) keep their behaviour.
 */

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

function makeAgentFixture(overrides: Partial<AdaptedManagedAgent> = {}): AdaptedManagedAgent {
  return {
    sourceKey: "100",
    agentId: "baiying-agent-100",
    listEntry: { id: "baiying-agent-100", name: "DingTalk assistant" },
    ...overrides,
  } as AdaptedManagedAgent;
}

describe("associatedResources exclusion (C1)", () => {
  it("excludes the four retired types and keeps DOC/ATOM/KG resources", () => {
    const raw = {
      resourceId: "10039008",
      // A normal resource whose agent name mentions ontology must not be
      // filtered by keyword (AC-004).
      resourceName: "Ontology helper",
      relResourceList: [
        { resourceId: "1", resourceName: "对象资源", resourceBizType: "OBJECT" },
        { resourceId: "2", resourceName: "视图资源", resourceBizType: "VIEW" },
        { resourceId: "3", resourceName: "本体库", resourceBizType: "ONTOLOGY_BASE" },
        { resourceId: "4", resourceName: "场景", resourceBizType: "SCENE" },
        { resourceId: "5", resourceName: "小写视图", resourceType: "view" },
        { resourceId: "6", resourceName: "知识库", resourceBizType: "KG_DOC" },
        { resourceId: "7", resourceName: "原子知识", resourceBizType: "ATOM" },
        { resourceId: "8", resourceName: "文档", resourceBizType: "DOC" },
        { resourceId: "9", resourceName: "技能", resourceBizType: "SKILL" },
      ],
    };

    const res = adaptAgentJson({ raw, fileName: "DIG_EMPLOYEE_10039008.json", embedApiKeysFromJson: false });
    expect("error" in res).toBe(false);
    if ("error" in res) {
      return;
    }

    const kept = (res.associatedResources ?? []).map((r) => r.resourceId).sort();
    expect(kept).toEqual(["6", "7", "8"]);
    // SKILL keeps its pre-existing exclusion semantics.
    expect(res.associatedResources!.some((r) => r.resourceBizType === "SKILL")).toBe(false);
    expect(res.associatedResources!.some((r) => r.resourceType === "view")).toBe(false);
  });

  it("keeps a normal resource whose description mentions retired capabilities", () => {
    const raw = {
      resourceId: "10039009",
      resourceName: "Doc agent",
      relResourceList: [
        {
          resourceId: "11",
          resourceName: "知识库",
          resourceBizType: "KG_DOC",
          resourceDesc: "对象/视图/本体/场景的说明文档",
          targetContent: "legacy OBJECT payload must not affect the type decision",
        },
      ],
    };

    const res = adaptAgentJson({ raw, fileName: "DIG_EMPLOYEE_10039009.json", embedApiKeysFromJson: false });
    expect("error" in res).toBe(false);
    if ("error" in res) {
      return;
    }
    expect(res.associatedResources).toHaveLength(1);
    expect(res.associatedResources![0].resourceId).toBe("11");
  });
});

describe("managed prompt files (C3/C4)", () => {
  it("TOOLS.md omits retired resources and carries the offline guidance", () => {
    const md = buildToolsMd({
      resourceId: "100",
      relResourceList: [
        { resourceId: "1", resourceName: "用户信息表", resourceBizType: "OBJECT", resourceCode: "po_users" },
        { resourceId: "2", resourceName: "销售视图", resourceBizType: "VIEW" },
        { resourceId: "3", resourceName: "知识库", resourceBizType: "KG_DOC" },
      ],
    } as Parameters<typeof buildToolsMd>[0]);

    expect(md).toContain("知识库");
    expect(md).not.toContain("用户信息表");
    expect(md).not.toContain("销售视图");
    expect(md).not.toContain("type: OBJECT");
    expect(md).not.toContain("type: VIEW");
    expect(md).not.toContain("file_url");
    expect(md).not.toContain("call_object_ids");
    expect(md).not.toContain("call_view_ids");
    expect(md).toContain("已下线");
  });

  it("SOUL.md carries no retired-resource guidance", () => {
    const md = buildSoul({
      resourceId: "100",
      resourceName: "Assistant",
      integrationType: "INTERFACE",
      relResourceList: [{ resourceId: "1", resourceName: "用户信息表", resourceBizType: "OBJECT" }],
    } as Parameters<typeof buildSoul>[0]);

    expect(md).not.toContain("用户信息表");
    expect(md).not.toContain("call_object_ids");
    expect(md).not.toContain("file_url");
  });
});

describe("sub-agent routing markdown (C2)", () => {
  it("omits retired resource fragments", async () => {
    const md = await buildSubagentRoutingMarkdown([
      makeAgentFixture({
        associatedResources: [
          {
            resourceId: "1",
            resourceName: "用户信息表",
            resourceType: "OBJECT",
            resourceBizType: "OBJECT",
          },
          {
            resourceId: "2",
            resourceName: "销售视图",
            resourceType: "VIEW",
            resourceBizType: "VIEW",
          },
          {
            resourceId: "3",
            resourceName: "知识库",
            resourceType: "KG_DOC",
            resourceBizType: "KG_DOC",
          },
        ],
      }),
    ]);

    expect(md).toContain("KG_DOC: 知识库");
    expect(md).not.toContain("OBJECT: 用户信息表");
    expect(md).not.toContain("VIEW: 销售视图");
  });
});

describe("executor resource context (C6)", () => {
  it("drops retired types from selected_resource", () => {
    const context = buildExecutorResourceContext({
      agent: makeAgentFixture(),
      resource: {
        resourceId: "1",
        resourceName: "用户信息表",
        resourceType: "OBJECT",
        resourceBizType: "OBJECT",
      },
    });
    expect(context.selected_resource).toBeNull();
  });

  it("keeps normal types in selected_resource", () => {
    const context = buildExecutorResourceContext({
      agent: makeAgentFixture(),
      resource: {
        resourceId: "3",
        resourceName: "知识库",
        resourceType: "KG_DOC",
        resourceBizType: "KG_DOC",
      },
    });
    expect(context.selected_resource).toMatchObject({ resourceId: "3", resourceBizType: "KG_DOC" });
  });
});

describe("managed file protection (C5/C7)", () => {
  it("does not overwrite user-maintained SOUL.md/TOOLS.md", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "baiying-seed-"));
    tempDirs.push(dir);
    const userSoul = "# My own soul\n\nkeep me\n";
    const userTools = "# My own tools\n\nkeep me too\n";
    await fs.writeFile(path.join(dir, "SOUL.md"), userSoul, "utf8");
    await fs.writeFile(path.join(dir, "TOOLS.md"), userTools, "utf8");

    const agentId = "baiying-agent-100";
    await seedManagedAgentWorkspace({
      api: {
        runtime: {
          config: {
            loadConfig: () => ({ agents: { list: [{ id: agentId, workspace: dir }] } }),
          },
        },
      } as never,
      adapted: makeAgentFixture({
        sourceJson: {
          resourceId: "100",
          resourceName: "Assistant",
          relResourceList: [
            { resourceId: "1", resourceName: "用户信息表", resourceBizType: "OBJECT" },
            { resourceId: "3", resourceName: "知识库", resourceBizType: "KG_DOC" },
          ],
        },
      } as Partial<AdaptedManagedAgent>),
    });

    expect(await fs.readFile(path.join(dir, "SOUL.md"), "utf8")).toBe(userSoul);
    expect(await fs.readFile(path.join(dir, "TOOLS.md"), "utf8")).toBe(userTools);

    // A managed file (marker-prefixed) is refreshed with the new content.
    const managedTools = await fs.readFile(path.join(dir, "TOOLS.md"), "utf8");
    expect(managedTools.startsWith("<!-- baiying-enhance: managed seed -->")).toBe(false);
  });

  it("refreshes a managed TOOLS.md with the retired-type-free content", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "baiying-seed-"));
    tempDirs.push(dir);
    await fs.writeFile(
      path.join(dir, "TOOLS.md"),
      "<!-- baiying-enhance: managed seed -->\n\n# Tools\n\n- old OBJECT guidance\n",
      "utf8",
    );

    const agentId = "baiying-agent-100";
    await seedManagedAgentWorkspace({
      api: {
        runtime: {
          config: {
            loadConfig: () => ({ agents: { list: [{ id: agentId, workspace: dir }] } }),
          },
        },
      } as never,
      adapted: makeAgentFixture({
        sourceJson: {
          resourceId: "100",
          resourceName: "Assistant",
          relResourceList: [
            { resourceId: "1", resourceName: "用户信息表", resourceBizType: "OBJECT" },
            { resourceId: "3", resourceName: "知识库", resourceBizType: "KG_DOC" },
          ],
        },
      } as Partial<AdaptedManagedAgent>),
    });

    const refreshed = await fs.readFile(path.join(dir, "TOOLS.md"), "utf8");
    expect(refreshed).toContain("知识库");
    expect(refreshed).not.toContain("用户信息表");
    expect(refreshed).not.toContain("old OBJECT guidance");
    expect(refreshed).toContain("已下线");
  });
});
