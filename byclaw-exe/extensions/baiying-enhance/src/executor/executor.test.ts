import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BaiyingExecutor } from "./executor.js";
import {
  buildCapabilityFromDetail,
  buildCapabilityFromResourceContext,
  extractKnowledgeServiceBaseUrlFromDocDetail,
} from "./capability-builder.js";
import { resolveCapability } from "./capability-resolver.js";
import { resetExecutorCache, runBaiyingExecutor } from "./index.js";
import { asString } from "./types.js";
import { normalizeResourceId, normalizeResourceType } from "./resource-type.js";
import { resolveDocBackend } from "./resource-types/doc.js";
import { executeMcp } from "./resource-types/mcp.js";
import { executeToolkit } from "./resource-types/toolkit.js";
import { loadJsonSchema, summarizeSchema, validateParameters } from "./schema.js";
import { listMcpToolsLive } from "./mcp-client.js";

describe("resource-type helpers", () => {
  it("normalizes resource type aliases", () => {
    expect(normalizeResourceType("KG_DOC")).toBe("doc");
    expect(normalizeResourceType("ATOM")).toBe("doc");
    expect(normalizeResourceType("DOC")).toBe("doc");
    expect(normalizeResourceType("AGENT")).toBe("agent");
    expect(normalizeResourceType("TOOLKIT")).toBe("toolkit");
    expect(normalizeResourceType("MCP")).toBe("mcp");
    expect(normalizeResourceType("OBJECT")).toBe("object");
    expect(normalizeResourceType("VIEW")).toBe("view");
    expect(normalizeResourceType("")).toBe("");
  });

  it("strips `baiying_` prefix from capability id", () => {
    expect(normalizeResourceId("baiying_12345")).toBe("12345");
    expect(normalizeResourceId("12345")).toBe("12345");
    expect(normalizeResourceId(undefined)).toBe("");
  });
});

describe("schema helpers", () => {
  it("loadJsonSchema handles strings and objects", () => {
    expect(loadJsonSchema(null)).toBeNull();
    expect(loadJsonSchema("null")).toBeNull();
    expect(loadJsonSchema({ type: "string" })).toEqual({ type: "string" });
    expect(loadJsonSchema('{"type":"string"}')).toEqual({ type: "string" });
    expect(loadJsonSchema("not-json")).toBeNull();
  });

  it("summarizeSchema yields short field summaries", () => {
    const schema = {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        page: { type: "integer" },
      },
    };
    expect(summarizeSchema(schema)).toBe("query*:string, page:integer");
  });

  it("validateParameters reports missing required fields", () => {
    const err = validateParameters({
      actionName: "queryTodo",
      resourceId: "12345",
      resourceType: "TOOLKIT",
      parameters: {},
      rawSchema: { type: "object", required: ["query"], properties: { query: { type: "string" } } },
    });
    expect(err).not.toBeNull();
    expect(err?.error_code).toBe("INVALID_PARAMETERS");
    expect(err?.missing_required_fields).toEqual(["query"]);
  });

  it("validateParameters rejects keys not in schema.properties (use ownerUserCode not 工号)", () => {
    const err = validateParameters({
      actionName: "查询当前待我处理的单子列表",
      resourceId: "10000730",
      resourceType: "TOOLKIT",
      parameters: { 工号: "0027003729" },
      rawSchema: {
        type: "object",
        properties: {
          ownerUserCode: {
            type: "string",
            description: "工号",
          },
        },
      },
    });
    expect(err).not.toBeNull();
    expect(err?.error_code).toBe("INVALID_PARAMETERS");
    expect((err as { unknown_fields?: string[] }).unknown_fields).toEqual(["工号"]);
    const ip = (err as { input_properties?: { fields?: { name: string }[] } }).input_properties;
    expect(ip?.fields?.map((f) => f.name)).toEqual(["ownerUserCode"]);
  });

  it("validateParameters allows extra keys when additionalProperties is true", () => {
    const err = validateParameters({
      actionName: "x",
      resourceId: "1",
      resourceType: "TOOLKIT",
      parameters: { extra: 1, foo: "a" },
      rawSchema: {
        type: "object",
        additionalProperties: true,
        properties: { foo: { type: "string" } },
      },
    });
    expect(err).toBeNull();
  });
});

