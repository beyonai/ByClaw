import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AdaptedManagedAgent } from "./agent-adapter.js";
import { buildSubagentRoutingMarkdown, SUBAGENT_ROUTING_MARKER } from "./subagent-routing-seed.js";
import { MANAGED_AGENT_PREFIX } from "./types.js";

describe("buildSubagentRoutingMarkdown", () => {
  it("marks output and lists empty-registry message when no managed agents", async () => {
    const md = await buildSubagentRoutingMarkdown([]);
    expect(md.startsWith(SUBAGENT_ROUTING_MARKER)).toBe(true);
    expect(md).toContain("No `baiying-agent-*`");
    expect(md).toContain("agents_list");
  });

  it("includes agentId and integration notes for a managed agent", async () => {
    const agentId = `${MANAGED_AGENT_PREFIX}42`;
    const adapted: AdaptedManagedAgent = {
      sourceKey: "42",
      agentId,
      providerKey: "",
      modelRef: "",
      allowSpawnFrom: ["main"],
      listEntry: { id: agentId, name: "CRM Bot", identity: { name: "CRM Bot" } },
      systemPrompt: "You help with CRM exports.",
      integrationType: "NONE",
      coreCompetencies: [
        {
          coreCompetency: "Reports",
          description: "Build reports",
          acceptBoundary: ["revenue queries"],
          rejectBoundary: ["password resets"],
          example: ["Top 10 customers"],
        },
      ],
      associatedResources: [
        {
          resourceId: "r1",
          resourceName: "Sales DB",
          resourceType: "OBJECT",
          resourceDesc: "Query sales",
        },
      ],
    };
    const md = await buildSubagentRoutingMarkdown([adapted]);
    expect(md).toContain(`\`${agentId}\``);
    expect(md).toContain("CRM Bot");
    expect(md).toContain("Reports: Build reports");
    expect(md).toContain("revenue queries");
    expect(md).not.toMatch(/\*\*res\*\*:/);
  });

  it("reads resourceDesc from Baiying detail JSON on disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "baiying-route-"));
    const jsonPath = path.join(dir, "agent.json");
    await writeFile(
      jsonPath,
      JSON.stringify({
        resourceId: "99",
        resourceName: "Detail Agent",
        resourceDesc: "Handles procurement workflows only.",
        integrationType: "INTERFACE",
      }),
      "utf8",
    );
    const agentId = `${MANAGED_AGENT_PREFIX}99`;
    const adapted: AdaptedManagedAgent = {
      sourceKey: "99",
      agentId,
      providerKey: "",
      modelRef: "",
      allowSpawnFrom: ["main"],
      listEntry: { id: agentId, name: "Detail Agent", identity: { name: "Detail Agent" } },
      systemPrompt: "fallback",
      integrationType: "INTERFACE",
      sourceFilePath: jsonPath,
    };
    const md = await buildSubagentRoutingMarkdown([adapted]);
    expect(md).toContain("procurement");
    expect(md).toContain("INTERFACE");
  });

  it("uses raw detail corePersonaDefinition and coreCompetencies as routing hints", async () => {
    const agentId = `${MANAGED_AGENT_PREFIX}10000281`;
    const adapted: AdaptedManagedAgent = {
      sourceKey: "10000281",
      agentId,
      providerKey: "",
      modelRef: "",
      allowSpawnFrom: ["main"],
      listEntry: { id: agentId, name: "项目管理数字员工", identity: { name: "项目管理数字员工" } },
      systemPrompt: "fallback",
      integrationType: "NONE",
      sourceJson: {
        resourceId: "10000281",
        resourceName: "项目管理数字员工",
        resourceDesc: "作为项目管理数字员工，我以视图直观呈现数据，专业高效为您答疑解惑。",
        corePersonaDefinition: JSON.stringify([
          { name: "工作规范", key: "agent", value: "回答严谨简洁" },
        ]),
        coreCompetencies: JSON.stringify([
          {
            coreCompetency: "项目进度跟踪与可视化",
            description: "通过视图工具直观呈现项目进度数据。",
            acceptBoundary: ["甘特图等进度视图生成与解读"],
            rejectBoundary: ["不提供底层IT系统或网络故障排查"],
            example: ["帮我看看目前项目的整体进度到哪了？"],
          },
          {
            coreCompetency: "任务分配与资源调度",
            description: "分析项目团队的工作负荷。",
            acceptBoundary: ["团队成员工作负荷分析"],
            rejectBoundary: ["不处理企业人事任免与绩效考核"],
            example: ["现在谁手头的工作量超载了？"],
          },
          {
            coreCompetency: "风险预警与问题追踪",
            description: "监控项目执行过程中的潜在风险。",
            acceptBoundary: ["项目风险清单视图生成"],
            rejectBoundary: ["不提供法律合规性风险审查"],
            example: ["当前项目有哪些高风险项需要关注？"],
          },
          {
            coreCompetency: "项目数据报表与总结分析",
            description: "生成可视化报表，辅助项目复盘与决策。",
            acceptBoundary: ["项目周报/月报数据视图生成"],
            rejectBoundary: ["不提供企业级财务三大表及深度财务分析"],
            example: ["帮我生成本周的项目数据看板"],
          },
        ]),
      },
    };

    const md = await buildSubagentRoutingMarkdown([adapted]);
    expect(md).toContain("**persona**: 工作规范: 回答严谨简洁");
    expect(md).toContain("项目进度跟踪与可视化");
    expect(md).toContain("任务分配与资源调度");
    expect(md).toContain("风险预警与问题追踪");
    expect(md).toContain("项目数据报表与总结分析");
    expect(md).toContain("团队成员工作负荷分析");
    expect(md).toContain("项目风险清单视图生成");
    expect(md).toContain("帮我生成本周的项目数据看板");
  });
});
