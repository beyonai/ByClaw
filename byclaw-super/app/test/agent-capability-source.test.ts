import { describe, expect, it } from "vitest";
import {
  buildAgentCapabilityBackfillSource,
  type DigitalEmployeeCapabilityRow,
} from "../business/agent-capability-source.js";

describe("buildAgentCapabilityBackfillSource", () => {
  it("prefers the standard target_content snapshot and enriches it with active relations", () => {
    const row = employeeRow({
      target_content: JSON.stringify({
        systemCode: "BYAI",
        resourceCode: "BYAI_DIG_EMPLOYEE_10093429",
        resourceName: "文章创作助手",
        resourceDesc: "负责文章创作、修改和校验",
        language: "zh-CN",
        corePersonaDefinition: JSON.stringify([
          {
            name: "工作规范",
            key: "agent",
            value: "先规划，再创作。",
          },
        ]),
        relSkills: [
          {
            skillCode: "web-search",
            resourceName: "联网搜索",
            resourceDesc: "查询并核验实时信息",
          },
        ],
        relTools: [
          {
            resourceCode: "image-tool",
            resourceName: "配图工具",
            resourceDesc: "生成文章配图",
          },
        ],
        constraints: ["不得编造事实"],
        coreCompetencies: JSON.stringify([
          {
            coreCompetency: "文章策划",
            description: "规划选题和大纲",
            rejectBoundary: ["不负责发布"],
            example: [
              {
                request: "规划一篇产品文章",
                expectedOutcome: "输出标题和大纲",
              },
            ],
          },
        ]),
      }),
    });

    const source = buildAgentCapabilityBackfillSource(row, [
      {
        agent_id: "10093429",
        resource_code: "web-search",
        resource_name: "重复联网搜索",
        resource_desc: "重复关系应去重",
        resource_biz_type: "SKILL",
      },
      {
        agent_id: "10093429",
        resource_code: "mcp-publish",
        resource_name: "发布工具",
        resource_desc: "提供发布动作",
        resource_biz_type: "MCP",
      },
      {
        agent_id: "10093429",
        resource_code: "product-kb",
        resource_name: "产品知识库",
        resource_desc: "产品资料",
        resource_biz_type: "KG_DOC",
      },
    ]);

    expect(source).toMatchObject({
      agentId: "10093429",
      systemCode: "BYAI",
      input: {
        locale: "zh-CN",
        agent: {
          code: "BYAI_DIG_EMPLOYEE_10093429",
          name: "文章创作助手",
          description: "负责文章创作、修改和校验",
          knowledgeDomains: ["产品知识库"],
          constraints: ["不得编造事实", "不负责发布"],
          examples: [
            {
              request: "规划一篇产品文章",
              expectedOutcome: "输出标题和大纲",
            },
          ],
        },
      },
    });
    expect(source.input.agent.instructions).toContain("## 工作规范");
    expect(source.input.agent.instructions).toContain("文章策划：规划选题和大纲");
    expect(source.input.agent.skills).toEqual([
      {
        code: "web-search",
        name: "联网搜索",
        description: "查询并核验实时信息",
      },
    ]);
    expect(source.input.agent.tools).toEqual([
      {
        code: "image-tool",
        name: "配图工具",
        description: "生成文章配图",
      },
      {
        code: "mcp-publish",
        name: "发布工具",
        description: "提供发布动作",
      },
    ]);
  });

  it("falls back to extension columns for historical rows without target_content", () => {
    const source = buildAgentCapabilityBackfillSource(
      employeeRow({
        target_content: null,
        ability: "分析经营数据",
        constraints: "不能修改生产数据；不能泄露凭据",
        core_persona_definition: JSON.stringify([
          { name: "规范", key: "agent", value: "只输出有证据的结论。" },
        ]),
        skills: JSON.stringify([
          {
            skillCode: "sql",
            resourceName: "SQL 分析",
            resourceDesc: "查询结构化数据",
          },
        ]),
      }),
      [],
    );

    expect(source.input.agent.instructions).toContain("分析经营数据");
    expect(source.input.agent.constraints).toEqual([
      "不能修改生产数据",
      "不能泄露凭据",
    ]);
    expect(source.input.agent.skills).toEqual([
      {
        code: "sql",
        name: "SQL 分析",
        description: "查询结构化数据",
      },
    ]);
  });
});

function employeeRow(
  overrides: Partial<DigitalEmployeeCapabilityRow> = {},
): DigitalEmployeeCapabilityRow {
  return {
    agent_id: "10093429",
    system_code: "BYAI",
    resource_code: "BYAI_DIG_EMPLOYEE_10093429",
    resource_name: "历史名称",
    resource_desc: "历史描述",
    tags: null,
    resource_d_verid: 1,
    resource_r_verid: 0,
    create_time: new Date("2026-01-01T00:00:00.000Z"),
    update_time: new Date("2026-07-27T00:00:00.000Z"),
    ability: null,
    constraints: null,
    faqs: null,
    processing_flow: null,
    core_competencies: null,
    core_persona_definition: null,
    skills: null,
    target_content: null,
    ...overrides,
  };
}