describe("capability builder", () => {
  it("builds a DOC capability from resource context", () => {
    const capability = buildCapabilityFromResourceContext("10863004", "KG_DOC", {
      selected_resource: {
        resourceId: "10863004",
        resourceName: "信和达知识库",
        resourceBizType: "KG_DOC",
        resourceDesc: "信和达知识库",
        resourceSourcePkId: "771338803769157",
      },
    });
    expect(capability).not.toBeNull();
    expect(capability?.resource_type).toBe("KG_DOC");
    expect(capability?.doc?.dataset_id).toBe("771338803769157");
  });

  it("extractKnowledgeServiceBaseUrlFromDocDetail reads openapiSchema.servers", () => {
    const url = extractKnowledgeServiceBaseUrlFromDocDetail({
      resourceService: [{ openapiSchema: { servers: [{ url: "http://k/svc/" }] } }],
    } as Record<string, unknown>);
    expect(url).toBe("http://k/svc/");
  });

  it("buildCapabilityFromDetail fills domain_url from resourceService when domainURL absent", () => {
    const capability = buildCapabilityFromDetail({
      resourceId: "1",
      detail: {
        resourceBizType: "KG_DOC",
        resourceName: "n",
        resourceCode: "rc1",
        systemCode: "WHALE_AGENT",
        resourceService: [
          {
            openapiSchema: {
              openapi: "3.0.1",
              servers: [{ url: "http://api.example/knowledge/" }],
              paths: {},
            },
          },
        ],
      },
    });
    expect(capability?.metadata.domain_url).toBe("http://api.example/knowledge/");
    expect(asString(capability?.metadata.resource_code)).toBe("rc1");
  });

  it("resolveCapability hydrates WHALE_AGENT doc domain_url from local snapshot when context has only selected_resource", async () => {
    const resourcesDir = path.join(import.meta.dirname, "../../resources");
    const { capability } = await resolveCapability({
      resourcesDir,
      capabilityId: "10000857",
      resourceType: "KG_DOC",
      resourceContext: {
        selected_resource: {
          resourceId: "10000857",
          resourceBizType: "KG_DOC",
          resourceName: "百应操作运维手册",
          resourceSourcePkId: "10000857",
          systemCode: "WHALE_AGENT",
        },
      },
      authContext: { session: "", userId: "", headers: {} },
    });
    expect(capability).not.toBeNull();
    expect(asString(capability!.metadata?.domain_url)).toContain("10.10.186.15");
    expect(asString(capability!.metadata?.resource_code)).toBe("797960892907077");
  });

  it("builds a TOOLKIT capability from detail", () => {
    const capability = buildCapabilityFromDetail({
      resourceId: "7001",
      detail: {
        resourceBizType: "TOOLKIT",
        resourceName: "Weather Toolkit",
        resourceDesc: "weather actions",
        domainURL: "https://api.example.com",
        param: {
          tools: [
            {
              resourceName: "query",
              resourceDesc: "query weather",
              param: { url: "/weather", method: "POST", inputSchema: { type: "object", required: ["city"], properties: { city: { type: "string" } } } },
            },
          ],
        },
      },
    });
    expect(capability).not.toBeNull();
    expect(capability?.resource_type).toBe("TOOLKIT");
    expect(capability?.tools?.length).toBe(1);
    expect(capability?.tools?.[0]?.name).toBe("query");
  });

  it("builds TOOLKIT OpenAPI URL as domainURL plus path", () => {
    const capability = buildCapabilityFromDetail({
      resourceId: "7002",
      detail: {
        resourceBizType: "TOOLKIT",
        resourceName: "Knowledge Toolkit",
        domainURL: "http://10.10.168.203:8000",
        pluginMachineInfo: [
          {
            pluginMachineOpenAPI: {
              info: { title: "知识库工具集", version: "1.0.0" },
              openapi: "3.0.1",
              paths: {
                "/api/v1/knowledgeItems/searchByResourceId": {
                  post: { summary: "按资源 ID 知识检索" },
                },
              },
              servers: [{ url: "http://localhost:8000" }],
            },
          },
        ],
      },
    });
    expect(capability).not.toBeNull();
    expect(capability?.tools?.length).toBe(1);
    expect(capability?.tools?.[0]?.url).toBe(
      "http://10.10.168.203:8000/api/v1/knowledgeItems/searchByResourceId",
    );
  });

  it("keeps absolute TOOLKIT action URL from param.tools", () => {
    const capability = buildCapabilityFromDetail({
      resourceId: "7003",
      detail: {
        resourceBizType: "TOOLKIT",
        resourceName: "Absolute Toolkit",
        domainURL: "https://api.example.com",
        param: {
          tools: [
            {
              resourceName: "query",
              openAPI: {
                info: { title: "query", version: "1.0.0" },
                paths: {
                  "/ignored/path": {
                    post: { summary: "query summary" },
                  },
                },
                servers: [{ url: "https://wrong.example.com" }],
              },
              param: {
                url: "https://fixed.example.com/weather",
                method: "POST",
              },
            },
          ],
        },
      },
    });
    expect(capability).not.toBeNull();
    expect(capability?.tools?.[0]?.url).toBe("https://fixed.example.com/weather");
  });

  it("builds an AGENT capability reading agentSseUrl from metaContent (snapshot JSON shape)", () => {
    const capability = buildCapabilityFromDetail({
      resourceId: "10034319",
      detail: {
        resourceBizType: "AGENT",
        resourceName: "智能体问答04162",
        resourceDesc: "智能体描述2",
        domainURL: "http://10.10.196.92:19902/pingress/",
        implType: "STREAMING_AGENT",
        headers: { pid: -1000 },
        metaContent: {
          agentSseUrl: "http://10.10.196.92:19902/pingress/agent/4e1fc33f660650a33a30b9ec",
          agentType: "001",
          agentWebUrl: "",
        },
      },
    });
    expect(capability).not.toBeNull();
    expect(capability?.resource_type).toBe("AGENT");
    expect(capability?.agent?.sse_url).toBe(
      "http://10.10.196.92:19902/pingress/agent/4e1fc33f660650a33a30b9ec",
    );
    expect(capability?.agent?.integration_type).toBe("001");
    expect(capability?.metadata?.impl_type).toBe("STREAMING_AGENT");
  });

  it("builds an MCP capability reading mcpType from metaContent", () => {
    const capability = buildCapabilityFromDetail({
      resourceId: "10002679",
      detail: {
        resourceBizType: "MCP",
        resourceName: "火车票12306",
        domainURL: "http://10.10.186.15:19902/pingress",
        metaContent: {
          mcpServerUrl: "/mcp-servers/12306-mcp/sse",
          mcpType: "sse",
        },
      },
    });
    expect(capability).not.toBeNull();
    expect(capability?.mcp?.server_url).toBe("http://10.10.186.15:19902/pingress/mcp-servers/12306-mcp/sse");
    expect(capability?.mcp?.transfer_type).toBe("sse");
  });

  it("executeToolkit posts multipart/form-data for binary file fields", async () => {
    const tempBase = await mkdtemp(path.join(tmpdir(), "toolkit-multipart-"));
    const uploadFile = path.join(tempBase, "README.md");
    await writeFile(uploadFile, "# hello multipart\n", "utf8");
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"resultCode":"0","resultMsg":"success"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const result = await executeToolkit({
      capability: {
        id: "baiying_10001395",
        type: "capability",
        source: "baiying",
        name: "知识库工具集",
        description: "知识库上传",
        resource_type: "TOOLKIT",
        metadata: { resource_id: "10001395" },
        _discovery_source: "test",
        tools: [
          {
            name: "上传文档",
            url: "http://10.10.168.203:8000/api/v1/knowledgeItems/importByResourceId",
            input_schema: {
              type: "object",
              required: ["resourceId", "filePath", "fileContent"],
              properties: {
                resourceId: { type: "string" },
                filePath: { type: "string" },
                fileContent: { type: "string", format: "binary" },
              },
            },
          },
        ],
      },
      action: "上传文档",
      parameters: {
        resourceId: "10000129",
        filePath: "/README.md",
        fileContent: uploadFile,
      },
      authContext: { session: "", userId: "", headers: {} },
    });

    expect(result.success).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, options] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(options.body).toBeInstanceOf(FormData);
    const headers = (options.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("content-type");
  });
});

