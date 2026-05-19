import { describe, expect, it } from "vitest";
import type { AdaptedManagedAgent } from "./agent-adapter.js";
import { buildBaiyingCallDescription } from "./baiying-call-tool.js";

function makeAgent(): AdaptedManagedAgent {
  return {
    sourceKey: "10863047",
    agentId: "baiying-agent-10863047",
    providerKey: "baiying-m-10863047",
    modelRef: "baiying-m-10863047/qwen3-max",
    allowSpawnFrom: ["main"],
    listEntry: {
      id: "baiying-agent-10863047",
      name: "厦门信和达IT助手",
      identity: { name: "厦门信和达IT助手" },
      tools: {
        alsoAllow: ["baiying_call"],
      },
    },
    associatedResources: [
      {
        resourceId: "10863004",
        resourceName: "信和达知识库",
        resourceType: "KG_DOC",
        resourceBizType: "KG_DOC",
        resourceDesc: "信和达知识库",
        resourceSourcePkId: "771338803769157",
      },
      {
        resourceId: "752299921044997",
        resourceName: "dc智办宝",
        resourceType: "MCP",
        resourceBizType: "MCP",
        resourceDesc: "dc智办宝",
      },
      {
        resourceId: "10810924",
        resourceName: "待办视图",
        resourceType: "VIEW",
        resourceBizType: "VIEW",
        resourceCode: "todo_view",
        resourceDesc: "只读视图",
      },
    ],
  };
}

describe("buildBaiyingCallDescription", () => {
  it("lists resources from associatedResources (agent export / sync)", () => {
    const desc = buildBaiyingCallDescription({ agent: makeAgent() });

    expect(desc).toContain("信和达知识库 (KG_DOC, id: 10863004");
    expect(desc).toContain("dc智办宝 (MCP, id: 752299921044997");
    expect(desc).toContain("待办视图 (VIEW, id: 10810924, name: 待办视图, resource_code: todo_view");
  });

  it("lists the root agent resource when agentHomeUrl is present", () => {
    const agent = makeAgent();
    agent.agentHomeUrl = "https://home.example.com/agent/10863047";

    const desc = buildBaiyingCallDescription({ agent });

    expect(desc).toContain("厦门信和达IT助手 (AGENT, id: 10863047");
    expect(desc).toContain("agent_home_url: https://home.example.com/agent/10863047");
    expect(desc).toContain("信和达知识库 (KG_DOC, id: 10863004");
  });

  it("surfaces MCP URL fields from resource.raw when present on export", () => {
    const agent = makeAgent();
    const mcp = agent.associatedResources!.find((r) => r.resourceId === "752299921044997")!;
    mcp.raw = {
      ...mcp.raw,
      mcpServerUrl: "http://10.10.165.35:8800/mcp",
      mcpTransferType: "streamable_http",
    };

    const desc = buildBaiyingCallDescription({ agent });
    expect(desc).toContain("server_url: http://10.10.165.35:8800/mcp");
    expect(desc).toContain("transfer_type: streamable_http");
  });

  it("includes file_url guidance for large OBJECT/VIEW payloads", () => {
    const desc = buildBaiyingCallDescription({ agent: makeAgent() });

    expect(desc).toContain("`file_url` in response data; `file_url` is a local file path");
    expect(desc).toContain("prefer the local-file content pointed to by `file_url`");
    expect(desc).toContain("retry at least 3 times with a 1-2 second interval");
  });
});
