import { describe, expect, it, vi } from "vitest";
import {
  AgentCapabilityCardService,
  AgentCapabilityCompileError,
  type AgentCapabilityDraftGenerator,
} from "../src/agent-capability.js";

const validDraft = {
  summary: "分析经营数据并定位异常指标",
  capabilities: ["查询经营数据", "分析指标趋势", "查询经营数据"],
  bestFor: ["分析销售额下降原因", "比较不同区域的业务表现"],
  requires: ["明确的指标", "时间范围"],
  delivers: ["指标分析结论", "异常说明"],
  limitations: ["不能修改生产数据"],
  keywords: ["经营分析", "销售分析", "指标异常"],
  missingInformation: [],
  warnings: [],
};

describe("AgentCapabilityCardService", () => {
  it("builds a versioned card and deterministic routing text", async () => {
    const generator: AgentCapabilityDraftGenerator = {
      generate: vi.fn(async () => validDraft),
    };
    const service = new AgentCapabilityCardService(generator);
    const result = await service.compile({
      locale: " zh-CN ",
      agent: {
        name: " 经营分析助手 ",
        description: " 分析销售和收入数据 ",
        skills: [{ code: "sql", name: " SQL 查询 " }],
        outputTypes: ["分析结论"],
        constraints: ["不能修改生产数据"],
        examples: [
          {
            request: "分析本季度销售额",
            expectedOutcome: "输出趋势和异常说明",
          },
        ],
      },
    });

    expect(result).toMatchObject({
      schemaVersion: "byclaw.agent-capability-card/v1",
      generatorVersion: "1.0.0",
      card: {
        summary: "分析经营数据并定位异常指标",
        capabilities: ["查询经营数据", "分析指标趋势"],
      },
      quality: { confidence: "high" },
    });
    expect(result.sourceFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.routingText).toContain(
      "擅长: 查询经营数据, 分析指标趋势",
    );
    expect(result.routingText.length).toBeLessThanOrEqual(500);
    expect(generator.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: "zh-CN",
        agent: expect.objectContaining({
          name: "经营分析助手",
          description: "分析销售和收入数据",
        }),
      }),
    );
  });

  it("rejects an Agent name without capability evidence before model generation", async () => {
    const generator: AgentCapabilityDraftGenerator = {
      generate: vi.fn(),
    };
    const service = new AgentCapabilityCardService(generator);

    await expect(
      service.compile({ agent: { name: "万能助手" } }),
    ).rejects.toMatchObject<Partial<AgentCapabilityCompileError>>({
      name: "AgentCapabilityCompileError",
      statusCode: 422,
    });
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it("rejects a model draft that omits routing evidence", async () => {
    const service = new AgentCapabilityCardService({
      generate: async () => ({ ...validDraft, keywords: [] }),
    });

    await expect(
      service.compile({
        agent: { name: "分析助手", description: "分析数据" },
      }),
    ).rejects.toMatchObject<Partial<AgentCapabilityCompileError>>({
      statusCode: 502,
    });
  });
});
