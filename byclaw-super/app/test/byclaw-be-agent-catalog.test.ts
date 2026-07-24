import { describe, expect, it, vi } from "vitest";
import {
  ByClawBeAgentCatalog,
  ByClawBeAgentCatalogError,
} from "../byclaw-be-agent-catalog.js";

describe("ByClaw BE Agent Catalog", () => {
  it("calls discover with the token and maps only authorized agents", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        code: 0,
        msg: "Operation successful",
        success: true,
        data: {
          list: [
            {
              id: "10001912",
              name: "企业微信助手",
              resourceCode: "BYAI_DIG_EMPLOYEE_10001912",
              resourceDesc: "企业微信助手",
              tagName: "个人助理",
              skills: '[{"skillCode":"dws"},{"skillCode":"wecomcli"}]',
              usesPermissions: true,
            },
            {
              id: "10001913",
              name: "未授权助手",
              usesPermissions: false,
            },
          ],
        },
      }),
    );
    const catalog = new ByClawBeAgentCatalog({
      baseUrl: "http://127.0.0.1:8086",
      timeoutMs: 1_000,
      fetchImpl: fetchImpl as typeof fetch,
      endpointResolver: {
        resolve: async () => "http://byclaw-be.by-service.svc.cluster.local:8086",
      },
    });

    const agents = await catalog.listAuthorizedAgents({
      beyondToken: "secret-token",
      systemCode: "BYAI",
    });

    expect(agents).toEqual([
      {
        id: "10001912",
        code: "BYAI_DIG_EMPLOYEE_10001912",
        name: "企业微信助手",
        description: "企业微信助手；个人助理；技能：dws、wecomcli",
        execution: {
          connectorId: "openclaw-by-framework",
          targetId: "10001912",
        },
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://byclaw-be.by-service.svc.cluster.local:8086/byaiService/api/v2/digitEmploy/discover",
    );
    expect(init?.headers).toMatchObject({
      "Beyond-Token": "secret-token",
      "System-Code": "BYAI",
      language: "zh-CN",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      terminals: ["ALL", "PC", "APP"],
      pageNum: 1,
      pageSize: 9_999,
      keyword: "",
      metaStatus: "ALL",
      orgFilters: [{ type: "all" }],
      orderField: "updateTime",
      orderBy: "desc",
      language: "zh-CN",
    });
  });

  it("rejects failed discover responses", async () => {
    const catalog = new ByClawBeAgentCatalog({
      baseUrl: "http://127.0.0.1:8086",
      timeoutMs: 1_000,
      fetchImpl: vi.fn(async () => Response.json({ code: 500, msg: "failed" })) as typeof fetch,
    });

    await expect(catalog.listAuthorizedAgents({ beyondToken: "secret-token" })).rejects.toBeInstanceOf(
      ByClawBeAgentCatalogError,
    );
  });

  it("falls back to BYCLAW_BE_BASE_URL when Redis has no instance", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ code: 0, success: true, data: { list: [] } }),
    );
    const catalog = new ByClawBeAgentCatalog({
      baseUrl: "http://127.0.0.1:18086",
      timeoutMs: 1_000,
      fetchImpl: fetchImpl as typeof fetch,
      endpointResolver: { resolve: async () => undefined },
    });

    await catalog.listAuthorizedAgents({ beyondToken: "secret-token" });

    const [url] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://127.0.0.1:18086/byaiService/api/v2/digitEmploy/discover");
  });
});