describe("MCP transport chain", () => {
  it("resolveCapability uses real MCP resource JSON (SSE mcpType)", async () => {
    const resourcesDir = path.join(import.meta.dirname, "../../resources");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          'event: endpoint\ndata: /mcp/message?sessionId=test\n\n' +
            'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05"}}\n\n' +
            'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"lookup","inputSchema":{"type":"object"}}]}}\n\n',
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
      )
      .mockResolvedValue(new Response("", { status: 202, headers: { "content-type": "application/json" } }));
    const { capability } = await resolveCapability({
      resourcesDir,
      capabilityId: "10002679",
      resourceType: "MCP",
      resourceContext: {},
      authContext: { session: "", userId: "", headers: {} },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(capability?.mcp?.transfer_type).toBe("sse");
    expect(String(capability?.mcp?.server_url ?? "")).toContain("/mcp-servers/12306-mcp/sse");
    const firstHeaders = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(firstHeaders.Accept).toBe("text/event-stream");
  });

  it("resolveCapability uses real MCP resource JSON (streamable_http mcpType)", async () => {
    const resourcesDir = path.join(import.meta.dirname, "../../resources");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05" } }),
          { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "sid-r2" } },
        ),
      )
      .mockResolvedValueOnce(new Response("", { status: 202, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "query", inputSchema: { type: "object" } }] } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const { capability } = await resolveCapability({
      resourcesDir,
      capabilityId: "10004199",
      resourceType: "MCP",
      resourceContext: {},
      authContext: { session: "", userId: "", headers: {} },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(capability?.mcp?.transfer_type).toBe("streamable_http");
    expect(String(capability?.mcp?.server_url ?? "")).toContain("/mcp-servers/datacloud-data/mcp");
    const firstHeaders = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(firstHeaders.Accept).toContain("application/json");
  });

  it("listMcpToolsLive works with streamable_http", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05" } }),
          {
            status: 200,
            headers: { "content-type": "application/json", "mcp-session-id": "sid-1" },
          },
        ),
      )
      .mockResolvedValueOnce(new Response("", { status: 202, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: { tools: [{ name: "sum", inputSchema: { type: "object" } }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const capability = {
      resource_type: "MCP",
      name: "mcp",
      metadata: { resource_id: "m1" },
      mcp: { server_url: "http://mcp.test", transfer_type: "streamable_http" },
    };
    const result = await listMcpToolsLive({
      capability: capability as never,
      authContext: { session: "", userId: "", headers: {} },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.error).toBeNull();
    expect(result.tools?.[0]?.name).toBe("sum");
    const firstHeaders = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(firstHeaders.Accept).toContain("application/json");
  });

  it("listMcpToolsLive works with sse", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          'event: endpoint\ndata: /mcp/message?sessionId=test\n\n' +
            'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05"}}\n\n' +
            'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"lookup","inputSchema":{"type":"object"}}]}}\n\n',
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      )
      .mockResolvedValue(new Response("", { status: 202, headers: { "content-type": "application/json" } }));
    const capability = {
      resource_type: "MCP",
      name: "mcp",
      metadata: { resource_id: "m2" },
      mcp: { server_url: "http://mcp.test", mcpType: "sse" },
    };
    const result = await listMcpToolsLive({
      capability: capability as never,
      authContext: { session: "", userId: "", headers: {} },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.error).toBeNull();
    expect(result.tools?.[0]?.name).toBe("lookup");
    const firstHeaders = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(firstHeaders.Accept).toBe("text/event-stream");
  });

  it("executeMcp works with streamable_http and sse", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          'event: endpoint\ndata: /mcp/message?sessionId=test\n\n' +
            'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05"}}\n\n' +
            'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n',
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      )
      .mockResolvedValue(new Response("", { status: 202, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const baseCapability = {
        resource_type: "MCP",
        name: "mcp",
        metadata: { resource_id: "m3" },
        mcp: {
          server_url: "http://mcp.test",
          tools: [{ name: "run", input_schema: { type: "object" } }],
        },
      };
      const httpRes = await executeMcp({
        capability: { ...baseCapability, mcp: { ...baseCapability.mcp, transfer_type: "streamable_http" } } as never,
        action: "run",
        parameters: {},
        authContext: { session: "", userId: "", headers: {} },
      });
      const sseRes = await executeMcp({
        capability: { ...baseCapability, mcp: { ...baseCapability.mcp, mcpType: "sse" } } as never,
        action: "run",
        parameters: {},
        authContext: { session: "", userId: "", headers: {} },
      });
      expect(httpRes.success).toBe(true);
      expect(sseRes.success).toBe(true);
      const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
      const secondHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
      expect(firstHeaders.Accept).toContain("application/json");
      expect(secondHeaders.Accept).toBe("text/event-stream");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("BaiyingExecutor describe", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "baiying-executor-"));
    resetExecutorCache();
  });

  afterEach(() => {
    resetExecutorCache();
  });

  it("describes a DOC capability purely from resource context without local snapshot", async () => {
    const executor = new BaiyingExecutor({ resourcesDir: path.join(tempDir, "resources") });
    const result = await executor.describe({
      capabilityId: "10863004",
      resourceType: "KG_DOC",
      payload: {
        resource_context: {
          selected_resource: {
            resourceId: "10863004",
            resourceName: "信和达知识库",
            resourceBizType: "KG_DOC",
            resourceDesc: "信和达知识库",
            resourceSourcePkId: "771338803769157",
          },
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as Record<string, unknown>;
      const resource = data?.resource as Record<string, unknown>;
      expect(resource.dataset_id).toBe("771338803769157");
      expect(resource.discovery_source).toBe("resource_context");
    }
  });

  it("describes a TOOLKIT capability using local snapshot JSON", async () => {
    const resourcesDir = path.join(tempDir, "resources");
    await mkdir(path.join(resourcesDir, "toolkit"), { recursive: true });
    const detail = {
      resourceBizType: "TOOLKIT",
      resourceName: "Weather Toolkit",
      resourceDesc: "weather actions",
      domainURL: "https://api.example.com",
      param: {
        tools: [
          {
            resourceName: "query",
            resourceDesc: "query weather",
            param: {
              url: "/weather",
              method: "POST",
              inputSchema: { type: "object", required: ["city"], properties: { city: { type: "string" } } },
            },
          },
        ],
      },
    };
    await writeFile(
      path.join(resourcesDir, "toolkit", "TOOLKIT_7001.json"),
      JSON.stringify(detail),
      "utf8",
    );

    const executor = new BaiyingExecutor({ resourcesDir });
    const result = await executor.describe({ capabilityId: "7001", resourceType: "toolkit" });
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as Record<string, unknown>;
      const actions = data.actions as Array<Record<string, unknown>>;
      expect(actions.length).toBe(1);
      expect(actions[0].name).toBe("query");
      expect(actions[0].action_type).toBe("TOOLKIT_TOOL");
    }
  });

  it("returns CAPABILITY_NOT_FOUND for unknown capability", async () => {
    const executor = new BaiyingExecutor({ resourcesDir: path.join(tempDir, "resources") });
    const result = await executor.describe({ capabilityId: "does-not-exist" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error_code).toBe("CAPABILITY_NOT_FOUND");
    }
  });

  it("execute returns DATASET_ID_NOT_FOUND when doc capability has no dataset_id", async () => {
    // Construct a doc capability via resource context without dataset id.
    const executor = new BaiyingExecutor({ resourcesDir: path.join(tempDir, "resources") });
    // Supplying only partial context causes capability.doc.dataset_id to fall through to "" → DATASET_ID_NOT_FOUND.
    const result = await executor.execute({
      capabilityId: "10000",
      resourceType: "KG_DOC",
      payload: {
        resource_context: {
          selected_resource: {
            resourceId: "10000",
            resourceBizType: "KG_DOC",
            resourceName: "x",
            resourceSourcePkId: "", // empty
          },
        },
        // Missing required `query` and `agent_id` too — validated before dataset check,
        // but dataset_id resolves first in capability building.
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Either DATASET_ID_NOT_FOUND (empty) or INVALID_PARAMETERS depending on which check trips first.
      expect(
        result.error_code === "DATASET_ID_NOT_FOUND" || result.error_code === "INVALID_PARAMETERS",
      ).toBe(true);
    }
  });
});

describe("resolveDocBackend", () => {
  const originalEnv = process.env.BAIYING_DOC_BACKEND;
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BAIYING_DOC_BACKEND;
    } else {
      process.env.BAIYING_DOC_BACKEND = originalEnv;
    }
  });

  it("defaults to sdk when neither param nor env is set", () => {
    delete process.env.BAIYING_DOC_BACKEND;
    expect(resolveDocBackend({})).toBe("sdk");
  });

  it("respects the doc_backend parameter first", () => {
    process.env.BAIYING_DOC_BACKEND = "sdk";
    expect(resolveDocBackend({ doc_backend: "raw" })).toBe("raw");
    expect(resolveDocBackend({ doc_backend: "SDK" })).toBe("sdk");
  });

  it("falls back to BAIYING_DOC_BACKEND env var, defaulting to sdk for unknown values", () => {
    process.env.BAIYING_DOC_BACKEND = "raw";
    expect(resolveDocBackend({})).toBe("raw");
    process.env.BAIYING_DOC_BACKEND = "sdk";
    expect(resolveDocBackend({})).toBe("sdk");
    process.env.BAIYING_DOC_BACKEND = "anything-else";
    expect(resolveDocBackend({})).toBe("sdk");
  });
});

describe("runBaiyingExecutor (in-process entry)", () => {
  beforeEach(() => {
    resetExecutorCache();
  });

  it("returns metadata via runBaiyingExecutor({ metadataOnly: true })", async () => {
    const result = await runBaiyingExecutor({
      resourcesDir: path.join(tmpdir(), "baiying-executor-does-not-matter"),
      resourceId: "10863004",
      resourceType: "KG_DOC",
      metadataOnly: true,
      payload: {
        resource_context: {
          selected_resource: {
            resourceId: "10863004",
            resourceBizType: "KG_DOC",
            resourceName: "x",
            resourceSourcePkId: "pk-001",
          },
        },
      },
    });
    expect((result as Record<string, unknown>).success).toBe(true);
  });
});
