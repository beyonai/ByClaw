import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCapabilityFromResourceContext } from "./capability-builder.js";
import { executeDoc, resolveWhaleAgentKnowledgeSearchConfig } from "./resource-types/doc.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WHALE_AGENT knowledge search config", () => {
  it("builds relation-level search config from resource context", () => {
    const capability = buildCapabilityFromResourceContext("10863004", "KG_DOC", {
      selected_resource: {
        resourceId: "10863004",
        resourceName: "信和达知识库",
        resourceBizType: "KG_DOC",
        resourceSourcePkId: "771338803769157",
        knowledgeSearchConfig: {
          similarity: 0.75,
          topK: 12,
        },
      },
    });

    expect(capability?.metadata.knowledge_search_config).toEqual({
      similarity: 0.75,
      topK: 12,
    });
  });

  it("uses defaults for a historical relation without search config", () => {
    const capability = buildCapabilityFromResourceContext("10863004", "KG_DOC", {
      selected_resource: {
        resourceId: "10863004",
        resourceName: "信和达知识库",
        resourceBizType: "KG_DOC",
      },
    });

    expect(resolveWhaleAgentKnowledgeSearchConfig(capability!)).toEqual({
      similarity: 0.6,
      topK: 20,
    });
  });

  it("sends configured values and prevents call parameters from overriding them", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ resultCode: "0", resultObject: { data: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const capability = buildCapabilityFromResourceContext("10863004", "KG_DOC", {
      selected_resource: {
        resourceId: "10863004",
        resourceName: "信和达知识库",
        resourceBizType: "KG_DOC",
        resourceSourcePkId: "771338803769157",
        resourceCode: "KN-001",
        systemCode: "WHALE_AGENT",
        domainURL: "http://knowledge.example",
        knowledgeSearchConfig: {
          similarity: 0.75,
          topK: 12,
        },
      },
    });

    const result = await executeDoc({
      capability: capability!,
      parameters: {
        query: "测试问题",
        similarity: 0.1,
        topK: 99,
        searchMode: "embedding",
      },
      authContext: { session: "", userId: "", headers: {} },
    });

    expect(result.success).toBe(true);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      query: "测试问题",
      knCodeList: ["KN-001"],
      similarity: 0.75,
      topK: 12,
      searchMode: "embedding",
    });
  });
});
